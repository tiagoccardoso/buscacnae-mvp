import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/format";
import {
  deleteAllSearchHistoryAction,
  deleteSearchHistoryItemAction,
  deleteSelectedSearchHistoryAction
} from "@/app/dashboard/actions";

type HistoryPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readStatusMessage(status: string) {
  if (status === "item-excluido") return "Busca removida do histórico com sucesso.";
  if (status === "selecionadas-excluidas") return "As buscas selecionadas foram removidas do histórico.";
  if (status === "tudo-excluido") return "Todo o histórico de pesquisas foi excluído.";
  if (status === "compra-multipla-sucesso") return "Pagamento confirmado. As listas selecionadas foram liberadas em uma única compra.";
  if (status === "compra-multipla-cancelada") return "A compra em grupo foi cancelada antes da confirmação do pagamento.";
  if (status === "listas-ja-liberadas") return "As buscas selecionadas já estavam liberadas e não exigem nova compra.";
  if (status === "busca-vinculada") return "Busca salva no histórico com sucesso. Você já pode reabrir o resultado ou seguir para a compra.";
  return "";
}

function readErrorMessage(error: string) {
  if (error === "busca-invalida") return "Busca inválida para exclusão.";
  if (error === "nada-selecionado") return "Selecione ao menos uma busca para excluir em grupo.";
  if (error === "busca-nao-encontrada") return "Não foi possível localizar a busca para exclusão.";
  if (error === "falha-excluir-item") return "Falha ao excluir o item do histórico.";
  if (error === "falha-excluir-selecionadas") return "Falha ao excluir as buscas selecionadas.";
  if (error === "falha-excluir-tudo") return "Falha ao excluir todo o histórico.";
  if (error === "nada-selecionado-compra") return "Selecione ao menos uma busca para comprar em grupo.";
  if (error === "busca-nao-encontrada-compra") return "Não foi possível localizar as buscas selecionadas para compra.";
  if (error === "falha-checkout-multiplo") return "Não foi possível criar o checkout em grupo das listas selecionadas.";
  if (error === "retorno-checkout-invalido") return "O retorno do checkout em grupo veio incompleto.";
  if (error === "checkout-multiplo-nao-encontrado") return "Não foi possível localizar a compra em grupo realizada.";
  return "";
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const status = typeof resolvedSearchParams.status === "string" ? resolvedSearchParams.status : "";
  const error = typeof resolvedSearchParams.error === "string" ? resolvedSearchParams.error : "";
  const statusMessage = readStatusMessage(status);
  const errorMessage = readErrorMessage(error);

  const db = createDbClient();
  const { data: searches } = await db
    .from("search_queries")
    .select("*")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const searchIds = (searches ?? []).map((search) => search.id);
  const { data: orders } = searchIds.length
    ? await db
        .from("search_access_orders")
        .select("search_query_id, result_count, updated_at")
        .in("search_query_id", searchIds)
        .order("updated_at", { ascending: false })
    : { data: [] as Array<{ search_query_id: string; result_count: number; updated_at: string }> };

  const orderResultCountBySearchId = new Map<string, number>();
  for (const order of orders ?? []) {
    if (!orderResultCountBySearchId.has(order.search_query_id) && typeof order.result_count === "number") {
      orderResultCountBySearchId.set(order.search_query_id, order.result_count);
    }
  }

  const feedback = (
    <>
      {statusMessage ? <div className="notice success">{statusMessage}</div> : null}
      {errorMessage ? <div className="notice danger">{errorMessage}</div> : null}
    </>
  );

  if (!searches || searches.length === 0) {
    return (
      <div className="stack">
        {feedback}
        <EmptyState
          title="Nenhuma busca registrada"
          description="Quando você executar pesquisas, elas aparecerão aqui com total de resultados, recorte e atalhos para repetir a busca ou comprar a lista."
          ctaHref="/dashboard/search"
          ctaLabel="Fazer primeira busca"
        />
      </div>
    );
  }

  return (
    <div className="surface-premium card-lg stack">
      {feedback}

      <div className="history-toolbar">
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Histórico</span>
          <h2 className="section-title">Buscas recentes e atalhos de recompra</h2>
          <p className="section-copy">
            Reabra resultados, repita o mesmo recorte e compre várias listas em grupo quando fizer sentido.
          </p>
          <span className="muted">
            {searches.length} registro(s) exibidos. Marque uma ou mais linhas para excluir ou comprar várias listas de uma só vez.
          </span>
        </div>

        <div className="history-toolbar-actions">
          <form id="history-bulk-selection-form" action={deleteSelectedSearchHistoryAction}>
            <button type="submit" className="button-danger">
              Excluir selecionadas
            </button>
            <button type="submit" formAction="/api/stripe/history-bulk-checkout" formMethod="post" className="button" data-analytics-event="bulk_checkout_started">
              Comprar selecionadas
            </button>
          </form>
          <form action={deleteAllSearchHistoryAction}>
            <button type="submit" className="button-danger">
              Excluir todo o histórico
            </button>
          </form>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table table-premium table-glow">
          <thead>
            <tr>
              <th className="history-select-col">Selecionar</th>
              <th>Quando</th>
              <th>CNAE</th>
              <th>Localidade</th>
              <th>Resultados</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {searches.map((search) => (
              <tr key={search.id}>
                <td className="history-select-cell">
                  <input
                    type="checkbox"
                    name="searchIds"
                    value={search.id}
                    form="history-bulk-selection-form"
                    aria-label={`Selecionar busca ${search.cnae_code} em ${search.city_name}/${search.state_code}`}
                    className="history-checkbox"
                  />
                </td>
                <td>{formatDateTime(search.created_at)}</td>
                <td>{search.cnae_code}</td>
                <td>
                  {search.city_name}/{search.state_code}
                </td>
                <td>{orderResultCountBySearchId.get(search.id) ?? search.total_results}</td>
                <td>{search.cached ? "cache" : "consulta"}</td>
                <td>
                  <div className="history-row-actions">
                    <Link href={`/dashboard/search/${search.id}`} className="button-ghost history-action-button">
                      Abrir
                    </Link>
                    <Link href={`/dashboard/search?reuse=${search.id}`} className="button-ghost history-action-button">
                      Repetir
                    </Link>
                    <form action={deleteSearchHistoryItemAction.bind(null, search.id)}>
                      <button type="submit" className="button-danger history-action-button">
                        Excluir
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

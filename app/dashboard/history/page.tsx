import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  if (status === "item-excluido") {
    return "Busca removida do histórico com sucesso.";
  }

  if (status === "selecionadas-excluidas") {
    return "As buscas selecionadas foram removidas do histórico.";
  }

  if (status === "tudo-excluido") {
    return "Todo o histórico de pesquisas foi excluído.";
  }

  return "";
}

function readErrorMessage(error: string) {
  if (error === "busca-invalida") {
    return "Busca inválida para exclusão.";
  }

  if (error === "nada-selecionado") {
    return "Selecione ao menos uma busca para excluir em grupo.";
  }

  if (error === "busca-nao-encontrada") {
    return "Não foi possível localizar a busca para exclusão.";
  }

  if (error === "falha-excluir-item") {
    return "Falha ao excluir o item do histórico.";
  }

  if (error === "falha-excluir-selecionadas") {
    return "Falha ao excluir as buscas selecionadas.";
  }

  if (error === "falha-excluir-tudo") {
    return "Falha ao excluir todo o histórico.";
  }

  return "";
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const status = typeof resolvedSearchParams.status === "string" ? resolvedSearchParams.status : "";
  const error = typeof resolvedSearchParams.error === "string" ? resolvedSearchParams.error : "";
  const statusMessage = readStatusMessage(status);
  const errorMessage = readErrorMessage(error);

  const { data: searches } = await supabase
    .from("search_queries")
    .select("*")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

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
          description="Quando você executar consultas, elas aparecerão aqui com o total de resultados, cidade, CNAE e informação de cache em uma visão histórica mais executiva."
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
          <span className="eyebrow">Histórico operacional</span>
          <h2 className="section-title">Consultas executadas</h2>
          <p className="section-copy">
            Acompanhe volume, localidade, resultado e origem da consulta em uma tabela desenhada para leitura comercial.
          </p>
          <span className="muted">
            {searches.length} registro(s) exibidos no histórico recente. Marque uma ou mais linhas para excluir em grupo.
          </span>
        </div>

        <div className="history-toolbar-actions">
          <form id="history-bulk-delete-form" action={deleteSelectedSearchHistoryAction}>
            <button type="submit" className="button-danger">
              Excluir selecionadas
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
                      form="history-bulk-delete-form"
                      aria-label={`Selecionar busca ${search.cnae_code} em ${search.city_name}/${search.state_code}`}
                      className="history-checkbox"
                    />
                  </td>
                  <td>{formatDateTime(search.created_at)}</td>
                  <td>{search.cnae_code}</td>
                  <td>
                    {search.city_name}/{search.state_code}
                  </td>
                  <td>{search.total_results}</td>
                  <td>{search.cached ? "cache" : "consulta"}</td>
                  <td>
                    <div className="history-row-actions">
                      <Link href={`/dashboard/search/${search.id}`} className="button-ghost history-action-button">
                        Abrir
                      </Link>
                      <form action={deleteSearchHistoryItemAction}>
                        <input type="hidden" name="searchId" value={search.id} />
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

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { EmptyState } from "@/components/empty-state";
import { LeadToggleForm } from "@/components/lead-toggle-form";
import { FormattedDownloadButtons } from "@/components/formatted-download-buttons";
import {
  ensureSearchAccessOrderForSearch,
  getSearchAiFormatOrderBySearchQueryId,
  syncSearchAccessOrderPaymentStatus,
  syncSearchAiFormatOrderPaymentStatus,
  type SearchAccessOrderRecord,
  type SearchAiFormatOrderRecord
} from "@/lib/billing";
import { formatCnpj, formatDateTime, formatMoney } from "@/lib/format";
import { getAiFormattingPriceCents } from "@/lib/env";
import { getSearchSummary } from "@/lib/search-summary";
import { extractSingleObject } from "@/lib/utils";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";
import { canonicalizeEstablishment } from "@/lib/establishment-canonical";

type SearchResultPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readAiFormatMessage(status: string) {
  if (status === "success") {
    return { type: "success", text: "Pagamento da formatação por IA confirmado. Os downloads em XLSX e PDF já estão liberados para esta lista." };
  }

  if (status === "cancelled") {
    return { type: "warning", text: "A cobrança da formatação por IA foi cancelada. Você pode tentar novamente quando quiser." };
  }

  if (status === "blocked") {
    return { type: "warning", text: "A formatação por IA só fica disponível depois que a compra da lista for efetivada." };
  }

  if (status === "error") {
    return { type: "danger", text: "Não foi possível iniciar o checkout da formatação por IA." };
  }

  return null;
}

export default async function SearchResultPage({ params, searchParams }: SearchResultPageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const aiFormatState = typeof resolvedSearchParams.ai_format === "string" ? resolvedSearchParams.ai_format : "";
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const search = await supabase
    .from("search_queries")
    .select("*")
    .eq("id", id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!search.data) {
    notFound();
  }

  const summary = getSearchSummary(search.data);
  const pricingSummary = readLeadPricingSummary((search.data.query_payload as Record<string, unknown> | null)?.leadPricingSummary);

  let order: SearchAccessOrderRecord | null = null;
  let orderErrorMessage = "";

  try {
    const ensuredOrder = await ensureSearchAccessOrderForSearch({
      searchQueryId: id,
      profileId: user.id,
      email: user.email ?? undefined,
      provider: typeof search.data.provider === "string" ? search.data.provider : undefined,
      totalResults: typeof search.data.total_results === "number" ? search.data.total_results : undefined
    });

    order = await syncSearchAccessOrderPaymentStatus(ensuredOrder);
  } catch (error) {
    orderErrorMessage = error instanceof Error ? error.message : "Não foi possível preparar o pedido comercial desta busca.";
  }

  const orderUnlocked = order?.status === "paid" || order?.status === "free";
  const admin = createSupabaseAdminClient();

  const { data: rows } = await admin
    .from("search_results")
    .select("position, establishment_id, establishments(*)")
    .eq("search_query_id", id)
    .order("position", { ascending: true });

  const establishmentIds = (rows ?? []).map((row) => row.establishment_id);
  const { data: savedRows } = establishmentIds.length
    ? await supabase
        .from("saved_establishments")
        .select("establishment_id")
        .eq("profile_id", user.id)
        .in("establishment_id", establishmentIds)
    : { data: [] as Array<{ establishment_id: string }> };

  const savedSet = new Set((savedRows ?? []).map((item) => item.establishment_id));
  const aiFormatMessage = readAiFormatMessage(aiFormatState);

  let aiFormatOrder: SearchAiFormatOrderRecord | null = null;
  if (orderUnlocked && (rows?.length ?? 0) > 0) {
    const existingAiOrder = await getSearchAiFormatOrderBySearchQueryId(id);
    aiFormatOrder = existingAiOrder ? await syncSearchAiFormatOrderPaymentStatus(existingAiOrder) : null;
  }

  const aiFormatUnlocked = aiFormatOrder?.status === "paid";

  return (
    <div className="stack">
      {aiFormatMessage ? <div className={`notice ${aiFormatMessage.type}`}>{aiFormatMessage.text}</div> : null}

      <div className="panel-grid two">
        <div className="surface-premium card-lg stack">
          <div className="inline-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">Resultado da busca</span>
              <h2 className="section-title" style={{ marginBottom: 0 }}>
                {summary.headline}
              </h2>
              <span className="muted">
                {search.data.total_results} resultados · {search.data.cached ? "cache" : "consulta nova"} · {" "}
                {formatDateTime(search.data.created_at)}
              </span>
            </div>
            <Link href="/dashboard/search" className="button-ghost">
              Nova busca
            </Link>
          </div>

          <div className="stat-grid stat-grid-premium">
            <div className="stat-box stat-box-premium">
              <strong>{search.data.total_results}</strong>
              <span className="muted">Empresas retornadas</span>
            </div>
            <div className="stat-box stat-box-premium">
              <strong>{summary.cnaeText}</strong>
              <span className="muted">CNAEs do recorte</span>
            </div>
            <div className="stat-box stat-box-premium">
              <strong>{summary.locationText}</strong>
              <span className="muted">Abrangência geográfica</span>
            </div>
          </div>

          {summary.filterLabels.length > 0 ? (
            <div className="inline-list">
              {summary.filterLabels.map((label) => (
                <span key={label} className="pill">
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Compra da lista</span>

          {order ? (
            <>
              <div className="grid-2">
                <div className="surface-soft card stack">
                  <span className="kicker">Leads encontrados</span>
                  <strong style={{ fontSize: "2rem" }}>{order.result_count}</strong>
                  <span className="muted">Quantidade pronta para desbloqueio.</span>
                </div>
                <div className="surface-soft card stack">
                  <span className="kicker">Total</span>
                  <strong style={{ fontSize: "2rem" }}>{formatMoney(order.total_amount_cents / 100)}</strong>
                  <span className="muted">Cobrança automática por tipo de lead encontrado.</span>
                </div>
              </div>

              {pricingSummary ? <LeadPricingBreakdown summary={pricingSummary} /> : null}

              <div className="notice">
                {orderUnlocked
                  ? "Esta lista já está liberada. Você pode abrir a versão completa ou baixar o XLSX."
                  : order.result_count === 0
                    ? "Nenhum CNPJ foi encontrado nesta busca. O resultado fica disponível sem cobrança."
                    : "A lista completa pode ser comprada agora, aproveitando a pesquisa já salva no Dashboard."}
              </div>

              <div className="inline-actions">
                {orderUnlocked ? (
                  <>
                    <Link href={`/orders/${order.access_token}`} className="button">
                      Abrir lista liberada
                    </Link>
                    <Link href={`/orders/${order.access_token}/download`} className="button-ghost">
                      Baixar XLSX
                    </Link>
                  </>
                ) : order.result_count === 0 ? (
                  <Link href={`/orders/${order.access_token}`} className="button">
                    Ver resultado vazio
                  </Link>
                ) : (
                  <Link href={`/checkout/${order.id}`} className="button">
                    Comprar lista
                  </Link>
                )}
              </div>

              {orderUnlocked && (rows?.length ?? 0) > 0 ? (
                <div className="surface-soft card stack" style={{ marginTop: 12 }}>
                  <span className="eyebrow">Formatação com IA</span>
                  <div className="grid-2">
                    <div className="stack" style={{ gap: 6 }}>
                      <span className="kicker">Cobrança individual</span>
                      <strong style={{ fontSize: "1.8rem" }}>{formatMoney(getAiFormattingPriceCents() / 100)}</strong>
                      <span className="muted">Cada lista comprada libera a organização por IA em uma cobrança separada.</span>
                    </div>
                    <div className="stack" style={{ gap: 6 }}>
                      <span className="kicker">Entrega</span>
                      <strong style={{ fontSize: "1.1rem" }}>{aiFormatUnlocked ? "IA liberada" : "Aguardando liberação"}</strong>
                      <span className="muted">Quando liberada, esta mesma lista poderá ser baixada em XLSX com 4 abas organizadas e em PDF no formato ficha por registro.</span>
                    </div>
                  </div>

                  <div className="notice">
                    {aiFormatUnlocked
                      ? "A organização por IA desta lista já foi contratada. Ao clicar em um dos downloads, o sistema gera um XLSX estruturado com quatro abas e um PDF em formato de ficha cadastral, iniciando o arquivo automaticamente ao concluir."
                      : "O botão só aparece depois da compra efetivada da lista. Ao contratar, esta lista recebe uma cobrança avulsa de R$ 10,00 para gerar um XLSX estruturado e um PDF legível por registro."}
                  </div>

                  <div className="inline-actions">
                    {aiFormatUnlocked ? (
                      <FormattedDownloadButtons searchId={id} />
                    ) : (
                      <form action="/api/stripe/ai-format-checkout" method="POST">
                        <input type="hidden" name="searchId" value={id} />
                        <button type="submit" className="button">
                          Formatar com IA por R$ 10,00
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="notice warning">{orderErrorMessage || "Não foi possível preparar o pedido comercial desta busca."}</div>
          )}
        </div>
      </div>

      {!rows || rows.length === 0 ? (
        <EmptyState
          title="Nenhum estabelecimento retornado"
          description="Tente outro recorte de CNAEs ou ajuste a região da busca. O resultado continua salvo no Dashboard para você revisar depois."
          ctaHref="/dashboard/search"
          ctaLabel="Voltar ao formulário"
        />
      ) : (
        <div className="surface-premium card-lg stack">
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">Lista retornada</span>
            <p className="section-copy">
              Navegue pelos estabelecimentos encontrados, abra a ficha completa, salve os melhores no pipeline comercial ou avance para a compra da lista completa.
            </p>
          </div>
          <div className="result-card-grid">
            {rows.map((row) => {
              const establishment = extractSingleObject(row.establishments);
              if (!establishment) return null;

              const establishmentId = String(establishment.id);
              const canonical = canonicalizeEstablishment(establishment);
              const companyName = canonical.companyName ?? "-";
              const cnpj = canonical.cnpj ?? "";
              const cityName = canonical.cityName ?? "-";
              const stateCode = canonical.stateCode ?? "-";
              const status = canonical.registrationStatus ?? "-";

              return (
                <article key={establishmentId} className="result-card-premium">
                  <div className="result-card-index">#{row.position}</div>
                  <div className="stack" style={{ gap: 6 }}>
                    <strong className="result-card-title">{companyName}</strong>
                    <span className="muted">{canonical.tradeName || "Nome fantasia não informado"}</span>
                  </div>
                  <div className="result-card-meta">
                    <span><strong>CNPJ:</strong> {formatCnpj(cnpj)}</span>
                    <span><strong>Cidade:</strong> {cityName}/{stateCode}</span>
                    <span><strong>Status:</strong> {status}</span>
                  </div>
                  <div className="inline-actions result-card-actions">
                    <Link href={`/dashboard/companies/${encodeURIComponent(cnpj)}`} className="button-ghost">
                      Ver ficha
                    </Link>
                    <LeadToggleForm establishmentId={establishmentId} isSaved={savedSet.has(establishmentId)} />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

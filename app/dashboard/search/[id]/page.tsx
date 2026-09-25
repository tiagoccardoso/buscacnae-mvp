import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { EmptyState } from "@/components/empty-state";
import { FormattedDownloadButtons } from "@/components/formatted-download-buttons";
import { AiFormatProcessingPanel } from "@/components/ai-format-processing-panel";
import {
  ensureSearchAccessOrderForSearch,
  getSearchAiFormatOrderBySearchQueryId,
  readSearchAiFormatProcessingStatus,
  syncSearchAccessOrderPaymentStatus,
  syncSearchAiFormatOrderPaymentStatus,
  type SearchAccessOrderRecord,
  type SearchAiFormatOrderRecord
} from "@/lib/billing";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getSearchSummary } from "@/lib/search-summary";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";
import { companyFromSearchRow, toCompanyListItem, type CompanyListItem } from "@/lib/company-model";
import { getAiFormatPricingTable, getAiFormattingPriceSummary } from "@/lib/ai-format-pricing";
import { CompanyResultsTable } from "@/components/results/company-results-table";
import { saveSelectedEstablishmentsAction, toggleSavedEstablishmentAction } from "@/app/dashboard/actions";
import { ResultsViewToggle, type ResultsView } from "@/components/map/results-view-toggle";
import { BusinessMapWorkspace } from "@/components/map/business-map-workspace";
import { parseCompanyFilters, writeCompanyFilters } from "@/lib/results/filter-params";
import { isUuid } from "@/lib/map/service";
import { mapLayerFromParam } from "@/lib/map/types";
import { getPublicMapConfig } from "@/lib/env";

type SearchResultPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readAiFormatMessage(status: string) {
  if (status === "success") {
    return {
      type: "success",
      text: "Pagamento confirmado. Sua lista já pode ser baixada em XLSX organizado, com aba Contatos WhatsApp, e em PDF legível por registro."
    };
  }

  if (status === "cancelled") {
    return {
      type: "warning",
      text: "A ativação do upgrade com IA foi cancelada. Quando quiser, você pode concluir a compra e liberar o XLSX com contatos para WhatsApp Web e o PDF da lista."
    };
  }

  if (status === "blocked") {
    return {
      type: "warning",
      text: "Esse upgrade fica disponível depois da compra da lista. Após liberar a base, você pode ativar a versão pronta para prospecção com IA."
    };
  }

  if (status === "error") {
    return { type: "danger", text: "Não foi possível iniciar a compra do upgrade com IA. Tente novamente em instantes." };
  }

  return null;
}

export default async function SearchResultPage({ params, searchParams }: SearchResultPageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const aiFormatState = typeof resolvedSearchParams.ai_format === "string" ? resolvedSearchParams.ai_format : "";
  // Lista, Mapa e Inteligência compartilham a mesma busca salva e os mesmos filtros da URL.
  const view: ResultsView =
    resolvedSearchParams.view === "mapa" ? "mapa" : resolvedSearchParams.view === "inteligencia" ? "inteligencia" : "lista";
  const isMapView = view !== "lista";
  const sharedFilters = parseCompanyFilters(resolvedSearchParams);
  const filterQuery = writeCompanyFilters(new URLSearchParams(), sharedFilters).toString();
  const requestedLayer = mapLayerFromParam(resolvedSearchParams.camada);
  const requestedCompany = typeof resolvedSearchParams.empresa === "string" && isUuid(resolvedSearchParams.empresa) ? resolvedSearchParams.empresa : null;
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  const search = await db
    .from("search_queries")
    .select("*")
    .eq("id", id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!search.data) {
    notFound();
  }

  const summary = getSearchSummary(search.data);
  const searchQueryPayload =
    search.data.query_payload && typeof search.data.query_payload === "object" && !Array.isArray(search.data.query_payload)
      ? (search.data.query_payload as Record<string, unknown>)
      : {};
  const fetchedResults =
    typeof searchQueryPayload.fetchedResults === "number" && Number.isFinite(searchQueryPayload.fetchedResults)
      ? Math.max(0, Math.trunc(searchQueryPayload.fetchedResults))
      : null;
  const hitFetchLimit = searchQueryPayload.hitFetchLimit === true;
  const pricingSummary = readLeadPricingSummary((search.data.query_payload as Record<string, unknown> | null)?.leadPricingSummary);
  const autoRefinementSuggested = searchQueryPayload.autoRefinementSuggested === true;
  const autoRefinementReason = typeof searchQueryPayload.autoRefinementReason === "string" ? searchQueryPayload.autoRefinementReason : "";
  const suggestedActivityStartYear =
    typeof searchQueryPayload.suggestedActivityStartYear === "number" ? Math.trunc(searchQueryPayload.suggestedActivityStartYear) : null;
  const suggestedActivityStartYearExact = searchQueryPayload.suggestedActivityStartYearExact === true;
  const totalLeadsForAiFormat = Math.max(0, Number(search.data.total_results ?? 0));
  const aiFormatPriceSummary = getAiFormattingPriceSummary(totalLeadsForAiFormat);
  const aiFormatPricingTable = getAiFormatPricingTable();

  let order: SearchAccessOrderRecord | null = null;
  let orderErrorMessage = "";

  try {
    const ensuredOrder = await ensureSearchAccessOrderForSearch({
      searchQueryId: id,
      profileId: user.id,
      email: user.email ?? undefined,
      provider: typeof search.data.provider === "string" ? search.data.provider : undefined,
      totalResults: typeof search.data.total_results === "number" ? search.data.total_results : undefined,
      pricingSummary
    });

    order = await syncSearchAccessOrderPaymentStatus(ensuredOrder);
  } catch (error) {
    orderErrorMessage = error instanceof Error ? error.message : "Não foi possível preparar o pedido comercial desta busca.";
  }

  const orderUnlocked = order?.status === "paid" || order?.status === "free";
  const effectiveResultCount = order?.result_count ?? Math.max(0, Number(search.data.total_results ?? 0));

  const { data: rows } = await db
    .from("search_results")
    .select("position, establishment_id, provider_payload, establishments(*)")
    .eq("search_query_id", id)
    .order("position", { ascending: true });

  const establishmentIds = (rows ?? []).map((row) => row.establishment_id);
  const { data: savedRows } = establishmentIds.length
    ? await db
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
  const aiFormatProcessingStatus = aiFormatOrder ? readSearchAiFormatProcessingStatus(aiFormatOrder) : "idle";
  const aiFormatInitialError = aiFormatProcessingStatus === "error" ? aiFormatOrder?.format_error ?? null : null;
  const autoStartAiProcessing = aiFormatState === "success" && aiFormatUnlocked && aiFormatProcessingStatus === "idle";
  const unlockedRows = orderUnlocked ? rows ?? [] : (rows ?? []).slice(0, 1);
  const hiddenResultsCount = Math.max(0, (rows?.length ?? 0) - unlockedRows.length);
  // Modelo normalizado (Company → CompanyListItem): só campos exibidos vão ao navegador,
  // nunca o payload bruto da Casa dos Dados.
  const listItems: CompanyListItem[] = isMapView
    ? []
    : unlockedRows
        .map((row) => {
          const company = companyFromSearchRow(row);
          if (!company || !company.cnpj) return null;
          return toCompanyListItem(company, {
            position: Number(row.position ?? 0),
            saved: savedSet.has(String(row.establishment_id ?? company.id))
          });
        })
        .filter((item): item is CompanyListItem => item !== null);

  return (
    <>
      {aiFormatMessage ? (
        <div className="stack-sm">
          <div className={`notice ${aiFormatMessage.type}`} role={aiFormatMessage.type === "danger" ? "alert" : "status"}>
            {aiFormatMessage.text}
          </div>
        </div>
      ) : null}

      <section className="section" aria-labelledby="search-result-title">
        <div className="section-header-row">
          <div className="section-header">
            <span className="eyebrow">Resultado da busca</span>
            <h2 id="search-result-title" className="title-1">
              {summary.headline}
            </h2>
            <p className="footnote">
              {effectiveResultCount} resultados · {search.data.cached ? "cache" : "consulta nova"} · {formatDateTime(search.data.created_at)}
              {hitFetchLimit && fetchedResults !== null ? ` · ${fetchedResults} carregados para esta operação` : ""}
            </p>
          </div>
          <div className="cluster">
            <Link href={`/dashboard/search?reuse=${id}${isMapView ? "&view=mapa" : ""}`} className="button-secondary">
              Repetir busca
            </Link>
            <Link href="/dashboard/search" className="button-ghost">
              Nova busca
            </Link>
          </div>
        </div>

        <div className="stat-group">
          <div className="stat">
            <span className="stat-value">{effectiveResultCount}</span>
            <span className="stat-label">Empresas retornadas</span>
          </div>
          {hitFetchLimit && fetchedResults !== null ? (
            <div className="stat">
              <span className="stat-value">{fetchedResults}</span>
              <span className="stat-label">Carregadas nesta operação</span>
            </div>
          ) : null}
          <div className="stat">
            <span className="stat-value stat-value-sm">{summary.cnaeText}</span>
            <span className="stat-label">CNAEs do recorte</span>
          </div>
          <div className="stat">
            <span className="stat-value stat-value-sm">{summary.locationText}</span>
            <span className="stat-label">Abrangência geográfica</span>
          </div>
        </div>

        {summary.filterLabels.length > 0 ? (
          <div className="inline-list" aria-label="Filtros aplicados">
            {summary.filterLabels.map((label) => (
              <span key={label} className="pill">
                {label}
              </span>
            ))}
          </div>
        ) : null}

        <div className="results-view-toggle">
          <ResultsViewToggle searchId={id} view={view} filterQuery={filterQuery} />
          {view === "mapa" ? <p className="footnote">Mesmos resultados e filtros da lista, no mapa.</p> : null}
          {view === "inteligencia" ? (
            <p className="footnote">Concentração territorial (H3), municípios e indicadores dos mesmos resultados.</p>
          ) : null}
        </div>

        {autoRefinementSuggested && suggestedActivityStartYear ? (
          <div className="notice warning">
            <div className="stack-xs">
              <span>{autoRefinementReason || "Essa busca ficou ampla. Recomendamos aplicar recorte temporal por ano."}</span>
              <div>
                <Link
                  href={`/dashboard/search?reuse=${id}&suggestedYear=${suggestedActivityStartYear}&suggestedExact=${suggestedActivityStartYearExact ? "1" : "0"}`}
                  className="button-secondary button-sm"
                >
                  Refazer com recorte temporal sugerido
                </Link>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {isMapView ? (
        <section className="section" aria-label={view === "inteligencia" ? "Inteligência territorial dos resultados" : "Mapa dos resultados"}>
          <BusinessMapWorkspace
            key={view}
            searchId={id}
            config={getPublicMapConfig()}
            variant="embedded"
            view={view}
            initialState={{ filters: sharedFilters, layer: requestedLayer, companyId: requestedCompany }}
          />
        </section>
      ) : null}

      {isMapView ? null : order ? (
        <section className="order-layout" aria-label="Compra da lista">
          <div className="stack-xl">
            {pricingSummary ? (
              <LeadPricingBreakdown summary={pricingSummary} />
            ) : (
              <div className="section-header">
                <span className="eyebrow">Compra da lista</span>
                <h2 className="title-2">Resumo do pedido</h2>
                <p className="section-copy">Cobrança automática pela composição real do lote.</p>
              </div>
            )}

            {orderUnlocked && (rows?.length ?? 0) > 0 ? (
              <div className="tile stack-lg">
                <div className="section-header">
                  <span className="eyebrow">Lista pronta para prospecção com IA</span>
                  <h2 className="title-2">{aiFormatUnlocked ? "Upgrade com IA ativo" : "Transforme a lista em material de prospecção"}</h2>
                  <p className="section-copy">
                    Receba XLSX organizado, aba &quot;Contatos WhatsApp&quot; com link direto para WhatsApp Web e PDF legível por registro.
                  </p>
                </div>

                <div className="stat-group">
                  <div className="stat">
                    <span className="stat-value">{aiFormatPriceSummary.formattedAmount}</span>
                    <span className="stat-label">Valor do upgrade para {aiFormatPriceSummary.totalLeads} leads</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value stat-value-sm">{aiFormatUnlocked ? "Upgrade liberado" : "Aguardando ativação"}</span>
                    <span className="stat-label">Entrega comercial</span>
                  </div>
                </div>

                <details className="disclosure-inline">
                  <summary>Tabela de cobrança do upgrade com IA</summary>
                  <dl className="price-rows">
                    {aiFormatPricingTable.map((tier) => (
                      <div key={tier.id}>
                        <dt>{tier.label}</dt>
                        <dd>
                          {tier.id === "above_1000"
                            ? `${formatMoney(tier.baseAmountCents / 100)} + ${formatMoney(tier.extraLeadUnitAmountCents / 100)} por lead adicional`
                            : formatMoney(tier.baseAmountCents / 100)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>

                {!aiFormatUnlocked && aiFormatPriceSummary.hasAdditionalLeadCharge ? (
                  <p className="footnote">
                    {`${formatMoney(aiFormatPriceSummary.baseAmountCents / 100)} base + ${aiFormatPriceSummary.extraLeadCount} leads adicionais x ${formatMoney(aiFormatPriceSummary.extraLeadUnitAmountCents / 100)}.`}
                  </p>
                ) : null}

                <div>
                  {!aiFormatUnlocked ? (
                    <form action="/api/stripe/ai-format-checkout" method="POST" data-analytics-event="ai_format_checkout_started">
                      <input type="hidden" name="searchId" value={id} />
                      <button type="submit" className="button">
                        Quero minha lista pronta para prospecção por {aiFormatPriceSummary.formattedAmount}
                      </button>
                    </form>
                  ) : aiFormatProcessingStatus === "ready" ? (
                    <FormattedDownloadButtons searchId={id} />
                  ) : (
                    <AiFormatProcessingPanel
                      searchId={id}
                      initialStatus={aiFormatProcessingStatus}
                      initialError={aiFormatInitialError}
                      autoStart={autoStartAiProcessing}
                    />
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <aside className="order-summary" aria-label="Resumo do pedido">
            <div className="order-total">
              <span className="kicker">Total do pedido</span>
              <span className="order-total-value">{formatMoney(order.total_amount_cents / 100)}</span>
              <span className="footnote">Cobrança automática pela composição real do lote.</span>
            </div>

            <dl className="order-lines">
              <div>
                <dt>Leads encontrados</dt>
                <dd>{order.result_count}</dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd>
                  <span className={`pill ${orderUnlocked ? "success" : "warning"}`}>
                    {orderUnlocked ? "Lista liberada" : order.result_count === 0 ? "Sem cobrança" : "Aguardando compra"}
                  </span>
                </dd>
              </div>
            </dl>

            <p className="footnote">
              {orderUnlocked
                ? "Esta lista já está liberada. Você pode abrir a versão completa, baixar o XLSX ou ativar a lista pronta para prospecção com IA."
                : order.result_count === 0
                  ? "Nenhum CNPJ foi encontrado nesta busca. O resultado fica disponível sem cobrança."
                  : "A lista completa pode ser comprada agora a partir desta pesquisa já salva no dashboard."}
            </p>

            <div className="stack-xs">
              {orderUnlocked ? (
                <>
                  <Link href={`/orders/${order.access_token}`} className="button button-lg full">
                    Abrir lista liberada
                  </Link>
                  <a href={`/orders/${order.access_token}/download`} className="button-secondary full">
                    Baixar XLSX
                  </a>
                </>
              ) : order.result_count === 0 ? (
                <Link href={`/orders/${order.access_token}`} className="button button-lg full">
                  Ver resultado vazio
                </Link>
              ) : (
                <Link
                  href={`/checkout/${order.id}`}
                  className="button button-lg full"
                  data-analytics-event="preview_viewed"
                  data-analytics-label="Dashboard search checkout"
                >
                  Ir para a prévia de compra
                </Link>
              )}
            </div>
          </aside>
        </section>
      ) : (
        <div className="notice warning" role="alert">
          {orderErrorMessage || "Não foi possível preparar o pedido comercial desta busca."}
        </div>
      )}

      {isMapView ? null : !rows || rows.length === 0 ? (
        <EmptyState
          title="Nenhum estabelecimento retornado"
          description="Tente outro recorte de CNAEs ou ajuste a região da busca. O resultado continua salvo no dashboard para você revisar depois."
          ctaHref="/dashboard/search"
          ctaLabel="Voltar ao formulário"
        />
      ) : (
        <section className="section" aria-labelledby="sample-title">
          <div className="section-header">
            <span className="eyebrow">{orderUnlocked ? "Estabelecimentos" : "Amostra da lista"}</span>
            <h2 id="sample-title" className="title-2">
              {orderUnlocked ? `${unlockedRows.length} empresas liberadas` : "Uma prévia do que você recebe"}
            </h2>
            <p className="section-copy">
              {orderUnlocked
                ? "Navegue pelos estabelecimentos encontrados, abra a ficha completa, salve os melhores na carteira e siga para exportação."
                : "No dashboard exibimos apenas 1 estabelecimento como amostra antes da compra. A lista completa é liberada após o pagamento."}
            </p>
          </div>

          {!orderUnlocked && hiddenResultsCount > 0 ? (
            <div className="notice info">
              Você está vendo 1 estabelecimento de amostra. Os outros {hiddenResultsCount} registro(s) serão liberados após o pagamento da lista.
            </div>
          ) : null}

          <CompanyResultsTable
            items={listItems}
            variant="dashboard"
            caption={`Empresas da busca: ${summary.headline}`}
            showCompanyLink
            saveSelectionAction={saveSelectedEstablishmentsAction}
            toggleSavedAction={toggleSavedEstablishmentAction}
            csvFileName={`buscacnae-selecao-${id.slice(0, 8)}`}
            initialFilters={sharedFilters}
            syncFiltersToUrl
            mapHrefBase={`/dashboard/search/${id}?view=mapa`}
          />
        </section>
      )}
    </>
  );
}

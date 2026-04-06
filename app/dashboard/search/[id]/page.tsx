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
import { formatDateTime, formatMoney } from "@/lib/format";
import { getAiFormattingPriceCents } from "@/lib/env";
import { getSearchSummary } from "@/lib/search-summary";
import { extractSingleObject } from "@/lib/utils";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";

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

function buildLeadQualityLabel(establishment: Record<string, unknown>) {
  const hasEmail = typeof establishment.email === "string" && establishment.email.trim().length > 0;
  const hasPhone = typeof establishment.phone === "string" && establishment.phone.trim().length > 0;
  const hasAddress = typeof establishment.address_line === "string" && establishment.address_line.trim().length > 0;

  if (hasEmail && hasPhone && hasAddress) {
    return { label: "Lead completo", tone: "success" } as const;
  }

  if (hasEmail) {
    return { label: "Com e-mail", tone: "default" } as const;
  }

  if (hasPhone) {
    return { label: "Com telefone", tone: "default" } as const;
  }

  return { label: "Cadastro básico", tone: "warning" } as const;
}

function buildAvailabilityBadges(establishment: Record<string, unknown>) {
  return [
    {
      label: "Telefone",
      available: typeof establishment.phone === "string" && establishment.phone.trim().length > 0
    },
    {
      label: "E-mail",
      available: typeof establishment.email === "string" && establishment.email.trim().length > 0
    },
    {
      label: "Endereço",
      available: typeof establishment.address_line === "string" && establishment.address_line.trim().length > 0
    }
  ];
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
  const rowItems = (rows ?? [])
    .map((row) => {
      const establishment = extractSingleObject(row.establishments);
      if (!establishment) return null;
      return { row, establishment };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const rowsWithPhone = rowItems.filter((item) => typeof item.establishment.phone === "string" && item.establishment.phone.trim().length > 0).length;
  const rowsWithEmail = rowItems.filter((item) => typeof item.establishment.email === "string" && item.establishment.email.trim().length > 0).length;
  const rowsWithAddress = rowItems.filter((item) => typeof item.establishment.address_line === "string" && item.establishment.address_line.trim().length > 0).length;

  return (
    <div className="stack">
      {aiFormatMessage ? <div className={`notice ${aiFormatMessage.type}`}>{aiFormatMessage.text}</div> : null}

      <div className="panel-grid two dashboard-result-grid">
        <div className="surface-premium card-lg stack dashboard-result-summary-card">
          <div className="inline-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">Resultado da busca</span>
              <h2 className="section-title" style={{ marginBottom: 0 }}>
                {summary.headline}
              </h2>
              <span className="muted">
                {search.data.total_results} resultados · {search.data.cached ? "cache" : "consulta nova"} · {formatDateTime(search.data.created_at)}
              </span>
            </div>
            <Link href="/dashboard/search" className="button-ghost">
              Nova busca
            </Link>
          </div>

          <p className="section-copy">
            Este resumo foi redesenhado para deixar a decisão de compra mais rápida: recorte, volume, qualidade do lote e rota de desbloqueio ficam visíveis na mesma área.
          </p>

          <div className="checkout-stat-grid dashboard-checkout-stat-grid">
            <div className="checkout-stat-card">
              <span className="kicker">Empresas retornadas</span>
              <strong>{search.data.total_results}</strong>
              <span className="muted">Volume total do lote encontrado.</span>
            </div>
            <div className="checkout-stat-card">
              <span className="kicker">Com telefone</span>
              <strong>{rowsWithPhone}</strong>
              <span className="muted">Registros com contato telefônico disponível.</span>
            </div>
            <div className="checkout-stat-card">
              <span className="kicker">Com e-mail</span>
              <strong>{rowsWithEmail}</strong>
              <span className="muted">Registros com e-mail disponível.</span>
            </div>
            <div className="checkout-stat-card">
              <span className="kicker">Com endereço</span>
              <strong>{rowsWithAddress}</strong>
              <span className="muted">Registros com endereço preenchido.</span>
            </div>
          </div>

          <div className="result-summary-grid">
            <div className="result-summary-card">
              <span className="kicker">CNAEs do recorte</span>
              <strong>{summary.cnaeText}</strong>
              <span className="muted">A atividade econômica usada para montar esta busca.</span>
            </div>
            <div className="result-summary-card">
              <span className="kicker">Abrangência geográfica</span>
              <strong>{summary.locationText}</strong>
              <span className="muted">A área selecionada para a pesquisa comercial.</span>
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

        <div className="surface-premium card-lg stack dashboard-result-offer-card">
          <span className="eyebrow">Compra da lista</span>

          {order ? (
            <>
              <div className="checkout-stat-grid">
                <div className="checkout-stat-card">
                  <span className="kicker">Leads encontrados</span>
                  <strong>{order.result_count}</strong>
                  <span className="muted">Quantidade pronta para desbloqueio.</span>
                </div>
                <div className="checkout-stat-card">
                  <span className="kicker">Total do lote</span>
                  <strong>{formatMoney(order.total_amount_cents / 100)}</strong>
                  <span className="muted">Cobrança calculada pela composição real dos contatos.</span>
                </div>
              </div>

              {pricingSummary ? <LeadPricingBreakdown summary={pricingSummary} /> : null}

              <div className="checkout-action-panel">
                <div className="stack" style={{ gap: 6 }}>
                  <span className="kicker">Status da lista</span>
                  <strong>
                    {orderUnlocked
                      ? "Lista já liberada"
                      : order.result_count === 0
                        ? "Resultado liberado sem cobrança"
                        : "Lista pronta para compra"}
                  </strong>
                  <span className="muted">
                    {orderUnlocked
                      ? "Abra a lista completa ou faça o download do XLSX agora mesmo."
                      : order.result_count === 0
                        ? "Nenhum CNPJ foi encontrado nesta busca, então o resultado está disponível sem pagamento."
                        : "Você já viu o volume e a composição do lote. Agora é só concluir o checkout para liberar a lista."}
                  </span>
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
                    <Link href={`/checkout/${order.id}`} className="button button-lg">
                      Revisar e pagar agora
                    </Link>
                  )}
                </div>
              </div>

              {orderUnlocked && (rowItems.length ?? 0) > 0 ? (
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
                      ? "A organização por IA desta lista já foi contratada. Ao clicar em um dos downloads, o sistema gera um XLSX estruturado com quatro abas e um PDF em formato de ficha cadastral."
                      : "Ao contratar, esta lista recebe uma cobrança avulsa para gerar um XLSX estruturado e um PDF legível por registro."}
                  </div>

                  <div className="inline-actions">
                    {aiFormatUnlocked ? (
                      <FormattedDownloadButtons searchId={id} />
                    ) : (
                      <form action="/api/stripe/ai-format-checkout" method="POST">
                        <input type="hidden" name="searchId" value={id} />
                        <button type="submit" className="button">
                          Formatar com IA por {formatMoney(getAiFormattingPriceCents() / 100)}
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
          <div className="inline-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="eyebrow">Prévia operacional da lista</span>
              <p className="section-copy">
                O bloco abaixo foi reorganizado para facilitar a leitura comercial: posição, qualidade do lead, contexto geográfico e ações ficam visíveis sem abrir outra tela.
              </p>
            </div>
            {!orderUnlocked && order && order.result_count > 0 ? (
              <Link href={`/checkout/${order.id}`} className="button-ghost">
                Ver checkout desta lista
              </Link>
            ) : null}
          </div>

          <div className="result-card-grid">
            {rowItems.map(({ row, establishment }) => {
              const establishmentId = String(establishment.id);
              const companyName = String(establishment.company_name ?? "-");
              const tradeName = String(establishment.trade_name ?? "") || "Nome fantasia não informado";
              const cityName = String(establishment.city_name ?? "-");
              const stateCode = String(establishment.state_code ?? "-");
              const status = String(establishment.registration_status ?? "-");
              const primaryCnae = String(establishment.primary_cnae_description ?? "") || "CNAE principal não informado";
              const companySize = String(establishment.company_size ?? "") || "Porte não informado";
              const quality = buildLeadQualityLabel(establishment);
              const badges = buildAvailabilityBadges(establishment);

              return (
                <article key={establishmentId} className="result-card-premium result-card-commercial">
                  <div className="inline-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span className="result-card-index">#{row.position}</span>
                    <span className={`pill ${quality.tone === "success" ? "success" : quality.tone === "warning" ? "warning" : ""}`.trim()}>
                      {quality.label}
                    </span>
                  </div>

                  <div className="stack" style={{ gap: 6 }}>
                    <strong className="result-card-title">{companyName}</strong>
                    <span className="muted">{tradeName}</span>
                  </div>

                  <div className="result-card-meta-grid">
                    <div className="result-meta-chip">
                      <span className="kicker">Local</span>
                      <strong>{cityName}/{stateCode}</strong>
                    </div>
                    <div className="result-meta-chip">
                      <span className="kicker">Status</span>
                      <strong>{status}</strong>
                    </div>
                    <div className="result-meta-chip">
                      <span className="kicker">Porte</span>
                      <strong>{companySize}</strong>
                    </div>
                  </div>

                  <div className="result-card-highlight">
                    <span className="kicker">CNAE principal</span>
                    <strong>{primaryCnae}</strong>
                  </div>

                  <div className="availability-badge-row">
                    {badges.map((badge) => (
                      <span key={badge.label} className={`availability-badge ${badge.available ? "is-available" : ""}`}>
                        {badge.label}
                      </span>
                    ))}
                  </div>

                  <div className="inline-actions result-card-actions">
                    <Link href={`/dashboard/companies/${encodeURIComponent(String(establishment.cnpj ?? ""))}`} className="button-ghost">
                      Ver ficha
                    </Link>
                    <LeadToggleForm establishmentId={establishmentId} isSaved={savedSet.has(establishmentId)} />
                  </div>
                </article>
              );
            })}
          </div>

          {!orderUnlocked && order && order.result_count > 0 ? (
            <div className="checkout-action-panel result-bottom-cta">
              <div className="stack" style={{ gap: 6 }}>
                <span className="kicker">Pronto para liberar?</span>
                <strong>Revise o checkout e conclua a compra desta lista.</strong>
                <span className="muted">O valor já está calculado pela composição do lote encontrado nesta busca.</span>
              </div>
              <div className="inline-actions">
                <Link href={`/checkout/${order.id}`} className="button button-lg">
                  Ir para o checkout
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

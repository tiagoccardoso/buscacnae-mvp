import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchAccessOrderById } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";
import { getSearchSummary } from "@/lib/search-summary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractSingleObject } from "@/lib/utils";

type CheckoutPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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
  const checks = [
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

  return checks;
}

export default async function CheckoutPage({ params, searchParams }: CheckoutPageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const reason = typeof resolvedSearchParams.reason === "string" ? resolvedSearchParams.reason : "";
  const checkoutState = typeof resolvedSearchParams.checkout === "string" ? resolvedSearchParams.checkout : "";
  const order = await getSearchAccessOrderById(id);

  if (!order) {
    notFound();
  }

  const currentOrder = order as NonNullable<typeof order>;
  const admin = createSupabaseAdminClient();
  const [{ data: search }, { data: previewRows }] = await Promise.all([
    admin
      .from("search_queries")
      .select("cnae_code, city_name, state_code, total_results, query_payload")
      .eq("id", currentOrder.search_query_id)
      .maybeSingle(),
    admin
      .from("search_results")
      .select("position, establishment_id, establishments(*)")
      .eq("search_query_id", currentOrder.search_query_id)
      .order("position", { ascending: true })
      .limit(4)
  ]);

  const summary = getSearchSummary(search ?? {});
  const pricingSummary = readLeadPricingSummary((search?.query_payload as Record<string, unknown> | null)?.leadPricingSummary);
  const unlocked = currentOrder.status === "paid" || currentOrder.status === "free";
  const isEmpty = currentOrder.result_count === 0;

  return (
    <main className="page">
      <section className="container" style={{ maxWidth: 1180 }}>
        <div className="stack">
          <div className="surface-premium card-lg stack checkout-hero-block">
            <div className="stack" style={{ gap: 10 }}>
              <span className="eyebrow">Prévia da sua lista</span>
              <h1 className="section-title checkout-title">Veja o lote encontrado, confirme o valor e avance só se fizer sentido.</h1>
              <p className="section-copy checkout-copy">
                Esta etapa mostra o recorte da busca, a composição dos leads e o total do pedido antes do pagamento.
                A liberação da lista acontece assim que a cobrança for confirmada.
              </p>
            </div>

            <div className="inline-list">
              <span className="pill">Cobrança avulsa</span>
              <span className="pill">Sem assinatura obrigatória</span>
              <span className="pill">Pagamento seguro via Stripe</span>
              <span className="pill">Entrega online + XLSX</span>
            </div>

            {reason ? <div className="notice danger">{reason}</div> : null}
            {checkoutState === "cancelled" ? <div className="notice warning">Checkout cancelado. Seu lote continua reservado para você tentar novamente.</div> : null}
          </div>

          <div className="checkout-decision-layout">
            <div className="surface-premium card-lg stack">
              <div className="stack" style={{ gap: 8 }}>
                <span className="eyebrow">Resumo da busca</span>
                <h2 className="section-title" style={{ marginBottom: 0 }}>
                  {summary.headline}
                </h2>
                <p className="section-copy">Use este resumo para validar rapidamente se o lote encontrado está alinhado ao seu mercado alvo.</p>
              </div>

              <div className="checkout-stat-grid">
                <div className="checkout-stat-card">
                  <span className="kicker">Leads encontrados</span>
                  <strong>{currentOrder.result_count}</strong>
                  <span className="muted">Quantidade pronta para desbloqueio.</span>
                </div>
                <div className="checkout-stat-card">
                  <span className="kicker">Total do lote</span>
                  <strong>{formatMoney(currentOrder.total_amount_cents / 100)}</strong>
                  <span className="muted">Cobrança calculada pela composição real dos contatos encontrados.</span>
                </div>
                <div className="checkout-stat-card">
                  <span className="kicker">CNAEs</span>
                  <strong>{summary.cnaeText}</strong>
                  <span className="muted">Recorte de atividade selecionado.</span>
                </div>
                <div className="checkout-stat-card">
                  <span className="kicker">Abrangência</span>
                  <strong>{summary.locationText}</strong>
                  <span className="muted">Cobertura geográfica da pesquisa.</span>
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

              {pricingSummary ? <LeadPricingBreakdown summary={pricingSummary} /> : null}

              {unlocked ? (
                <div className="checkout-action-panel success">
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="kicker">Lista liberada</span>
                    <strong>Seu acesso já está ativo.</strong>
                    <span className="muted">Abra a lista completa agora ou siga para o download em XLSX.</span>
                  </div>
                  <div className="inline-actions">
                    <Link href={`/orders/${currentOrder.access_token}`} className="button">
                      Abrir lista liberada
                    </Link>
                    <Link href={`/orders/${currentOrder.access_token}/download`} className="button-ghost">
                      Baixar XLSX
                    </Link>
                  </div>
                </div>
              ) : isEmpty ? (
                <div className="checkout-action-panel success">
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="kicker">Busca sem cobrança</span>
                    <strong>Nenhum CNPJ foi encontrado neste recorte.</strong>
                    <span className="muted">Como não houve resultado, o acesso foi liberado sem pagamento.</span>
                  </div>
                  <div className="inline-actions">
                    <Link href={`/orders/${currentOrder.access_token}`} className="button">
                      Ver resultado da pesquisa
                    </Link>
                    <Link href="/" className="button-ghost">
                      Fazer nova busca
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="checkout-action-panel">
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="kicker">Próximo passo</span>
                    <strong>Libere esta lista agora.</strong>
                    <span className="muted">Você será direcionado ao ambiente seguro de pagamento para concluir a cobrança deste lote.</span>
                  </div>
                  <form action="/api/stripe/checkout" method="POST" className="stack" style={{ gap: 12 }}>
                    <input type="hidden" name="orderId" value={currentOrder.id} />
                    <button className="button full button-lg" type="submit">
                      Ir para o checkout seguro
                    </button>
                    <span className="tiny">Cobrança única referente a esta pesquisa. O acesso é liberado após a confirmação do pagamento.</span>
                  </form>
                </div>
              )}
            </div>

            <div className="checkout-sidebar stack">
              <div className="surface-premium card-lg stack checkout-trust-card">
                <span className="eyebrow">Por que esta etapa converte melhor</span>
                <div className="trust-checklist">
                  <div className="trust-check-item">
                    <strong>Você já sabe o que vai comprar</strong>
                    <span className="muted">Quantidade encontrada, composição do lote e valor total aparecem antes do pagamento.</span>
                  </div>
                  <div className="trust-check-item">
                    <strong>O risco de surpresa é menor</strong>
                    <span className="muted">A cobrança é proporcional ao tipo de lead que realmente voltou na busca.</span>
                  </div>
                  <div className="trust-check-item">
                    <strong>Entrega no mesmo fluxo</strong>
                    <span className="muted">Depois da confirmação do checkout, a lista fica acessível online e pronta para download.</span>
                  </div>
                </div>
              </div>

              <div className="surface-premium card-lg stack checkout-preview-card">
                <div className="stack" style={{ gap: 8 }}>
                  <span className="eyebrow">Amostra do lote</span>
                  <h2 className="section-title" style={{ marginBottom: 0 }}>Prévia dos primeiros resultados encontrados</h2>
                  <p className="section-copy">Veja o perfil dos registros retornados sem expor a lista completa antes da compra.</p>
                </div>

                {previewRows && previewRows.length > 0 ? (
                  <div className="checkout-preview-list">
                    {previewRows.map((row) => {
                      const establishment = extractSingleObject(row.establishments);
                      if (!establishment) return null;

                      const companyName = String(establishment.company_name ?? "-");
                      const tradeName = String(establishment.trade_name ?? "") || "Nome fantasia não informado";
                      const cityName = String(establishment.city_name ?? "-");
                      const stateCode = String(establishment.state_code ?? "-");
                      const status = String(establishment.registration_status ?? "-");
                      const quality = buildLeadQualityLabel(establishment);
                      const badges = buildAvailabilityBadges(establishment);

                      return (
                        <article key={String(row.establishment_id)} className="checkout-preview-item">
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
                          <div className="checkout-preview-meta">
                            <span><strong>Local:</strong> {cityName}/{stateCode}</span>
                            <span><strong>Status:</strong> {status}</span>
                          </div>
                          <div className="availability-badge-row">
                            {badges.map((badge) => (
                              <span key={badge.label} className={`availability-badge ${badge.available ? "is-available" : ""}`}>
                                {badge.label}
                              </span>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="notice">Nenhum item de amostra disponível para esta pesquisa.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

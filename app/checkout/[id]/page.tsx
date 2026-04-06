import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchAccessOrderById } from "@/lib/billing";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";
import { getSearchSummary } from "@/lib/search-summary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCnpj, formatMoney } from "@/lib/format";
import { canonicalizeEstablishment, mergeEstablishmentSources } from "@/lib/establishment-canonical";
import { extractLeadContactSignals } from "@/lib/lead-pricing";
import { extractSingleObject } from "@/lib/utils";

type CheckoutPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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
  const { data: search } = await admin
    .from("search_queries")
    .select("cnae_code, city_name, state_code, total_results, query_payload")
    .eq("id", currentOrder.search_query_id)
    .maybeSingle();

  const summary = getSearchSummary(search ?? {});
  const pricingSummary = readLeadPricingSummary((search?.query_payload as Record<string, unknown> | null)?.leadPricingSummary);

  const { data: rows } = await admin
    .from("search_results")
    .select("position, provider_payload, establishments(*)")
    .eq("search_query_id", currentOrder.search_query_id)
    .order("position", { ascending: true })
    .limit(6);

  const previewItems = (rows ?? [])
    .map((row) => {
      const establishment = extractSingleObject(row.establishments);
      if (!establishment) return null;
      const mergedEstablishment = mergeEstablishmentSources(establishment, extractSingleObject(row.provider_payload));
      const canonical = canonicalizeEstablishment(mergedEstablishment);
      const contactSignals = extractLeadContactSignals({
        email: canonical.email,
        phone: canonical.phone,
        provider_payload: mergedEstablishment.provider_payload
      });
      return { position: row.position, canonical, contactSignals };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const previewSummary = previewItems.reduce(
    (acc, item) => {
      if (item.contactSignals.hasEmail) acc.withEmail += 1;
      if (item.contactSignals.hasPhone) acc.withPhone += 1;
      if (item.canonical.hasAddress) acc.withAddress += 1;
      return acc;
    },
    { withEmail: 0, withPhone: 0, withAddress: 0 }
  );

  return (
    <main className="page">
      <section className="container" style={{ maxWidth: 860 }}>
        <div className="surface card stack">
          <span className="eyebrow">Pagamento da pesquisa</span>
          <h1 className="section-title" style={{ fontSize: "2.1rem", marginBottom: 0 }}>
            {summary.headline}
          </h1>
          <p className="section-copy">
            O acesso à lista completa fica disponível assim que o pagamento for confirmado.
          </p>

          {reason ? <div className="notice danger">{reason}</div> : null}
          {checkoutState === "cancelled" ? (
            <div className="notice warning">Checkout cancelado. Você pode tentar novamente.</div>
          ) : null}

          <div className="grid-2">
            <div className="surface-soft card stack">
              <span className="kicker">Leads encontrados</span>
              <strong style={{ fontSize: "2rem" }}>{currentOrder.result_count}</strong>
              <span className="muted">Lista pronta para desbloqueio.</span>
            </div>
            <div className="surface-soft card stack">
              <span className="kicker">Total a pagar</span>
              <strong style={{ fontSize: "2rem" }}>{formatMoney(currentOrder.total_amount_cents / 100)}</strong>
              <span className="muted">Cobrança automática conforme o nível de contato de cada lead encontrado.</span>
            </div>
          </div>

          {pricingSummary ? <LeadPricingBreakdown summary={pricingSummary} /> : null}

          {previewItems.length > 0 ? (
            <div className="surface-soft card stack">
              <span className="eyebrow">Prévia operacional da lista</span>
              <div className="grid-2">
                <div className="stack" style={{ gap: 6 }}>
                  <span className="kicker">Qualificação da amostra</span>
                  <span className="muted">{previewSummary.withEmail}/{previewItems.length} com e-mail · {previewSummary.withPhone}/{previewItems.length} com telefone · {previewSummary.withAddress}/{previewItems.length} com endereço</span>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <span className="kicker">Leitura consolidada</span>
                  <span className="muted">A amostra abaixo já usa a mesma consolidação da ficha cadastral completa.</span>
                </div>
              </div>
              <div className="result-card-grid">
                {previewItems.map(({ position, canonical, contactSignals }) => (
                  <article key={`${canonical.cnpj ?? position}`} className="result-card-premium">
                    <div className="result-card-index">#{position}</div>
                    <div className="stack" style={{ gap: 6 }}>
                      <strong className="result-card-title">{canonical.companyName ?? "-"}</strong>
                      <span className="muted">{canonical.tradeName ?? "Nome fantasia não informado"}</span>
                    </div>
                    <div className="result-card-meta">
                      <span><strong>CNPJ:</strong> {formatCnpj(canonical.cnpj ?? "")}</span>
                      <span><strong>Cidade:</strong> {(canonical.cityName ?? "-")}/{(canonical.stateCode ?? "-")}</span>
                      <span><strong>Status:</strong> {canonical.registrationStatus ?? "-"}</span>
                    </div>
                    <div className="inline-list">
                      <span className={`pill ${contactSignals.hasEmail ? "success" : "warning"}`}>{contactSignals.hasEmail ? "E-mail disponível" : "Sem e-mail"}</span>
                      <span className={`pill ${contactSignals.hasPhone ? "success" : "warning"}`}>{contactSignals.hasPhone ? "Telefone disponível" : "Sem telefone"}</span>
                      <span className={`pill ${canonical.hasAddress ? "success" : "warning"}`}>{canonical.hasAddress ? "Endereço disponível" : "Sem endereço"}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {currentOrder.status === "paid" || currentOrder.status === "free" ? (
            <div className="inline-actions">
              <Link href={`/orders/${currentOrder.access_token}`} className="button">
                Abrir lista liberada
              </Link>
            </div>
          ) : currentOrder.result_count === 0 ? (
            <div className="stack">
              <div className="notice success">
                Nenhum CNPJ foi encontrado nessa pesquisa, então a lista foi liberada sem cobrança.
              </div>
              <Link href={`/orders/${currentOrder.access_token}`} className="button">
                Ver resultado vazio
              </Link>
            </div>
          ) : (
            <form action="/api/stripe/checkout" method="POST" className="stack">
              <input type="hidden" name="orderId" value={currentOrder.id} />
              <button className="button full" type="submit">
                Ir para o checkout
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

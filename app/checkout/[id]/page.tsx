import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchAccessOrderById } from "@/lib/billing";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";
import { getSearchSummary } from "@/lib/search-summary";
import { createDbClient } from "@/lib/db-client";
import { getCurrentUser } from "@/lib/auth/server";
import { formatCnpj, formatMoney } from "@/lib/format";
import { canonicalizeEstablishment, mergeEstablishmentSources } from "@/lib/establishment-canonical";
import { extractLeadContactSignals } from "@/lib/lead-pricing";
import { extractSingleObject } from "@/lib/utils";
import { prepareCheckoutIdentityAction } from "./actions";

type CheckoutPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function CheckoutPage({ params, searchParams }: CheckoutPageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const reason = typeof resolvedSearchParams.reason === "string" ? resolvedSearchParams.reason : "";
  const checkoutState = typeof resolvedSearchParams.checkout === "string" ? resolvedSearchParams.checkout : "";
  const identityState = typeof resolvedSearchParams.identity === "string" ? resolvedSearchParams.identity : "";
  const order = await getSearchAccessOrderById(id);

  if (!order) {
    notFound();
  }

  const currentOrder = order as NonNullable<typeof order>;
  const user = await getCurrentUser();
  const resolvedEmail = String(user?.email ?? currentOrder.email ?? "").trim().toLowerCase();
  const needsEmailBeforeCheckout = currentOrder.status !== "paid" && currentOrder.status !== "free" && currentOrder.result_count > 0 && !resolvedEmail;

  const db = createDbClient();
  const { data: search } = await db
    .from("search_queries")
    .select("cnae_code, city_name, state_code, total_results, query_payload")
    .eq("id", currentOrder.search_query_id)
    .maybeSingle();

  const summary = getSearchSummary(search ?? {});
  const queryPayload =
    search?.query_payload && typeof search.query_payload === "object" && !Array.isArray(search.query_payload)
      ? (search.query_payload as Record<string, unknown>)
      : {};
  const fetchedResults =
    typeof queryPayload.fetchedResults === "number" && Number.isFinite(queryPayload.fetchedResults)
      ? Math.max(0, Math.trunc(queryPayload.fetchedResults))
      : null;
  const hitFetchLimit = queryPayload.hitFetchLimit === true;
  const pricingSummary = readLeadPricingSummary((search?.query_payload as Record<string, unknown> | null)?.leadPricingSummary);

  const { data: rows } = await db
    .from("search_results")
    .select("position, provider_payload, establishments(*)")
    .eq("search_query_id", currentOrder.search_query_id)
    .order("position", { ascending: true })
    .limit(6);

  const previewItems = (rows ?? [])
    .map((row) => {
      const establishment = extractSingleObject(row.establishments);
      if (!establishment) return null;
      const rowPayload = extractSingleObject(row.provider_payload);
      const mergedEstablishment = mergeEstablishmentSources(establishment, {
        ...(rowPayload ?? {}),
        provider_payload: row.provider_payload
      });
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
      if (item.contactSignals.hasEmail || item.canonical.hasEmail) acc.withEmail += 1;
      if (item.contactSignals.hasPhone || item.canonical.hasPhone) acc.withPhone += 1;
      if (item.canonical.hasAddress) acc.withAddress += 1;
      return acc;
    },
    { withEmail: 0, withPhone: 0, withAddress: 0 }
  );

  return (
    <main className="page">
      <section className="container stack" style={{ maxWidth: 980 }}>
        <div className="surface card stack">
          <span className="eyebrow">Prévia de compra</span>
          <h1 className="section-title" style={{ fontSize: "2.1rem", marginBottom: 0 }}>
            {summary.headline}
          </h1>
          <p className="section-copy">
            Confirme o volume encontrado, a composição do lote e o valor total antes de liberar a lista completa.
          </p>
          {hitFetchLimit && fetchedResults !== null ? (
            <p className="muted" style={{ marginTop: -6 }}>
              {search?.total_results ?? 0} encontrados · {fetchedResults} carregados para esta operação.
            </p>
          ) : null}

          {reason ? <div className="notice danger">{reason}</div> : null}
          {checkoutState === "cancelled" ? (
            <div className="notice warning">Checkout cancelado. Você pode revisar a prévia e tentar novamente.</div>
          ) : null}
          {identityState === "sent" ? (
            <div className="notice success">Enviamos o acesso para o seu e-mail. Agora você já pode seguir para o checkout e acompanhar a lista depois.</div>
          ) : null}

          <div className="grid-2">
            <div className="surface-soft card stack">
              <span className="kicker">Volume encontrado</span>
              <strong style={{ fontSize: "2rem" }}>{currentOrder.result_count}</strong>
              <span className="muted">Quantidade pronta para liberação.</span>
            </div>
            <div className="surface-soft card stack">
              <span className="kicker">Total do pedido</span>
              <strong style={{ fontSize: "2rem" }}>{formatMoney(currentOrder.total_amount_cents / 100)}</strong>
              <span className="muted">Cobrança conforme o tipo de lead encontrado, mostrada antes do pagamento.</span>
            </div>
          </div>

          {pricingSummary ? <LeadPricingBreakdown summary={pricingSummary} /> : null}

          <div className="grid-2 trust-grid">
            <div className="surface-soft card stack">
              <span className="eyebrow">O que está incluso</span>
              <span className="muted">Lista online liberada logo após o pagamento, download em XLSX e acesso pelo mesmo e-mail usado no checkout.</span>
            </div>
            <div className="surface-soft card stack">
              <span className="eyebrow">Pagamento</span>
              <span className="muted">Checkout seguro com Stripe. O pedido só é cobrado depois que você confirmar a compra.</span>
            </div>
          </div>

          {previewItems.length > 0 ? (
            <div className="surface-soft card stack">
              <span className="eyebrow">Amostra da lista</span>
              <div className="grid-2">
                <div className="stack" style={{ gap: 6 }}>
                  <span className="kicker">Leitura da amostra</span>
                  <span className="muted">A amostra mostra {previewItems.length} registros iniciais. Os dados disponíveis podem variar de empresa para empresa.</span>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <span className="kicker">Leitura consolidada</span>
                  <span className="muted">A amostra abaixo usa a mesma consolidação aplicada à lista completa liberada após o pagamento.</span>
                </div>
              </div>
              <div className="result-card-grid">
                {previewItems.map(({ position, canonical, contactSignals }) => {
                  const hasEmail = contactSignals.hasEmail || canonical.hasEmail;
                  const hasPhone = contactSignals.hasPhone || canonical.hasPhone;

                  return (
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
                        <span className={`pill ${hasEmail ? "success" : "warning"}`}>{hasEmail ? "E-mail disponível" : "Sem e-mail"}</span>
                        <span className={`pill ${hasPhone ? "success" : "warning"}`}>{hasPhone ? "Telefone disponível" : "Sem telefone"}</span>
                        <span className={`pill ${canonical.hasAddress ? "success" : "warning"}`}>{canonical.hasAddress ? "Endereço disponível" : "Sem endereço"}</span>
                      </div>
                    </article>
                  );
                })}
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
          ) : needsEmailBeforeCheckout ? (
            <div className="surface-soft card stack">
              <div className="stack" style={{ gap: 6 }}>
                <span className="kicker">Antes do checkout</span>
                <strong>Informe seu e-mail para continuar</strong>
                <span className="muted">Vamos enviar o acesso para você acompanhar a compra, o histórico e a lista liberada depois do pagamento.</span>
              </div>
              <form action={prepareCheckoutIdentityAction} className="stack" data-analytics-event="checkout_identity_started">
                <input type="hidden" name="orderId" value={currentOrder.id} />
                <div className="field">
                  <label htmlFor="checkout-email">E-mail para acesso e pagamento</label>
                  <input id="checkout-email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" required />
                </div>
                <button className="button full" type="submit">
                  Receber acesso e continuar
                </button>
              </form>
            </div>
          ) : (
            <form action="/api/stripe/checkout" method="POST" className="stack" data-analytics-event="checkout_cta_clicked" data-analytics-label="Checkout form">
              <input type="hidden" name="orderId" value={currentOrder.id} />
              {resolvedEmail ? <input type="hidden" name="email" value={resolvedEmail} /> : null}
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

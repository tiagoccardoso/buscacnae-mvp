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

  const isUnlocked = currentOrder.status === "paid" || currentOrder.status === "free";

  return (
    <main className="page">
      <div className="container">
        <header className="page-header enter">
          <span className="eyebrow">Prévia de compra</span>
          <h1 className="title-large">{summary.headline}</h1>
          <p className="lead">
            Confirme o volume encontrado, a composição do lote e o valor total antes de liberar a lista completa.
          </p>
          {hitFetchLimit && fetchedResults !== null ? (
            <p className="footnote">
              {search?.total_results ?? 0} encontrados · {fetchedResults} carregados para esta operação.
            </p>
          ) : null}
        </header>

        {reason || checkoutState === "cancelled" || identityState === "sent" ? (
          <div className="stack-sm page-notices">
            {reason ? <div className="notice danger" role="alert">{reason}</div> : null}
            {checkoutState === "cancelled" ? (
              <div className="notice warning">Checkout cancelado. Você pode revisar a prévia e tentar novamente.</div>
            ) : null}
            {identityState === "sent" ? (
              <div className="notice success" role="status">
                Enviamos o acesso para o seu e-mail. Agora você já pode seguir para o checkout e acompanhar a lista depois.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="order-layout section-spaced">
          <div className="stack-xl">
            {pricingSummary ? <LeadPricingBreakdown summary={pricingSummary} /> : null}

            {previewItems.length > 0 ? (
              <section className="stack-lg" aria-labelledby="checkout-sample-title">
                <div className="section-header">
                  <span className="eyebrow">Amostra da lista</span>
                  <h2 id="checkout-sample-title" className="title-2">
                    {previewItems.length} registros iniciais
                  </h2>
                  <p className="section-copy">
                    A amostra usa a mesma consolidação aplicada à lista completa liberada após o pagamento. Os dados disponíveis podem variar de empresa para empresa.
                  </p>
                  <p className="footnote">
                    Na amostra: {previewSummary.withEmail} com e-mail · {previewSummary.withPhone} com telefone · {previewSummary.withAddress} com endereço.
                  </p>
                </div>

                <div className="result-list">
                  {previewItems.map(({ position, canonical, contactSignals }) => {
                    const hasEmail = contactSignals.hasEmail || canonical.hasEmail;
                    const hasPhone = contactSignals.hasPhone || canonical.hasPhone;

                    return (
                      <article key={`${canonical.cnpj ?? position}`} className="result-item">
                        <div className="result-item-head">
                          <span className="result-item-index">#{position}</span>
                          <div className="result-item-title">
                            <strong>{canonical.companyName ?? "-"}</strong>
                            <span>{canonical.tradeName ?? "Nome fantasia não informado"}</span>
                          </div>
                        </div>
                        <dl className="result-meta">
                          <div>
                            <dt>CNPJ</dt>
                            <dd className="numeric">{formatCnpj(canonical.cnpj ?? "")}</dd>
                          </div>
                          <div>
                            <dt>Cidade</dt>
                            <dd>{(canonical.cityName ?? "-")}/{(canonical.stateCode ?? "-")}</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>{canonical.registrationStatus ?? "-"}</dd>
                          </div>
                        </dl>
                        <div className="inline-list">
                          <span className={`pill ${hasEmail ? "success" : "warning"}`}>{hasEmail ? "E-mail disponível" : "Sem e-mail"}</span>
                          <span className={`pill ${hasPhone ? "success" : "warning"}`}>{hasPhone ? "Telefone disponível" : "Sem telefone"}</span>
                          <span className={`pill ${canonical.hasAddress ? "success" : "warning"}`}>{canonical.hasAddress ? "Endereço disponível" : "Sem endereço"}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="grid-2" aria-label="Condições">
              <div className="feature feature-rule">
                <strong>O que está incluso</strong>
                <p>Lista online liberada logo após o pagamento, download em XLSX e acesso pelo mesmo e-mail usado no checkout.</p>
              </div>
              <div className="feature feature-rule">
                <strong>Pagamento</strong>
                <p>Checkout seguro com Stripe. O pedido só é cobrado depois que você confirmar a compra.</p>
              </div>
            </section>
          </div>

          <aside className="order-summary" aria-label="Resumo do pedido">
            <div className="order-total">
              <span className="kicker">Total do pedido</span>
              <span className="order-total-value">{formatMoney(currentOrder.total_amount_cents / 100)}</span>
              <span className="footnote">Cobrança conforme o tipo de lead encontrado, mostrada antes do pagamento.</span>
            </div>

            <dl className="order-lines">
              <div>
                <dt>Volume encontrado</dt>
                <dd>{currentOrder.result_count}</dd>
              </div>
              <div>
                <dt>Entrega</dt>
                <dd>Online + XLSX</dd>
              </div>
            </dl>

            {isUnlocked ? (
              <Link href={`/orders/${currentOrder.access_token}`} className="button button-lg full">
                Abrir lista liberada
              </Link>
            ) : currentOrder.result_count === 0 ? (
              <div className="stack-sm">
                <div className="notice success">
                  Nenhum CNPJ foi encontrado nessa pesquisa, então a lista foi liberada sem cobrança.
                </div>
                <Link href={`/orders/${currentOrder.access_token}`} className="button button-lg full">
                  Ver resultado vazio
                </Link>
              </div>
            ) : needsEmailBeforeCheckout ? (
              <form action={prepareCheckoutIdentityAction} className="stack-sm" data-analytics-event="checkout_identity_started">
                <input type="hidden" name="orderId" value={currentOrder.id} />
                <div className="field">
                  <label htmlFor="checkout-email">E-mail para acesso e pagamento</label>
                  <input
                    id="checkout-email"
                    name="email"
                    type="email"
                    className="input"
                    placeholder="voce@empresa.com"
                    autoComplete="email"
                    aria-describedby="checkout-email-help"
                    required
                  />
                  <span id="checkout-email-help" className="field-help">
                    Enviamos o acesso para você acompanhar a compra, o histórico e a lista liberada depois do pagamento.
                  </span>
                </div>
                <button className="button button-lg full" type="submit">
                  Receber acesso e continuar
                </button>
              </form>
            ) : (
              <form action="/api/stripe/checkout" method="POST" data-analytics-event="checkout_cta_clicked" data-analytics-label="Checkout form">
                <input type="hidden" name="orderId" value={currentOrder.id} />
                {resolvedEmail ? <input type="hidden" name="email" value={resolvedEmail} /> : null}
                <button className="button button-lg full" type="submit">
                  Ir para o checkout
                </button>
              </form>
            )}

            <p className="caption">Pagamento processado com segurança pela Stripe.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}

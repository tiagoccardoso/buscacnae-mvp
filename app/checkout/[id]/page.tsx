import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchAccessOrderById } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";
import { getSearchSummary } from "@/lib/search-summary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

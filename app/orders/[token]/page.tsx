import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSearchAccessOrderByAccessToken, syncSearchAccessOrderPaymentStatus } from "@/lib/billing";
import { createDbClient } from "@/lib/db-client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { getSearchSummary } from "@/lib/search-summary";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";
import { companyFromSearchRow, toCompanyListItem, type CompanyListItem } from "@/lib/company-model";
import { CompanyResultsTable } from "@/components/results/company-results-table";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

type OrderResultPageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrderResultPage({ params, searchParams }: OrderResultPageProps) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const checkoutState = typeof resolvedSearchParams.checkout === "string" ? resolvedSearchParams.checkout : "";
  const order = await getSearchAccessOrderByAccessToken(token);

  if (!order) {
    notFound();
  }

  const currentOrder = await syncSearchAccessOrderPaymentStatus(order as NonNullable<typeof order>);
  const db = createDbClient();
  const { data: search } = await db
    .from("search_queries")
    .select("*")
    .eq("id", currentOrder.search_query_id)
    .maybeSingle();

  if (!search) {
    notFound();
  }

  const unlocked = currentOrder.status === "paid" || currentOrder.status === "free";

  // Linhas só são carregadas quando a lista está liberada (antes eram lidas sempre,
  // com o payload bruto completo, mesmo para pedidos pendentes).
  const { data: rows } = unlocked
    ? await db
        .from("search_results")
        .select("position, establishment_id, provider_payload, establishments(*)")
        .eq("search_query_id", currentOrder.search_query_id)
        .order("position", { ascending: true })
    : { data: [] as Array<Record<string, unknown>> };

  const listItems: CompanyListItem[] = (rows ?? [])
    .map((row) => {
      const company = companyFromSearchRow(row);
      if (!company || !company.cnpj) return null;
      return toCompanyListItem(company, { position: Number(row.position ?? 0) });
    })
    .filter((item): item is CompanyListItem => item !== null);
  const summary = getSearchSummary(search);
  const pricingSummary = readLeadPricingSummary((search.query_payload as Record<string, unknown> | null)?.leadPricingSummary);

  return (
    <main className="page">
      <div className="container">
        <header className="section-header-row enter">
          <div className="page-header">
            <span className="eyebrow">{unlocked ? "Lista liberada" : "Pedido"}</span>
            <h1 className="title-large">{summary.headline}</h1>
            <p className="footnote">
              {search.total_results} resultado(s) · pedido criado em {formatDateTime(currentOrder.created_at)} · {formatMoney(currentOrder.total_amount_cents / 100)}
            </p>
          </div>
          <span className={`pill ${unlocked ? "success" : "warning"}`}>
            {unlocked ? "Lista liberada" : "Aguardando pagamento"}
          </span>
        </header>

        {!unlocked ? (
          <section className="section section-spaced" aria-label="Pagamento pendente">
            <div className="stack-sm">
              {checkoutState === "success" ? (
                <div className="notice info" role="status">
                  O checkout retornou com sucesso, mas o webhook ainda pode estar confirmando o pagamento. Atualize esta página em alguns segundos.
                </div>
              ) : null}
              <div className="notice warning">
                A lista só fica visível depois que o pagamento do checkout for confirmado.
              </div>
            </div>
            <div className="cluster">
              <Link href={`/checkout/${currentOrder.id}`} className="button">
                Voltar ao pagamento
              </Link>
            </div>
            {pricingSummary ? <LeadPricingBreakdown summary={pricingSummary} /> : null}
          </section>
        ) : (
          <>
            <section className="section section-spaced tile" aria-labelledby="delivery-title">
              <div className="cta-band">
                <div className="section-header">
                  <span className="eyebrow">Entrega liberada</span>
                  <h2 id="delivery-title" className="title-2">Sua lista está pronta.</h2>
                  <p className="section-copy">Formato disponível para download: XLSX.</p>
                </div>
                <div className="cluster">
                  <a href={`/orders/${token}/download`} className="button button-lg" data-analytics-event="payment_completed" data-analytics-label="Order XLSX">
                    Baixar XLSX
                  </a>
                  <Link href={`/?reuse=${currentOrder.search_query_id}`} className="button-ghost" data-analytics-event="search_reused" data-analytics-label="Order repeat search">
                    Repetir busca
                  </Link>
                </div>
              </div>
            </section>

            {pricingSummary ? (
              <section className="section section-spaced" aria-label="Composição do pedido">
                <LeadPricingBreakdown summary={pricingSummary} />
              </section>
            ) : null}

            <section className="section section-spaced" aria-labelledby="order-rows-title">
              <div className="section-header">
                <span className="eyebrow">Estabelecimentos</span>
                <h2 id="order-rows-title" className="title-2">
                  {listItems.length > 0 ? `${listItems.length} empresas na lista` : "Nenhuma empresa na lista"}
                </h2>
              </div>

              {listItems.length > 0 ? (
                <CompanyResultsTable
                  items={listItems}
                  variant="order"
                  caption="Estabelecimentos da lista liberada"
                  csvFileName={`buscacnae-lista-${currentOrder.id.slice(0, 8)}`}
                />
              ) : (
                <div className="notice success">Nenhum estabelecimento foi encontrado para esse filtro.</div>
              )}
            </section>
          </>
        )}

        <section className="section section-spaced tile" aria-labelledby="order-next-title">
          <div className="cta-band">
            <div className="section-header">
              <span className="eyebrow">Próxima ação</span>
              <h2 id="order-next-title" className="title-2">Organize e repita o que funcionou.</h2>
              <p className="section-copy">
                Quer guardar histórico, reabrir listas anteriores, salvar leads e repetir filtros? Use o dashboard para manter a operação organizada.
              </p>
            </div>
            <div className="cluster">
              <Link href="/dashboard" className="button-secondary" data-analytics-event="dashboard_opened" data-analytics-label="Order dashboard">
                Abrir dashboard
              </Link>
              <Link href="/" className="button-ghost">
                Fazer nova pesquisa
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

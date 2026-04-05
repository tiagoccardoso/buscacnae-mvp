import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EstablishmentDetails } from "@/components/establishment-details";
import { getSearchAccessOrderByAccessToken, syncSearchAccessOrderPaymentStatus } from "@/lib/billing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCnpj, formatDateTime, formatMoney } from "@/lib/format";
import { getSearchSummary } from "@/lib/search-summary";
import { extractSingleObject } from "@/lib/utils";
import { readLeadPricingSummary } from "@/lib/lead-pricing";
import { LeadPricingBreakdown } from "@/components/lead-pricing-breakdown";

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
  const admin = createSupabaseAdminClient();
  const { data: search } = await admin
    .from("search_queries")
    .select("*")
    .eq("id", currentOrder.search_query_id)
    .maybeSingle();

  if (!search) {
    notFound();
  }

  const { data: rows } = await admin
    .from("search_results")
    .select("position, establishment_id, establishments(*)")
    .eq("search_query_id", currentOrder.search_query_id)
    .order("position", { ascending: true });

  const unlocked = currentOrder.status === "paid" || currentOrder.status === "free";
  const summary = getSearchSummary(search);
  const pricingSummary = readLeadPricingSummary((search.query_payload as Record<string, unknown> | null)?.leadPricingSummary);

  return (
    <main className="page">
      <section className="container stack">
        <div className="surface card stack">
          <div className="inline-actions" style={{ justifyContent: "space-between" }}>
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">Resultado da pesquisa</span>
              <h1 className="section-title" style={{ marginBottom: 0 }}>
                {summary.headline}
              </h1>
              <span className="muted">
                {search.total_results} resultado(s) · pedido criado em {formatDateTime(currentOrder.created_at)}
              </span>
            </div>
            <div className="stack" style={{ justifyItems: "end", gap: 8 }}>
              <span className={`pill ${unlocked ? "success" : "warning"}`}>
                {unlocked ? "Lista liberada" : "Aguardando pagamento"}
              </span>
              <span className="muted">Valor: {formatMoney(currentOrder.total_amount_cents / 100)}</span>
            </div>
          </div>

          {pricingSummary ? <LeadPricingBreakdown summary={pricingSummary} /> : null}

          {!unlocked ? (
            <>
              {checkoutState === "success" ? (
                <div className="notice warning">
                  O checkout retornou com sucesso, mas o webhook ainda pode estar confirmando o pagamento.
                  Atualize esta página em alguns segundos.
                </div>
              ) : null}
              <div className="notice warning">
                A lista só fica visível depois que o pagamento do checkout for confirmado.
              </div>
              <div className="inline-actions">
                <Link href={`/checkout/${currentOrder.id}`} className="button">
                  Voltar ao pagamento
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="inline-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="stack" style={{ gap: 6 }}>
                  <span className="kicker">Entrega liberada</span>
                  <span className="muted">Formato disponível para download: XLSX.</span>
                </div>
                <div className="inline-actions">
                  <Link href={`/orders/${token}/download`} className="button">
                    Baixar XLSX
                  </Link>
                  <Link href="/" className="button-ghost">
                    Fazer nova consulta
                  </Link>
                </div>
              </div>

              {rows && rows.length > 0 ? (
                <div className="stack">
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Empresa</th>
                          <th>CNPJ</th>
                          <th>Cidade</th>
                          <th>Contato</th>
                          <th>Endereço</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const establishment = extractSingleObject(row.establishments);
                          if (!establishment) return null;

                          return (
                            <Fragment key={String(row.establishment_id)}>
                              <tr key={String(row.establishment_id)}>
                                <td>{row.position}</td>
                                <td>
                                  <div className="stack" style={{ gap: 6 }}>
                                    <strong>{String(establishment.company_name ?? "-")}</strong>
                                    <span className="muted">{String(establishment.trade_name ?? "")}</span>
                                  </div>
                                </td>
                                <td>{formatCnpj(String(establishment.cnpj ?? ""))}</td>
                                <td>
                                  {String(establishment.city_name ?? "-")}/{String(establishment.state_code ?? "-")}
                                </td>
                                <td>
                                  <div className="stack" style={{ gap: 6 }}>
                                    <span className="muted">{String(establishment.phone ?? "-")}</span>
                                    <span className="muted">{String(establishment.email ?? "-")}</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="stack" style={{ gap: 6 }}>
                                    <span className="muted">{String(establishment.address_line ?? "-")}</span>
                                    <span className="muted">{String(establishment.neighborhood ?? "-")}</span>
                                  </div>
                                </td>
                                <td>{String(establishment.registration_status ?? "-")}</td>
                              </tr>
                              <tr key={`${String(row.establishment_id)}-details`}>
                                <td colSpan={7}>
                                  <details>
                                    <summary>Ver todos os campos consolidados</summary>
                                    <div style={{ marginTop: 16 }}>
                                      <EstablishmentDetails establishment={establishment} />
                                    </div>
                                  </details>
                                </td>
                              </tr>
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="notice success">Nenhum estabelecimento foi encontrado para esse filtro.</div>
              )}
            </>
          )}
        </div>

        <div className="surface card stack">
          <span className="eyebrow">Dashboard opcional</span>
          <p className="section-copy">
            Quer acompanhar histórico, volume comprado e pesquisas anteriores? Entre no dashboard e
            faça as próximas consultas autenticado.
          </p>
          <div className="inline-actions">
            <Link href="/sign-in" className="button-secondary">
              Entrar para acompanhar histórico
            </Link>
            <Link href="/" className="button-ghost">
              Fazer nova consulta
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

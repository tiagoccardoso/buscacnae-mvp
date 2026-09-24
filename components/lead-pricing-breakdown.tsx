import { formatMoney } from "@/lib/format";
import type { LeadPricingSummary } from "@/lib/lead-pricing";
import { getMinimumCheckoutAmountCents } from "@/lib/env";

export function LeadPricingBreakdown({ summary }: { summary: LeadPricingSummary }) {
  const subtotalFromTiers = summary.tiers.reduce((sum, tier) => sum + tier.subtotalAmountCents, 0);
  const minimumAmountCents = getMinimumCheckoutAmountCents();
  const appliedMinimumAmountCents = summary.totalAmountCents > subtotalFromTiers ? summary.totalAmountCents - subtotalFromTiers : 0;

  return (
    <section className="stack-lg" aria-labelledby="lead-pricing-breakdown-title">
      <div className="section-header">
        <span className="eyebrow">Composição do lote</span>
        <h2 id="lead-pricing-breakdown-title" className="title-2">
          Como o valor foi formado
        </h2>
        <p className="section-copy">
          Quantos registros vieram em cada tipo de lead e o subtotal de cada faixa, antes de concluir a compra.
        </p>
      </div>

      <div className="table-wrap">
        <table className="table breakdown-table">
          <thead>
            <tr>
              <th scope="col">Tipo de lead</th>
              <th scope="col" className="cell-num">Leads</th>
              <th scope="col" className="cell-num cell-hide-sm">Preço por lead</th>
              <th scope="col" className="cell-num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {summary.tiers.map((tier) => (
              <tr key={tier.key}>
                <td>
                  <span className="cell-strong">{tier.label}</span>
                  <span className="breakdown-helper show-sm">{formatMoney(tier.unitAmountCents / 100)} por lead</span>
                  <span className="breakdown-helper">{tier.helperText}</span>
                </td>
                <td className="cell-num">{tier.count}</td>
                <td className="cell-num cell-hide-sm">{formatMoney(tier.unitAmountCents / 100)}</td>
                <td className="cell-num">{formatMoney(tier.subtotalAmountCents / 100)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="cell-num">{summary.totalLeads}</td>
              <td className="cell-num cell-hide-sm subtle">—</td>
              <td className="cell-num">{formatMoney(subtotalFromTiers / 100)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="footnote">
        Total para pagamento: <strong>{formatMoney(summary.totalAmountCents / 100)}</strong>.
        {appliedMinimumAmountCents > 0 ? <> Foi aplicado o mínimo operacional do checkout, hoje em {formatMoney(minimumAmountCents / 100)}.</> : null}
      </p>
    </section>
  );
}

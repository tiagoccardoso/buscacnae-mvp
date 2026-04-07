import { formatMoney } from "@/lib/format";
import type { LeadPricingSummary } from "@/lib/lead-pricing";
import { getMinimumCheckoutAmountCents } from "@/lib/env";

export function LeadPricingBreakdown({ summary }: { summary: LeadPricingSummary }) {
  const subtotalFromTiers = summary.tiers.reduce((sum, tier) => sum + tier.subtotalAmountCents, 0);
  const minimumAmountCents = getMinimumCheckoutAmountCents();
  const appliedMinimumAmountCents = summary.totalAmountCents > subtotalFromTiers ? summary.totalAmountCents - subtotalFromTiers : 0;

  return (
    <div className="stack pricing-breakdown-shell" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">Composição do lote</span>
        <p className="section-copy">
          Veja quantos registros vieram em cada tipo de lead e como o valor total foi formado antes de concluir a compra.
        </p>
      </div>

      <div className="pricing-breakdown-grid">
        {summary.tiers.map((tier) => (
          <div key={tier.key} className="pricing-breakdown-card surface-soft card stack" style={{ gap: 8 }}>
            <span className="kicker">{tier.label}</span>
            <strong className="pricing-breakdown-value">{tier.count}</strong>
            <span className="muted">
              {formatMoney(tier.unitAmountCents / 100)} por lead · subtotal de {formatMoney(tier.subtotalAmountCents / 100)}
            </span>
            <span className="tiny">{tier.helperText}</span>
          </div>
        ))}
      </div>

      <div className="notice pricing-breakdown-total">
        <strong>Total encontrado:</strong> {summary.totalLeads} lead(s). <strong>Subtotal por composição:</strong> {formatMoney(subtotalFromTiers / 100)}. <strong>Total para pagamento:</strong> {formatMoney(summary.totalAmountCents / 100)}.
        {appliedMinimumAmountCents > 0 ? <> Foi aplicado o mínimo operacional do checkout, hoje em {formatMoney(minimumAmountCents / 100)}.</> : null}
      </div>
    </div>
  );
}

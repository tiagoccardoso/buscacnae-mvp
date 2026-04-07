import Link from "next/link";
import { commercialFaqItems } from "@/lib/site-content";

type CommercialFaqProps = {
  compact?: boolean;
  limit?: number;
};

export function CommercialFaq({ compact = false, limit }: CommercialFaqProps) {
  const items = typeof limit === "number" ? commercialFaqItems.slice(0, limit) : commercialFaqItems;

  return (
    <section className="surface-premium card-lg stack faq-shell">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">FAQ comercial</span>
        <h2 className="section-title">Perguntas que reduzem dúvida antes da compra</h2>
        <p className="section-copy">
          Preço, entrega, dados, login e recompra explicados em linguagem direta.
        </p>
      </div>

      <div className={compact ? "grid-2 faq-grid" : "grid-3 faq-grid"}>
        {items.map((item) => (
          <article key={item.question} className="signal-card faq-card">
            <strong>{item.question}</strong>
            <span className="muted">{item.answer}</span>
          </article>
        ))}
      </div>

      {limit ? (
        <div className="inline-actions">
          <Link href="/faq" className="button-ghost">
            Ver FAQ completo
          </Link>
        </div>
      ) : null}
    </section>
  );
}

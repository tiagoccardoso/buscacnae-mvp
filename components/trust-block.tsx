import Link from "next/link";
import { trustItems } from "@/lib/site-content";

export function TrustBlock() {
  return (
    <section className="surface-premium card-lg stack">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Confiança e clareza</span>
        <h2 className="section-title">O que o produto deixa claro antes da compra</h2>
        <p className="section-copy">
          Menos promessa vaga e mais informação prática para decidir se o lote faz sentido para a sua operação.
        </p>
      </div>

      <div className="grid-2 trust-grid">
        {trustItems.map((item) => (
          <article key={item.title} className="signal-card faq-card">
            <strong>{item.title}</strong>
            <span className="muted">{item.copy}</span>
          </article>
        ))}
      </div>

      <div className="inline-actions">
        <Link href="/dados" className="button-ghost">
          Entender os dados
        </Link>
        <Link href="/faq" className="button-secondary">
          Ver FAQ comercial
        </Link>
      </div>
    </section>
  );
}

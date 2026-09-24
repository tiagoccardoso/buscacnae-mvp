import Link from "next/link";
import { trustItems } from "@/lib/site-content";
import { SectionHeader } from "@/components/ui/section-header";

export function TrustBlock() {
  return (
    <section className="section section-spaced" aria-labelledby="trust-title">
      <SectionHeader
        id="trust-title"
        eyebrow="Confiança e clareza"
        title="O que o produto deixa claro antes da compra"
        copy="Menos promessa vaga e mais informação prática para decidir se o lote faz sentido para a sua operação."
      />

      <div className="grid-2">
        {trustItems.map((item) => (
          <article key={item.title} className="feature feature-rule">
            <strong>{item.title}</strong>
            <p>{item.copy}</p>
          </article>
        ))}
      </div>

      <div className="cluster">
        <Link href="/dados" className="button-secondary">
          Entender os dados
        </Link>
        <Link href="/faq" className="button-ghost">
          Ver FAQ comercial
        </Link>
      </div>
    </section>
  );
}

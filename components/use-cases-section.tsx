import Link from "next/link";
import { useCasePages } from "@/lib/site-content";

export function UseCasesSection() {
  return (
    <section className="surface-premium card-lg stack">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Casos de uso</span>
        <h2 className="section-title">Entradas de aquisição por intenção</h2>
        <p className="section-copy">
          Páginas pensadas para tráfego orgânico, mídia paga e segmentação comercial sem inflar a mensagem do produto.
        </p>
      </div>

      <div className="grid-3 responsive-feature-grid">
        {useCasePages.slice(0, 4).map((item) => (
          <article key={item.slug} className="surface-soft card stack use-case-card">
            <span className="eyebrow">{item.menuLabel}</span>
            <strong>{item.title}</strong>
            <span className="muted">{item.description}</span>
            <Link href={`/solucoes/${item.slug}`} className="button-ghost">
              Ver página
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

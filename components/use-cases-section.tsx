import Link from "next/link";
import { useCasePages } from "@/lib/site-content";
import { SectionHeader } from "@/components/ui/section-header";

export function UseCasesSection() {
  return (
    <section className="section section-spaced" aria-labelledby="use-cases-title">
      <SectionHeader
        id="use-cases-title"
        eyebrow="Casos de uso"
        title="Entradas de aquisição por intenção"
        copy="Páginas pensadas para tráfego orgânico, mídia paga e segmentação comercial sem inflar a mensagem do produto."
      />

      <div className="grid-auto">
        {useCasePages.slice(0, 4).map((item) => (
          <Link key={item.slug} href={`/solucoes/${item.slug}`} className="link-card">
            <span className="kicker">{item.menuLabel}</span>
            <strong>{item.title}</strong>
            <p>{item.description}</p>
            <span className="link-card-cta">Ver página</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

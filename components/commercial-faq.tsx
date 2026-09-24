import Link from "next/link";
import { commercialFaqItems } from "@/lib/site-content";
import { SectionHeader } from "@/components/ui/section-header";

type CommercialFaqProps = {
  compact?: boolean;
  limit?: number;
  showHeader?: boolean;
};

export function CommercialFaq({ compact = false, limit, showHeader = true }: CommercialFaqProps) {
  const items = typeof limit === "number" ? commercialFaqItems.slice(0, limit) : commercialFaqItems;

  return (
    <section className={`section${compact ? "" : " section-spaced"}`} aria-labelledby={showHeader ? "faq-title" : undefined} aria-label={showHeader ? undefined : "Perguntas frequentes"}>
      {showHeader ? (
        <SectionHeader
          id="faq-title"
          eyebrow="FAQ comercial"
          title="Perguntas que reduzem dúvida antes da compra"
          copy="Preço, entrega, dados, login e recompra explicados em linguagem direta."
        />
      ) : null}

      <div className="disclosure-list">
        {items.map((item) => (
          <details key={item.question} className="disclosure">
            <summary>{item.question}</summary>
            <p className="disclosure-body">{item.answer}</p>
          </details>
        ))}
      </div>

      {limit ? (
        <div className="cluster">
          <Link href="/faq" className="button-ghost">
            Ver FAQ completo
          </Link>
        </div>
      ) : null}
    </section>
  );
}

import Link from "next/link";
import { DeliveryPreview } from "@/components/delivery-preview";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { buildPageMetadata } from "@/lib/seo";
import { minimumCheckoutAmount, pricingTiers } from "@/lib/site-content";

export const metadata = buildPageMetadata({
  title: "Preços por composição da lista",
  description: "Entenda como o preço da lista é calculado pela composição do lote encontrado, com prévia antes do pagamento e mínimo operacional por pedido.",
  path: "/pricing",
  keywords: ["preço lista b2b", "pricing leads por cnae", "comprar lista de empresas", "valor por lead"]
});

const sampleCounts = {
  basic: 40,
  phone: 20,
  email: 10,
  complete: 5
};

const exampleTotal = pricingTiers.reduce((sum, tier) => {
  const count = sampleCounts[tier.key];
  return sum + count * tier.unitAmountCents;
}, 0);

export default function PricingPage() {
  return (
    <main className="page">
      <div className="container">
        <PageHeader
          eyebrow="Preço por composição da lista"
          title="Veja o preço antes do pagamento e pague pela composição real da lista."
          lead="A pesquisa é pública. Você informa os filtros, o sistema calcula a composição do lote encontrado e mostra o total do pedido antes do checkout."
          actions={
            <>
              <Link href="/" className="button" data-analytics-event="search_entry_clicked" data-analytics-label="Pricing hero pesquisa">
                Fazer uma pesquisa
              </Link>
              <Link href="/faq" className="button-ghost">
                Ver FAQ comercial
              </Link>
            </>
          }
        />

        <section className="section section-spaced" aria-labelledby="tiers-title">
          <h2 id="tiers-title" className="sr-only">Preço por tipo de lead</h2>
          <div className="tier-grid">
            {pricingTiers.map((tier) => (
              <article key={tier.key} className="tier">
                <span className="kicker">{tier.label}</span>
                <p className="tier-price">
                  {tier.formattedUnitPrice}
                  <small>por lead</small>
                </p>
                <p>{tier.helperText}</p>
              </article>
            ))}
          </div>
          <div className="cluster">
            <span className="pill">Compra avulsa</span>
            <span className="pill">Prévia com valor</span>
            <span className="pill">Dashboard opcional</span>
            <span className="pill">Mínimo operacional {minimumCheckoutAmount}</span>
          </div>
        </section>

        <section className="section section-spaced split" aria-labelledby="example-title">
          <SectionHeader
            id="example-title"
            eyebrow="Exemplo de composição"
            title="40 base + 20 contato + 10 contato plus + 5 completos"
            copy="A composição final sempre depende do que a busca retornar."
          />
          <div className="tile stack-xs">
            <span className="kicker">Total do exemplo</span>
            <p className="order-total-value">R$ {(exampleTotal / 100).toFixed(2).replace(".", ",")}</p>
          </div>
        </section>

        <section className="section section-spaced" aria-labelledby="pricing-steps">
          <SectionHeader id="pricing-steps" eyebrow="Como o preço é formado" title="Três passos, nenhuma surpresa." />
          <ol className="steps">
            <li className="step">
              <strong>Pesquise</strong>
              <p>Monte o recorte por CNAE, estado, cidade e filtros de CNAE e localização sem precisar criar conta primeiro.</p>
            </li>
            <li className="step">
              <strong>Veja a composição</strong>
              <p>A prévia mostra quantos registros vieram em cada faixa e qual é o valor total do pedido.</p>
            </li>
            <li className="step">
              <strong>Libere a lista</strong>
              <p>Depois do pagamento, a lista fica liberada online e pronta para download em XLSX na mesma jornada.</p>
            </li>
          </ol>
        </section>

        <section className="section section-spaced tile tile-inverse" aria-labelledby="pricing-rule">
          <div className="cta-band">
            <SectionHeader
              id="pricing-rule"
              eyebrow="Regra comercial"
              title="O preço é calculado pela composição do lote, não por plano."
              copy={`Quando houver resultados, o checkout aplica o valor da composição real do lote e respeita mínimo operacional de ${minimumCheckoutAmount}. Se a busca não encontrar registros, não há cobrança.`}
            />
            <Link href="/" className="button button-lg" data-analytics-event="search_entry_clicked" data-analytics-label="Pricing fazer pesquisa">
              Fazer uma pesquisa agora
            </Link>
          </div>
        </section>

        <DeliveryPreview />
      </div>
    </main>
  );
}

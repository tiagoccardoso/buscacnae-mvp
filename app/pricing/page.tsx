import Link from "next/link";
import { DeliveryPreview } from "@/components/delivery-preview";
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
      <section className="container stack">
        <div className="surface-premium card-lg pricing-stage">
          <div className="stack" style={{ gap: 14 }}>
            <span className="eyebrow">Preço por composição da lista</span>
            <h1 className="section-title" style={{ fontSize: "2.6rem", marginBottom: 0 }}>
              Veja o preço antes do pagamento e pague de acordo com a composição real da lista.
            </h1>
            <p className="section-copy">
              A pesquisa é pública. Você informa os filtros, o sistema calcula a composição do lote encontrado e mostra o total do pedido antes do checkout.
            </p>
            <div className="inline-list">
              <span className="pill">Compra avulsa</span>
              <span className="pill">Prévia com valor</span>
              <span className="pill">Dashboard opcional</span>
              <span className="pill">Mínimo operacional {minimumCheckoutAmount}</span>
            </div>
          </div>

          <div className="pricing-display-card stack" style={{ gap: 10 }}>
            <span className="kicker">Exemplo de composição</span>
            <strong>40 base + 20 contato + 10 contato plus + 5 completos</strong>
            <span className="muted">Total do exemplo: R$ {(exampleTotal / 100).toFixed(2).replace(".", ",")}. A composição final sempre depende do que a busca retornar.</span>
          </div>
        </div>

        <div className="pricing-grid">
          {pricingTiers.map((tier) => (
            <div key={tier.key} className="surface-premium card stack pricing-card">
              <span className="eyebrow">{tier.label}</span>
              <strong className="price">{tier.formattedUnitPrice}</strong>
              <p className="section-copy">{tier.helperText}</p>
            </div>
          ))}
        </div>

        <div className="grid-3 responsive-feature-grid">
          <div className="surface-premium card stack">
            <span className="eyebrow">1. Pesquise</span>
            <p className="section-copy">Monte o recorte por CNAE, estado, cidade e filtros de CNAE e localização sem precisar criar conta primeiro.</p>
          </div>
          <div className="surface-premium card stack">
            <span className="eyebrow">2. Veja a composição</span>
            <p className="section-copy">A prévia mostra quantos registros vieram em cada faixa e qual é o valor total do pedido.</p>
          </div>
          <div className="surface-premium card stack">
            <span className="eyebrow">3. Libere a lista</span>
            <p className="section-copy">Depois do pagamento, a lista fica liberada online e pronta para download em XLSX na mesma jornada.</p>
          </div>
        </div>

        <div className="surface-premium card-lg panel-grid two">
          <div className="stack">
            <span className="eyebrow">Regra comercial</span>
            <h2 className="section-title">O preço é calculado pela composição do lote, não por plano.</h2>
            <p className="section-copy">
              Quando houver resultados, o checkout aplica o valor da composição real do lote e respeita mínimo operacional de {minimumCheckoutAmount}. Se a busca não encontrar registros, não há cobrança.
            </p>
          </div>
          <div className="inline-actions" style={{ alignItems: "flex-end", justifyContent: "flex-start" }}>
            <Link href="/" className="button" data-analytics-event="search_entry_clicked" data-analytics-label="Pricing fazer pesquisa">
              Fazer uma pesquisa agora
            </Link>
            <Link href="/faq" className="button-ghost">
              Ver FAQ comercial
            </Link>
          </div>
        </div>

        <DeliveryPreview />
      </section>
    </main>
  );
}

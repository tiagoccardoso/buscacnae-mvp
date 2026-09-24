import Link from "next/link";
import { SearchFilterBuilder } from "@/components/search-filter-builder";
import { SearchSubmitButton } from "@/components/search-submit-button";
import { SectionHeader } from "@/components/ui/section-header";
import { TrustBlock } from "@/components/trust-block";
import { DeliveryPreview } from "@/components/delivery-preview";
import { CommercialFaq } from "@/components/commercial-faq";
import { UseCasesSection } from "@/components/use-cases-section";
import { startPublicSearchAction } from "@/app/home-actions";
import { buildPageMetadata } from "@/lib/seo";
import { homeHighlights, minimumCheckoutAmount, pricingTiers } from "@/lib/site-content";
import { createDbClient } from "@/lib/db-client";
import { getSearchFilterDefaults } from "@/lib/search-filter-defaults";

export const metadata = buildPageMetadata({
  title: "Listas B2B por CNAE e região",
  description: "Pesquise empresas por CNAE, estado e cidade, veja volume e preço antes de pagar e libere a lista em XLSX após o checkout.",
  path: "/",
  keywords: [
    "lista b2b por cnae",
    "leads por cnae",
    "empresas por cnae e cidade",
    "lista de empresas por região",
    "comprar lista b2b"
  ]
});

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const journeySteps = [
  {
    title: "Pesquise",
    copy: "Selecione um ou mais CNAEs, estados e cidades para montar o recorte inicial da sua lista."
  },
  {
    title: "Ajuste o recorte",
    copy: "Combine CNAE, estado e cidade para chegar a uma lista mais alinhada ao mercado que você quer pesquisar."
  },
  {
    title: "Veja a prévia",
    copy: "A próxima tela mostra quantos registros foram encontrados e uma amostra operacional do lote."
  },
  {
    title: "Confirme o preço",
    copy: `O valor é calculado por tipo de lead encontrado, com mínimo operacional de ${minimumCheckoutAmount} quando houver resultados.`
  },
  {
    title: "Pague",
    copy: "O e-mail entra só antes do checkout, quando o acesso precisa ser enviado e a compra vai acontecer."
  },
  {
    title: "Baixe a lista",
    copy: "Depois da confirmação do pagamento, a lista fica liberada online e pronta para download em XLSX."
  }
];

const benefitCards = [
  {
    kicker: "Preço por tipo de lead",
    title: "Você sabe o que está comprando",
    copy: pricingTiers.map((tier) => `${tier.label}: ${tier.formattedUnitPrice}`).join(" · ")
  },
  {
    kicker: "Prévia real",
    title: "Volume, composição e amostra antes de pagar",
    copy: "A jornada mostra quantidade encontrada, composição do lote e uma amostra operacional antes do pagamento."
  },
  {
    kicker: "Entrega útil",
    title: "Lista pronta para uso comercial",
    copy: "Receba a lista online e no XLSX, com dados cadastrais e sinais de contato quando disponíveis."
  }
];

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : "";
  const reuse = typeof params.reuse === "string" ? params.reuse : "";

  let reuseDefaults = getSearchFilterDefaults(null);
  let reuseMessage = "";

  if (reuse) {
    const db = createDbClient();
    const { data: reusedSearch } = await db
      .from("search_queries")
      .select("query_payload")
      .eq("id", reuse)
      .maybeSingle();

    if (reusedSearch?.query_payload) {
      reuseDefaults = getSearchFilterDefaults(reusedSearch.query_payload);
      reuseMessage = "Filtros carregados a partir de uma busca anterior. Ajuste o que quiser antes de calcular novamente.";
    }
  }

  return (
    <main className="page-flush">
      <section className="hero" aria-labelledby="home-title">
        <div className="container">
          <header className="hero-header enter">
            <span className="eyebrow">Listas B2B por CNAE e região</span>
            <h1 id="home-title" className="title-hero">
              Descubra, filtre e compre listas B2B por CNAE e região.
            </h1>
            <p className="lead">
              Monte o recorte, veja o <strong>volume encontrado, a composição do lote e o valor total</strong> antes do checkout. Sem login para pesquisar.
            </p>
          </header>

          <div className="search-panel enter enter-delay-1">
            {reuseMessage ? <div className="notice success">{reuseMessage}</div> : null}
            {error ? <div className="notice danger" role="alert">{error}</div> : null}

            <form
              action={startPublicSearchAction}
              className="search-form"
              data-analytics-event="search_started"
              data-analytics-label="Home search form"
              aria-label="Pesquisa de empresas por CNAE e região"
            >
              <SearchFilterBuilder {...reuseDefaults} />

              <div className="search-submit">
                <SearchSubmitButton idleLabel="Ver volume e valor da lista" pendingLabel="Pesquisando e calculando o valor..." />
                <p className="footnote">
                  Você pesquisa primeiro. O e-mail só é pedido antes do checkout, junto com o envio do acesso para acompanhar a compra depois.
                </p>
              </div>
            </form>
          </div>

          <ul className="hero-highlights" aria-label="Destaques">
            {homeHighlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <div className="container">
        <section className="section section-spaced" aria-labelledby="home-benefits">
          <SectionHeader
            id="home-benefits"
            eyebrow="Por que BuscaCNAE"
            title="Você sabe o que está comprando antes de pagar."
            copy="Preço por tipo de lead, prévia real do lote e entrega pronta para uso comercial."
          />
          <div className="grid-3">
            {benefitCards.map((item) => (
              <article key={item.title} className="feature">
                <span className="kicker">{item.kicker}</span>
                <strong>{item.title}</strong>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section section-spaced" aria-labelledby="home-journey">
          <SectionHeader
            id="home-journey"
            eyebrow="Como funciona"
            title="Pesquise, ajuste o recorte, veja a prévia, pague e baixe a lista."
          />
          <ol className="steps">
            {journeySteps.map((step) => (
              <li key={step.title} className="step">
                <strong>{step.title}</strong>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section section-spaced tile" aria-labelledby="home-pricing">
          <div className="split">
            <SectionHeader
              id="home-pricing"
              eyebrow="Preço alinhado com o produto"
              title="Sem compra no escuro."
              copy="A prévia mostra volume, composição do lote e amostra da lista antes do checkout para a decisão ser mais previsível."
            />
            <div className="stack-lg">
              <p className="section-copy">
                A cobrança é por tipo de lead encontrado: {pricingTiers.map((tier) => `${tier.label} ${tier.formattedUnitPrice}`).join(", ")}. Quando houver resultado, o pedido respeita mínimo operacional de {minimumCheckoutAmount}.
              </p>
              <div className="cluster">
                <Link href="/pricing" className="button-secondary" data-analytics-event="pricing_viewed" data-analytics-label="Home pricing">
                  Ver preços
                </Link>
                <Link href="/dados" className="button-ghost" data-analytics-event="data_page_opened" data-analytics-label="Home dados">
                  Entender os dados
                </Link>
              </div>
            </div>
          </div>
        </section>

        <DeliveryPreview />
        <TrustBlock />
        <UseCasesSection />
        <CommercialFaq limit={6} />
      </div>
    </main>
  );
}

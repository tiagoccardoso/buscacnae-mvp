import Link from "next/link";
import { SearchFilterBuilder } from "@/components/search-filter-builder";
import { PremiumHeroStage } from "@/components/premium-hero-stage";
import { SearchImmersiveStage } from "@/components/search-immersive-stage";
import { OnboardingCorporate } from "@/components/onboarding-corporate";
import { PublicSearchSubmitButton } from "@/components/public-search-submit-button";
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
    <main className="page">
      <section className="container hero-premium-stack">
        <div className="hero-premium-copy surface-premium card-lg stack">
          <span className="eyebrow">Listas B2B por CNAE e região</span>
          <h1 className="display-title">
            <span className="gradient-text">Descubra, filtre e compre listas B2B por CNAE e região com preço transparente antes do pagamento.</span>
          </h1>
          <p className="lead-copy">
            Monte sua pesquisa por CNAE e região e avance para uma prévia com <strong>volume encontrado, composição do lote e valor total</strong> antes do checkout.
            O dashboard é opcional e entra para histórico, organização e recompra.
          </p>

          <div className="inline-list">
            {homeHighlights.map((item) => (
              <span key={item} className="pill">{item}</span>
            ))}
          </div>

          <div className="hero-signal-grid">
            {benefitCards.map((item) => (
              <div key={item.title} className="signal-card">
                <span className="kicker">{item.kicker}</span>
                <strong>{item.title}</strong>
                <span className="muted">{item.copy}</span>
              </div>
            ))}
          </div>
        </div>

        <PremiumHeroStage />
      </section>

      <section className="container immersive-search-section">
        <div className="immersive-search-layout surface-premium card-lg">
          <div className="immersive-search-form-side">
            <div className="stack immersive-search-copy" style={{ gap: 8 }}>
              <span className="eyebrow">Comece pela pesquisa</span>
              <h2 className="section-title immersive-search-title">Pesquise agora e veja se o lote vale a compra.</h2>
              <p className="section-copy">
                Combine múltiplos CNAEs, estados e cidades na mesma operação para montar um recorte claro, comparar volume e decidir com mais segurança antes da compra.
              </p>
            </div>

            {reuseMessage ? <div className="notice success">{reuseMessage}</div> : null}
            {error ? <div className="notice danger">{error}</div> : null}

            <form action={startPublicSearchAction} className="stack immersive-search-form" data-analytics-event="search_started" data-analytics-label="Home search form">
              <SearchFilterBuilder {...reuseDefaults} />

              <div className="home-form-actions home-form-actions-premium immersive-submit-row">
                <PublicSearchSubmitButton />
                <span className="tiny">
                  Você pesquisa primeiro. O e-mail só é pedido antes do checkout, junto com o envio do acesso para acompanhar a compra depois.
                </span>
              </div>
            </form>
          </div>

          <div className="immersive-search-visual-side">
            <SearchImmersiveStage />
            <div className="immersive-search-benefits">
              <div className="signal-card">
                <span className="kicker">Ajuste o recorte</span>
                <strong>CNAE, estado e cidade na mesma busca</strong>
                <span className="muted">Monte um recorte mais claro para prospecção sem complicar a jornada com filtros desnecessários.</span>
              </div>
              <div className="signal-card">
                <span className="kicker">Fluxo direto</span>
                <strong>Pesquisa, prévia, checkout e download</strong>
                <span className="muted">Sem pedir login cedo demais e sem esconder o valor do pedido até a etapa final.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container stack" style={{ marginTop: 28 }}>
        <div className="surface-premium card-lg panel-grid two">
          <div className="stack" style={{ gap: 12 }}>
            <span className="eyebrow">Como funciona na prática</span>
            <h2 className="section-title">Pesquise, ajuste o recorte, veja a prévia, pague e baixe a lista.</h2>
            <div className="journey-grid">
              {journeySteps.map((step, index) => (
                <div key={step.title} className="journey-step-card">
                  <span className="journey-step-index">0{index + 1}</span>
                  <strong>{step.title}</strong>
                  <span className="muted">{step.copy}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="stack action-stage">
            <div className="notice conversion-notice">
              <strong>Preço alinhado com o produto</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                A cobrança é por tipo de lead encontrado: {pricingTiers.map((tier) => `${tier.label} ${tier.formattedUnitPrice}`).join(", ")}. Quando houver resultado, o pedido respeita mínimo operacional de {minimumCheckoutAmount}.
              </p>
            </div>
            <div className="notice conversion-notice">
              <strong>Sem compra no escuro</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                A prévia mostra volume, composição do lote e amostra da lista antes do checkout para a decisão ser mais previsível.
              </p>
            </div>
            <div className="inline-actions">
              <Link href="/pricing" className="button-ghost" data-analytics-event="pricing_viewed" data-analytics-label="Home pricing">
                Ver preços
              </Link>
              <Link href="/dados" className="button-secondary" data-analytics-event="data_page_opened" data-analytics-label="Home dados">
                Entender os dados
              </Link>
            </div>
          </div>
        </div>

        <DeliveryPreview />
        <TrustBlock />
        <UseCasesSection />
        <CommercialFaq limit={6} />
        <OnboardingCorporate />
      </section>
    </main>
  );
}

import Link from "next/link";
import { SearchFilterBuilder } from "@/components/search-filter-builder";
import { PremiumHeroStage } from "@/components/premium-hero-stage";
import { SearchImmersiveStage } from "@/components/search-immersive-stage";
import { OnboardingCorporate } from "@/components/onboarding-corporate";
import { PublicSearchSubmitButton } from "@/components/public-search-submit-button";
import { startPublicSearchAction } from "@/app/home-actions";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const journeySteps = [
  {
    title: "Defina o recorte ideal",
    copy: "Selecione CNAEs, estados e cidades e aplique filtros como telefone, e-mail, endereço, porte e Simples Nacional."
  },
  {
    title: "Veja a oportunidade antes de pagar",
    copy: "A próxima tela mostra quantos leads foram encontrados, a composição por nível de contato e o valor total do lote."
  },
  {
    title: "Libere a lista e avance",
    copy: "Depois do pagamento, a pesquisa fica disponível online e pronta para download em XLSX para operação comercial imediata."
  }
];

const faqItems = [
  {
    question: "Preciso assinar para fazer a primeira pesquisa?",
    answer: "Não. A jornada pública permite pesquisar e comprar apenas o lote encontrado, sem travar a primeira conversão em uma assinatura."
  },
  {
    question: "Como o valor é calculado?",
    answer: "O preço varia conforme a composição dos leads encontrados na busca: básico, com telefone, com e-mail ou completo. Você vê a distribuição antes do checkout."
  },
  {
    question: "Quando recebo a lista?",
    answer: "Assim que o pagamento for confirmado, a lista é liberada online e o download em XLSX fica disponível na mesma jornada."
  }
];

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <main className="page">
      <section className="container hero-premium-stack">
        <div className="hero-premium-copy surface-premium card-lg stack">
          <span className="eyebrow">Leads B2B por CNAE e região</span>
          <h1 className="display-title">
            <span className="gradient-text">Inteligência comercial para uma prospecção mais precisa</span>.
          </h1>
          <p className="lead-copy">
            Selecione CNAEs, estados e cidades, aplique filtros de contato e veja <strong>quantidade, composição e valor total antes do checkout</strong>.
            Sem assinatura obrigatória para começar e com entrega online da lista após a confirmação do pagamento.
          </p>

          <div className="inline-list">
            <span className="pill">Sem login obrigatório para pesquisar</span>
            <span className="pill">Preço por lead encontrado</span>
            <span className="pill">Checkout avulso e seguro</span>
            <span className="pill">Entrega online + XLSX</span>
          </div>

          <div className="hero-signal-grid">
            <div className="signal-card">
              <span className="kicker">Menos risco</span>
              <strong>Você decide com volume e valor na mesa</strong>
              <span className="muted">A busca mostra o tamanho da oportunidade antes da cobrança, reduzindo atrito na decisão.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Mais controle</span>
              <strong>Preço transparente por tipo de lead</strong>
              <span className="muted">Básico, telefone, e-mail ou completo: a composição do lote aparece de forma clara antes do pagamento.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Uso imediato</span>
              <strong>Lista pronta para operação comercial</strong>
              <span className="muted">Após o checkout, a lista fica liberada online e pronta para download em XLSX.</span>
            </div>
          </div>
        </div>

        <PremiumHeroStage />
      </section>

      <section className="container immersive-search-section">
        <div className="immersive-search-layout surface-premium card-lg">
          <div className="immersive-search-form-side">
            <div className="stack immersive-search-copy" style={{ gap: 8 }}>
              <span className="eyebrow">Comece pela busca</span>
              <h2 className="section-title immersive-search-title">Descubra em minutos se esse mercado vale uma compra agora.</h2>
              <p className="section-copy">
                Combine múltiplos CNAEs, estados e cidades na mesma pesquisa e refine o lote com filtros comerciais que aumentam a utilidade da lista.
              </p>
            </div>

            {error ? <div className="notice danger">{error}</div> : null}

            <form action={startPublicSearchAction} className="stack immersive-search-form">
              <div className="public-form-grid public-form-grid-wide">
                <div className="field">
                  <label htmlFor="email">E-mail para receber o acesso da pesquisa</label>
                  <input id="email" name="email" type="email" className="input input-premium" placeholder="voce@empresa.com" required />
                </div>
              </div>

              <SearchFilterBuilder />

              <div className="home-form-actions home-form-actions-premium immersive-submit-row">
                <PublicSearchSubmitButton />
                <span className="tiny">
                  Ao avançar, você vai para uma prévia com quantidade encontrada, composição por faixa de valor e total do lote antes do checkout.
                </span>
              </div>
            </form>
          </div>

          <div className="immersive-search-visual-side">
            <SearchImmersiveStage />
            <div className="immersive-search-benefits">
              <div className="signal-card">
                <span className="kicker">Filtros que importam</span>
                <strong>Telefone, e-mail, endereço, porte e mais</strong>
                <span className="muted">Refine a busca para priorizar listas mais úteis para prospecção, expansão geográfica e inteligência comercial.</span>
              </div>
              <div className="signal-card">
                <span className="kicker">Jornada mais curta</span>
                <strong>Busca, decisão e pagamento no mesmo fluxo</strong>
                <span className="muted">Sem empurrar o usuário para telas paralelas antes de mostrar o valor real da pesquisa.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container stack" style={{ marginTop: 28 }}>
        <div className="surface-premium card-lg panel-grid two">
          <div className="stack" style={{ gap: 12 }}>
            <span className="eyebrow">Como funciona</span>
            <h2 className="section-title">Uma jornada pensada para transformar busca em compra com menos fricção.</h2>
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
              <strong>Preço transparente na prática</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                A lógica comercial continua simples: <strong>R$ 0,05 básico</strong>, <strong>R$ 0,10 com telefone</strong>, <strong>R$ 0,15 com e-mail</strong> e <strong>R$ 0,20 completo</strong>.
                O lote final é calculado pela composição real do que foi encontrado na busca.
              </p>
            </div>
            <div className="notice conversion-notice">
              <strong>Sem surpresa na etapa decisiva</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                Antes de pagar, o usuário vê quantidade de leads, breakdown por categoria e o total do pedido em uma página de checkout mais objetiva.
              </p>
            </div>
            <div className="inline-actions">
              <Link href="/pricing" className="button-ghost">
                Ver detalhamento de preços
              </Link>
              <Link href="/onboarding" className="button-secondary">
                Ver onboarding corporativo
              </Link>
            </div>
          </div>
        </div>

        <div className="surface-premium card-lg stack faq-shell">
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">Perguntas que destravam a compra</span>
            <h2 className="section-title">Clareza para reduzir dúvida antes do checkout.</h2>
          </div>
          <div className="grid-3 faq-grid">
            {faqItems.map((item) => (
              <div key={item.question} className="signal-card faq-card">
                <strong>{item.question}</strong>
                <span className="muted">{item.answer}</span>
              </div>
            ))}
          </div>
        </div>

        <OnboardingCorporate />
      </section>
    </main>
  );
}

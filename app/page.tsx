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
    title: "Pesquise",
    copy: "Selecione CNAEs, estados e cidades para montar o recorte inicial da sua lista."
  },
  {
    title: "Refine",
    copy: "Ative filtros como telefone, e-mail, endereço, porte e Simples para deixar a lista mais útil."
  },
  {
    title: "Veja o volume",
    copy: "Na próxima tela você confere quantos estabelecimentos foram encontrados antes de pagar."
  },
  {
    title: "Veja o valor",
    copy: "O sistema mostra a composição da lista e o valor total do lote de forma clara."
  },
  {
    title: "Compre",
    copy: "Antes do checkout você informa seu e-mail, recebe o magic link e segue para o pagamento."
  },
  {
    title: "Opere",
    copy: "Depois da confirmação, a lista fica liberada online e pronta para download em XLSX."
  }
];

const faqItems = [
  {
    question: "Preciso informar e-mail para pesquisar?",
    answer: "Não. Você pode montar a busca, ver o volume e ver o valor da lista antes de informar seu e-mail."
  },
  {
    question: "Quando o e-mail é solicitado?",
    answer: "O e-mail é pedido logo antes do checkout. Nesse momento o sistema também envia o magic link para acesso ao dashboard."
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
          <span className="eyebrow">Lista de empresas por CNAE e região</span>
          <h1 className="display-title">
            <span className="gradient-text">Pesquise, refine, veja o volume, veja o valor e compre só quando fizer sentido</span>.
          </h1>
          <p className="lead-copy">
            Monte sua busca, ajuste os filtros e avance para uma prévia com <strong>quantidade encontrada e valor total</strong> antes do checkout.
            O e-mail só entra na etapa final, junto com o magic link para acessar o dashboard.
          </p>

          <div className="inline-list">
            <span className="pill">Sem e-mail para pesquisar</span>
            <span className="pill">Veja volume antes de pagar</span>
            <span className="pill">Veja valor antes de pagar</span>
            <span className="pill">Entrega online + XLSX</span>
          </div>

          <div className="hero-signal-grid">
            <div className="signal-card">
              <span className="kicker">Pesquise e refine</span>
              <strong>Monte o recorte da lista em poucos passos</strong>
              <span className="muted">Escolha CNAE, região e filtros de contato para chegar mais perto da lista que você precisa.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Veja o volume e o valor</span>
              <strong>Decida com números na tela</strong>
              <span className="muted">A prévia mostra quantos leads foram encontrados e quanto custa liberar o lote.</span>
            </div>
            <div className="signal-card">
              <span className="kicker">Compre e opere</span>
              <strong>Receba o acesso e siga para o checkout</strong>
              <span className="muted">Antes de pagar, você informa o e-mail, recebe o magic link e continua sem sair do fluxo.</span>
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
              <h2 className="section-title immersive-search-title">Pesquise agora e veja se a lista vale a compra.</h2>
              <p className="section-copy">
                Combine múltiplos CNAEs, estados e cidades na mesma pesquisa e refine o lote com filtros que ajudam na operação comercial.
              </p>
            </div>

            {error ? <div className="notice danger">{error}</div> : null}

            <form action={startPublicSearchAction} className="stack immersive-search-form">
              <SearchFilterBuilder />

              <div className="home-form-actions home-form-actions-premium immersive-submit-row">
                <PublicSearchSubmitButton />
                <span className="tiny">
                  Você pesquisa primeiro. O e-mail só é pedido antes do checkout, junto com o envio do magic link de acesso.
                </span>
              </div>
            </form>
          </div>

          <div className="immersive-search-visual-side">
            <SearchImmersiveStage />
            <div className="immersive-search-benefits">
              <div className="signal-card">
                <span className="kicker">Refine a lista</span>
                <strong>Telefone, e-mail, endereço, porte e mais</strong>
                <span className="muted">Use os filtros para priorizar listas mais úteis para prospecção e operação comercial.</span>
              </div>
              <div className="signal-card">
                <span className="kicker">Fluxo direto</span>
                <strong>Busca, volume, valor e checkout</strong>
                <span className="muted">A jornada mostra o que foi encontrado antes do pagamento e só pede o e-mail no momento certo.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container stack" style={{ marginTop: 28 }}>
        <div className="surface-premium card-lg panel-grid two">
          <div className="stack" style={{ gap: 12 }}>
            <span className="eyebrow">Como funciona</span>
            <h2 className="section-title">Pesquise, refine, veja o volume, veja o valor, compre e opere.</h2>
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
              <strong>Preço claro</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                A lógica continua simples: <strong>R$ 0,05 básico</strong>, <strong>R$ 0,10 com telefone</strong>, <strong>R$ 0,15 com e-mail</strong> e <strong>R$ 0,20 completo</strong>.
                O lote final é calculado pela composição real do que foi encontrado na busca.
              </p>
            </div>
            <div className="notice conversion-notice">
              <strong>Menos fricção</strong>
              <p className="muted" style={{ marginBottom: 0 }}>
                Você vê o volume e o valor antes de pagar. O e-mail entra só antes do checkout, quando o acesso realmente precisa ser enviado.
              </p>
            </div>
            <div className="inline-actions">
              <Link href="/pricing" className="button-ghost">
                Ver preços
              </Link>
              <Link href="/onboarding" className="button-secondary">
                Ver o passo a passo
              </Link>
            </div>
          </div>
        </div>

        <div className="surface-premium card-lg stack faq-shell">
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">Dúvidas frequentes</span>
            <h2 className="section-title">Clareza para avançar sem travar a compra.</h2>
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

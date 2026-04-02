import Link from "next/link";

const onboardingSteps = [
  {
    title: "Defina o recorte do mercado",
    copy: "Escolha CNAE, estado e cidade para aproximar a pesquisa do público que realmente interessa."
  },
  {
    title: "Ative filtros de qualidade",
    copy: "Refine para empresas com telefone, e-mail, endereço ou apenas celular quando fizer sentido."
  },
  {
    title: "Pague só pelo resultado",
    copy: "O valor é calculado pela quantidade encontrada, sem criar atrito de assinatura logo na entrada."
  },
  {
    title: "Acompanhe o histórico quando precisar",
    copy: "Use o dashboard para revisar listas anteriores e organizar leads sem travar a primeira pesquisa."
  }
];

export function OnboardingCorporate() {
  return (
    <section className="surface-premium card-lg stack onboarding-shell">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Onboarding corporativo</span>
        <h2 className="section-title">Um fluxo pensado para times comerciais entrarem em operação rápido.</h2>
        <p className="section-copy">
          A experiência conduz o usuário do primeiro filtro até a liberação da lista, mantendo clareza de preço e acesso opcional ao histórico.
        </p>
      </div>

      <div className="onboarding-grid">
        {onboardingSteps.map((step, index) => (
          <div className="onboarding-step" key={step.title}>
            <span className="onboarding-index">0{index + 1}</span>
            <strong>{step.title}</strong>
            <span className="muted">{step.copy}</span>
          </div>
        ))}
      </div>

      <div className="inline-actions">
        <Link href="/" className="button">
          Fazer primeira pesquisa
        </Link>
        <Link href="/dashboard" className="button-ghost">
          Ver dashboard
        </Link>
      </div>
    </section>
  );
}

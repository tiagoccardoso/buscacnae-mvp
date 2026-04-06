import Link from "next/link";

const onboardingSteps = [
  {
    title: "Pesquise",
    copy: "Escolha CNAE, estado e cidade para montar o recorte da lista."
  },
  {
    title: "Refine",
    copy: "Use filtros como telefone, e-mail, endereço, porte e Simples para deixar a lista mais útil."
  },
  {
    title: "Veja o volume",
    copy: "A próxima tela mostra quantos estabelecimentos foram encontrados na busca."
  },
  {
    title: "Veja o valor",
    copy: "Você confere a composição da lista e o valor total antes de pagar."
  },
  {
    title: "Compre",
    copy: "Antes do checkout, informe seu e-mail e receba o magic link para acessar o dashboard."
  },
  {
    title: "Opere",
    copy: "Depois do pagamento, a lista fica disponível online e pronta para download."
  }
];

export function OnboardingCorporate() {
  return (
    <section className="surface-premium card-lg stack onboarding-shell">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Passo a passo</span>
        <h2 className="section-title">Uma jornada direta para gerar a lista com menos fricção.</h2>
        <p className="section-copy">
          O fluxo foi organizado para deixar a busca mais simples: você pesquisa primeiro, vê o volume e o valor, informa o e-mail no momento certo e segue para o checkout.
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
          Fazer uma busca agora
        </Link>
        <Link href="/dashboard" className="button-ghost">
          Ver histórico no dashboard
        </Link>
      </div>
    </section>
  );
}

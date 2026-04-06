import Link from "next/link";

const onboardingSteps = [
  {
    title: "Defina o recorte do mercado",
    copy: "Escolha CNAE, estado e cidade para aproximar a pesquisa do público que realmente interessa."
  },
  {
    title: "Ative filtros de qualidade",
    copy: "Refine para empresas com telefone, e-mail, endereço, porte específico ou apenas celular quando fizer sentido."
  },
  {
    title: "Veja o lote antes da cobrança",
    copy: "A etapa seguinte mostra quantidade encontrada, composição por categoria e valor total para facilitar a decisão."
  },
  {
    title: "Libere e opere",
    copy: "Depois do pagamento, a lista fica disponível online e pronta para download, enquanto o dashboard segue opcional para histórico."
  }
];

export function OnboardingCorporate() {
  return (
    <section className="surface-premium card-lg stack onboarding-shell">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Fluxo comercial</span>
        <h2 className="section-title">Uma jornada feita para o usuário avançar da busca até a lista com segurança.</h2>
        <p className="section-copy">
          O produto reduz a fricção da primeira compra mostrando valor, volume e preço no momento certo, sem obrigar o usuário a entrar no dashboard para concluir a pesquisa pública.
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
          Ver dashboard opcional
        </Link>
      </div>
    </section>
  );
}

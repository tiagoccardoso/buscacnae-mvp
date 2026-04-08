import Link from "next/link";
import { minimumCheckoutAmount, pricingTiers } from "@/lib/site-content";

const onboardingSteps = [
  {
    title: "Pesquise",
    copy: "Escolha CNAE, estado e cidade para montar o recorte inicial da lista."
  },
  {
    title: "Ajuste o recorte",
    copy: "Use CNAE, estado e cidade para definir melhor a lista que você quer pesquisar."
  },
  {
    title: "Veja a prévia",
    copy: "A tela seguinte mostra quantos estabelecimentos foram encontrados e uma amostra operacional da lista."
  },
  {
    title: "Veja o preço",
    copy: `O valor é calculado por tipo de lead encontrado, com mínimo operacional de ${minimumCheckoutAmount} quando houver resultados.`
  },
  {
    title: "Pague",
    copy: "Antes do checkout, informe seu e-mail para receber acesso e continuar a compra."
  },
  {
    title: "Baixe a lista",
    copy: "Depois do pagamento, a lista fica disponível online e pronta para download em XLSX."
  }
];

export function OnboardingCorporate() {
  return (
    <section className="surface-premium card-lg stack onboarding-shell">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Passo a passo</span>
        <h2 className="section-title">Uma jornada direta para pesquisar, validar e comprar a lista.</h2>
        <p className="section-copy">
          O fluxo foi organizado para deixar a compra mais previsível: você pesquisa primeiro, vê a prévia, entende o preço e só então decide se vai seguir para o checkout.
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

      <div className="surface-soft card stack">
        <span className="eyebrow">Regra de preço</span>
        <p className="section-copy" style={{ marginBottom: 0 }}>
          {pricingTiers.map((tier) => `${tier.label}: ${tier.formattedUnitPrice}`).join(" · ")}. O dashboard é opcional e existe para histórico, listas salvas e recompra.
        </p>
      </div>

      <div className="inline-actions">
        <Link href="/" className="button" data-analytics-event="search_entry_clicked" data-analytics-label="Onboarding search">
          Fazer uma pesquisa agora
        </Link>
        <Link href="/dashboard" className="button-ghost">
          Ver dashboard
        </Link>
      </div>
    </section>
  );
}

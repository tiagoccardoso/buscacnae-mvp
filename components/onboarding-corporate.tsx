import Link from "next/link";
import { minimumCheckoutAmount, pricingTiers } from "@/lib/site-content";
import { SectionHeader } from "@/components/ui/section-header";

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
    <section className="section section-spaced" aria-labelledby="onboarding-title">
      <SectionHeader
        id="onboarding-title"
        eyebrow="Passo a passo"
        title="Uma jornada direta para pesquisar, validar e comprar a lista."
        copy="O fluxo foi organizado para deixar a compra mais previsível: você pesquisa primeiro, vê a prévia, entende o preço e só então decide se vai seguir para o checkout."
      />

      <ol className="steps">
        {onboardingSteps.map((step) => (
          <li className="step" key={step.title}>
            <strong>{step.title}</strong>
            <p>{step.copy}</p>
          </li>
        ))}
      </ol>

      <div className="tile stack-lg">
        <div className="stack-xs">
          <span className="kicker">Regra de preço</span>
          <p className="section-copy">
            {pricingTiers.map((tier) => `${tier.label}: ${tier.formattedUnitPrice}`).join(" · ")}. O dashboard é opcional e existe para histórico, listas salvas e recompra.
          </p>
        </div>
        <div className="cluster">
          <Link href="/" className="button" data-analytics-event="search_entry_clicked" data-analytics-label="Onboarding search">
            Fazer uma pesquisa agora
          </Link>
          <Link href="/dashboard" className="button-ghost">
            Ver dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

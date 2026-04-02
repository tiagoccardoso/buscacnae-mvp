import { OnboardingCorporate } from "@/components/onboarding-corporate";

export default function OnboardingPage() {
  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Como funciona</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            Comece a pesquisar empresas com um fluxo simples e direto.
          </h1>
          <p className="lead-copy">
            Esta página resume o fluxo de uso para equipes comerciais: definir o recorte, ver a quantidade encontrada, pagar pelo resultado e acompanhar o histórico quando necessário.
          </p>
        </div>

        <OnboardingCorporate />
      </section>
    </main>
  );
}

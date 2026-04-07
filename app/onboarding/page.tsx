import { OnboardingCorporate } from "@/components/onboarding-corporate";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Como funciona",
  description: "Entenda o fluxo do BuscaCNAE: pesquisa, filtros, prévia, checkout, download da lista e uso opcional do dashboard.",
  path: "/onboarding",
  keywords: ["como funciona busca cnae", "fluxo de compra de lista b2b", "prévia antes do checkout"]
});

export default function OnboardingPage() {
  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Como funciona</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            Um fluxo simples para pesquisar, validar o lote, pagar e baixar a lista.
          </h1>
          <p className="lead-copy">
            Esta página resume a jornada comercial do produto: montar o recorte, ver a prévia, confirmar o valor e usar o dashboard apenas quando fizer sentido para histórico e recompra.
          </p>
        </div>

        <OnboardingCorporate />
      </section>
    </main>
  );
}

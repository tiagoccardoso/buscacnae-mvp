import { OnboardingCorporate } from "@/components/onboarding-corporate";
import { buildPageMetadata } from "@/lib/seo";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = buildPageMetadata({
  title: "Como funciona",
  description: "Entenda o fluxo do BuscaCNAE: pesquisa, filtros, prévia, checkout, download da lista e uso opcional do dashboard.",
  path: "/onboarding",
  keywords: ["como funciona busca cnae", "fluxo de compra de lista b2b", "prévia antes do checkout"]
});

export default function OnboardingPage() {
  return (
    <main className="page">
      <div className="container">
        <PageHeader
          eyebrow="Como funciona"
          title="Um fluxo simples para pesquisar, validar o lote, pagar e baixar a lista."
          lead="Esta página resume a jornada comercial do produto: montar o recorte, ver a prévia, confirmar o valor e usar o dashboard apenas quando fizer sentido para histórico e recompra."
        />

        <OnboardingCorporate />
      </div>
    </main>
  );
}

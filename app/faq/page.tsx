import Link from "next/link";
import { CommercialFaq } from "@/components/commercial-faq";
import { buildPageMetadata } from "@/lib/seo";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = buildPageMetadata({
  title: "FAQ comercial",
  description: "Veja respostas objetivas sobre preço, dados, entrega, login, recompra e limites do BuscaCNAE.",
  path: "/faq",
  keywords: ["faq busca cnae", "dúvidas sobre listas b2b", "como funciona o checkout da lista"]
});

export default function FaqPage() {
  return (
    <main className="page">
      <div className="container container-narrow">
        <PageHeader
          eyebrow="FAQ comercial"
          title="Respostas diretas para decidir com menos dúvida."
          lead="Esta página reúne preço, dados, entrega, dashboard, recompra e outras respostas que normalmente travam a compra quando não estão claras."
          actions={
            <>
              <Link href="/pricing" className="button-secondary">Ver preços</Link>
              <Link href="/dados" className="button-ghost">Entender os dados</Link>
            </>
          }
        />

        <div className="section-spaced">
          <CommercialFaq compact showHeader={false} />
        </div>
      </div>
    </main>
  );
}

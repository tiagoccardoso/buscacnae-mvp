import Link from "next/link";
import { CommercialFaq } from "@/components/commercial-faq";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "FAQ comercial",
  description: "Veja respostas objetivas sobre preço, dados, entrega, login, recompra e limites do BuscaCNAE.",
  path: "/faq",
  keywords: ["faq busca cnae", "dúvidas sobre listas b2b", "como funciona o checkout da lista"]
});

export default function FaqPage() {
  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">FAQ comercial</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            Respostas diretas para decidir com menos dúvida.
          </h1>
          <p className="lead-copy">
            Esta página reúne preço, dados, entrega, dashboard, recompra e outras respostas que normalmente travam a compra quando não estão claras.
          </p>
          <div className="inline-actions">
            <Link href="/pricing" className="button-secondary">Ver preços</Link>
            <Link href="/dados" className="button-ghost">Entender os dados</Link>
          </div>
        </div>

        <CommercialFaq />
      </section>
    </main>
  );
}

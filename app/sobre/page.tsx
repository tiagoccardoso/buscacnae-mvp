import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo";
import { aboutHighlights } from "@/lib/site-content";

export const metadata = buildPageMetadata({
  title: "Sobre",
  description: "Conheça a proposta do BuscaCNAE e como o produto ajuda equipes comerciais a pesquisar, validar e comprar listas B2B por CNAE e região.",
  path: "/sobre",
  keywords: ["sobre busca cnae", "lista b2b por cnae", "produto de prospecção comercial"]
});

export default function AboutPage() {
  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Sobre o produto</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            Um produto transacional para descobrir, filtrar e comprar listas B2B com menos atrito.
          </h1>
          <p className="lead-copy">
            O BuscaCNAE foi desenhado para deixar a decisão de compra mais previsível: você monta o recorte, vê o volume, entende o preço e só então decide pagar pela lista.
          </p>
        </div>

        <div className="grid-2 trust-grid">
          {aboutHighlights.map((item) => (
            <article key={item} className="signal-card faq-card">
              <strong>{item}</strong>
              <span className="muted">Estrutura pensada para clareza comercial, previsibilidade de preço e continuidade da operação depois da compra.</span>
            </article>
          ))}
        </div>

        <div className="surface-premium card-lg stack">
          <span className="eyebrow">O que o produto não tenta ser</span>
          <p className="section-copy">
            O foco aqui não é vender um sistema complexo nem esconder o valor da lista atrás de formulário. A proposta é direta: pesquisa pública, prévia, checkout e download, com dashboard opcional para histórico e recompra.
          </p>
          <div className="inline-actions">
            <Link href="/" className="button">Fazer pesquisa</Link>
            <Link href="/pricing" className="button-ghost">Ver preços</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

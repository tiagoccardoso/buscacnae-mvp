import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo";
import { aboutHighlights } from "@/lib/site-content";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";

export const metadata = buildPageMetadata({
  title: "Sobre",
  description: "Conheça a proposta do BuscaCNAE e como o produto ajuda equipes comerciais a pesquisar, validar e comprar listas B2B por CNAE e região.",
  path: "/sobre",
  keywords: ["sobre busca cnae", "lista b2b por cnae", "produto de prospecção comercial"]
});

export default function AboutPage() {
  return (
    <main className="page">
      <div className="container">
        <PageHeader
          eyebrow="Sobre o produto"
          title="Um produto transacional para descobrir, filtrar e comprar listas B2B com menos atrito."
          lead="O BuscaCNAE foi desenhado para deixar a decisão de compra mais previsível: você monta o recorte, vê o volume, entende o preço e só então decide pagar pela lista."
        />

        <section className="section section-spaced" aria-label="Destaques do produto">
          <div className="grid-2">
            {aboutHighlights.map((item) => (
              <article key={item} className="feature feature-rule">
                <strong>{item}</strong>
                <p>Estrutura pensada para clareza comercial, previsibilidade de preço e continuidade da operação depois da compra.</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section section-spaced tile" aria-labelledby="about-not">
          <SectionHeader
            id="about-not"
            eyebrow="O que o produto não tenta ser"
            title="Direto ao ponto."
            copy="O foco aqui não é vender um sistema complexo nem esconder o valor da lista atrás de formulário. A proposta é direta: pesquisa pública, prévia, checkout e download, com dashboard opcional para histórico e recompra."
          />
          <div className="cluster">
            <Link href="/" className="button">Fazer pesquisa</Link>
            <Link href="/pricing" className="button-ghost">Ver preços</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { useCasePages } from "@/lib/site-content";

export function generateStaticParams() {
  return useCasePages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = useCasePages.find((item) => item.slug === slug);

  if (!page) {
    return {};
  }

  return buildPageMetadata({
    title: page.title,
    description: page.description,
    path: `/solucoes/${page.slug}`,
    keywords: [page.menuLabel, "lista b2b por cnae", "leads por região", "prospecção comercial"]
  });
}

export default async function UseCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = useCasePages.find((item) => item.slug === slug);

  if (!page) {
    notFound();
  }

  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">{page.heroEyebrow}</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            {page.title}
          </h1>
          <p className="lead-copy">{page.description}</p>
          <div className="inline-actions">
            <Link href="/" className="button">Começar pesquisa</Link>
            <Link href="/pricing" className="button-ghost">Ver preços</Link>
          </div>
        </div>

        <div className="surface-premium card-lg panel-grid two">
          <div className="stack">
            <span className="eyebrow">Quando usar</span>
            <h2 className="section-title">{page.intentTitle}</h2>
            <div className="stack">
              {page.bullets.map((item) => (
                <div key={item} className="signal-card">
                  <strong>{item}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="stack">
            <span className="eyebrow">O que ajuda na prática</span>
            <div className="stack">
              {page.benefits.map((item) => (
                <div key={item} className="signal-card">
                  <strong>{item}</strong>
                  <span className="muted">A jornada continua a mesma: pesquisa, prévia, preço visível, checkout e download da lista.</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

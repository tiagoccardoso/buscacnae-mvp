import Link from "next/link";
import { notFound } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import { useCasePages } from "@/lib/site-content";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";

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
      <div className="container">
        <PageHeader
          eyebrow={page.heroEyebrow}
          title={page.title}
          lead={page.description}
          actions={
            <>
              <Link href="/" className="button">Começar pesquisa</Link>
              <Link href="/pricing" className="button-ghost">Ver preços</Link>
            </>
          }
        />

        <section className="section section-spaced split" aria-label="Detalhes do caso de uso">
          <div className="stack-lg">
            <SectionHeader eyebrow="Quando usar" title={page.intentTitle} />
            <ul className="check-list">
              {page.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="stack-lg">
            <span className="eyebrow">O que ajuda na prática</span>
            <div className="stack-lg">
              {page.benefits.map((item) => (
                <div key={item} className="feature feature-rule">
                  <strong>{item}</strong>
                  <p>A jornada continua a mesma: pesquisa, prévia, preço visível, checkout e download da lista.</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

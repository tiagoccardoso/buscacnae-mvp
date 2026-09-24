import { buildPageMetadata } from "@/lib/seo";
import { publicContactEmail } from "@/lib/site-content";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = buildPageMetadata({
  title: "Contato",
  description: "Fale com o time do BuscaCNAE sobre dúvidas comerciais, dados, privacidade, pedidos e suporte da plataforma.",
  path: "/contato"
});

export default function ContactPage() {
  return (
    <main className="page">
      <div className="container container-narrow">
        <PageHeader
          eyebrow="Contato"
          title="Canais oficiais de atendimento da plataforma."
          lead="Use o canal abaixo para falar sobre pedidos, listas, dados, privacidade e questões operacionais da plataforma."
        />

        <section className="section section-spaced tile stack-sm" aria-label="E-mail de contato">
          <span className="kicker">E-mail principal</span>
          <a href={`mailto:${publicContactEmail}`} className="contact-email">
            {publicContactEmail}
          </a>
          <p className="section-copy">
            Ao entrar em contato, informe o e-mail usado na compra ou no dashboard para agilizar o atendimento.
          </p>
        </section>
      </div>
    </main>
  );
}

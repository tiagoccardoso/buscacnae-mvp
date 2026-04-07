import { buildPageMetadata } from "@/lib/seo";
import { publicContactEmail } from "@/lib/site-content";

export const metadata = buildPageMetadata({
  title: "Contato",
  description: "Fale com o time do BuscaCNAE sobre dúvidas comerciais, dados, privacidade, pedidos e suporte da plataforma.",
  path: "/contato"
});

export default function ContactPage() {
  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Contato</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            Atendimento comercial, suporte e dúvidas sobre dados.
          </h1>
          <p className="lead-copy">
            Use o canal abaixo para falar sobre pedidos, listas, dados, privacidade e questões operacionais da plataforma.
          </p>
        </div>

        <div className="surface-premium card-lg stack contact-card">
          <span className="kicker">E-mail principal</span>
          <a href={`mailto:${publicContactEmail}`} className="contact-email-link">
            {publicContactEmail}
          </a>
          <p className="section-copy">
            Ao entrar em contato, informe o e-mail usado na compra ou no dashboard para agilizar o atendimento.
          </p>
        </div>
      </section>
    </main>
  );
}

import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Política de privacidade",
  description: "Leia a política de privacidade do BuscaCNAE sobre dados de conta, uso da plataforma, pedidos e atendimento.",
  path: "/privacidade"
});

const items = [
  {
    title: "Dados de conta e acesso",
    copy: "Podemos tratar dados de identificação e contato informados no login e no checkout, como e-mail, para autenticação, histórico de pedidos, acesso às listas e atendimento."
  },
  {
    title: "Dados de navegação e uso",
    copy: "A plataforma pode registrar eventos operacionais de pesquisa, prévia, checkout, login, dashboard e recompra para melhorar a experiência, medir conversão e apoiar futuras integrações de analytics."
  },
  {
    title: "Uso dos dados do produto",
    copy: "As listas e dados disponibilizados ao cliente devem ser usados de forma lícita e responsável. O cliente é responsável pelo uso comercial e pelo atendimento às regras aplicáveis ao seu contexto."
  },
  {
    title: "Compartilhamento e operadores",
    copy: "Para operar a plataforma, podemos utilizar provedores de infraestrutura, autenticação, processamento de pagamentos e dados empresariais, sempre dentro da lógica operacional do serviço."
  },
  {
    title: "Direitos e contato",
    copy: "Solicitações relacionadas a dados pessoais, privacidade ou atendimento podem ser encaminhadas pelo canal oficial informado na página de contato."
  }
];

export default function PrivacyPage() {
  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Política de privacidade</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            Regras básicas de tratamento de dados na plataforma.
          </h1>
          <p className="lead-copy">
            Este texto resume como a plataforma trata dados de conta, de pedidos e de uso do produto para operar autenticação, checkout, histórico e suporte.
          </p>
        </div>

        <div className="grid-2 trust-grid">
          {items.map((item) => (
            <article key={item.title} className="surface-premium card-lg stack">
              <h2 className="section-title" style={{ fontSize: "1.35rem" }}>{item.title}</h2>
              <p className="section-copy">{item.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

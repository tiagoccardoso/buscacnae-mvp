import { buildPageMetadata } from "@/lib/seo";
import { PageHeader } from "@/components/ui/page-header";

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
      <div className="container container-narrow">
        <PageHeader
          eyebrow="Política de privacidade"
          title="Regras básicas de tratamento de dados na plataforma."
          lead="Este texto resume como a plataforma trata dados de conta, de pedidos e de uso do produto para operar autenticação, checkout, histórico e suporte."
        />

        <section className="section section-spaced" aria-label="Política de privacidade">
          <div className="stack-xl">
            {items.map((item) => (
              <article key={item.title} className="feature feature-rule">
                <h2 className="title-3">{item.title}</h2>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

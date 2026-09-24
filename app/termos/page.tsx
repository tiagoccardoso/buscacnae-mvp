import { buildPageMetadata } from "@/lib/seo";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = buildPageMetadata({
  title: "Termos de uso",
  description: "Leia os termos de uso do BuscaCNAE sobre acesso, pagamento, liberação das listas e responsabilidade de uso do serviço.",
  path: "/termos"
});

const clauses = [
  {
    title: "Objeto do serviço",
    copy: "O BuscaCNAE permite pesquisar, filtrar, visualizar a prévia e comprar listas de empresas por CNAE e região, com liberação online e download após a confirmação do pagamento."
  },
  {
    title: "Preço e pagamento",
    copy: "O preço é informado antes do checkout com base na composição real dos leads encontrados. Quando houver resultado, pode haver mínimo operacional por pedido."
  },
  {
    title: "Entrega e acesso",
    copy: "Após a confirmação do pagamento, a lista correspondente fica liberada ao comprador para visualização online e download no formato disponibilizado pela plataforma."
  },
  {
    title: "Uso responsável",
    copy: "O usuário é responsável pelo uso comercial, jurídico e operacional das listas adquiridas, inclusive por conformidade com regras aplicáveis ao seu contexto de atuação."
  },
  {
    title: "Limites do serviço",
    copy: "A plataforma não garante atualização absoluta de todos os campos, uniformidade de contatos em todos os registros, taxa de conversão ou adequação para finalidade específica além do recorte comercial informado."
  },
  {
    title: "Suspensão e revisão",
    copy: "A plataforma pode revisar, ajustar ou restringir o uso em caso de fraude, abuso, tentativa de violação ou uso incompatível com o serviço."
  }
];

export default function TermsPage() {
  return (
    <main className="page">
      <div className="container container-narrow">
        <PageHeader
          eyebrow="Termos de uso"
          title="Condições básicas para uso da plataforma e compra das listas."
          lead="Este resumo cobre as regras centrais de acesso, pagamento, entrega e responsabilidade pelo uso das listas adquiridas."
        />

        <section className="section section-spaced" aria-label="Termos de uso">
          <div className="stack-xl">
            {clauses.map((clause) => (
              <article key={clause.title} className="feature feature-rule">
                <h2 className="title-3">{clause.title}</h2>
                <p>{clause.copy}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

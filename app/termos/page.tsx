import { buildPageMetadata } from "@/lib/seo";

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
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Termos de uso</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            Condições básicas para uso da plataforma e compra das listas.
          </h1>
          <p className="lead-copy">
            Este resumo cobre as regras centrais de acesso, pagamento, entrega e responsabilidade pelo uso das listas adquiridas.
          </p>
        </div>

        <div className="grid-2 trust-grid">
          {clauses.map((clause) => (
            <article key={clause.title} className="surface-premium card-lg stack">
              <h2 className="section-title" style={{ fontSize: "1.35rem" }}>{clause.title}</h2>
              <p className="section-copy">{clause.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

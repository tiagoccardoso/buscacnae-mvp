import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo";
import { publicContactEmail } from "@/lib/site-content";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";

export const metadata = buildPageMetadata({
  title: "Dados, origem e atualização",
  description: "Entenda de onde vêm os dados do BuscaCNAE, como a lista é composta, como a atualização funciona e quais são os limites de uso do material entregue.",
  path: "/dados",
  keywords: ["origem dos dados lista b2b", "dados por cnae", "atualização de dados empresariais"]
});

const sections = [
  {
    title: "Origem dos dados",
    copy: "O produto consolida dados a partir dos provedores integrados à plataforma e da base interna de registros já processados pelo sistema. Hoje a operação trabalha com integrações de consulta empresarial e consolidação própria para montar cada resultado."
  },
  {
    title: "Composição da lista",
    copy: "Cada registro pode incluir razão social, nome fantasia, CNPJ, cidade, UF, situação cadastral, endereço e sinais de contato quando esses dados estiverem disponíveis no retorno recebido. Nem todo registro terá o mesmo nível de detalhe."
  },
  {
    title: "Atualização e cache",
    copy: "As buscas podem aproveitar cache operacional temporário para melhorar velocidade e consistência da experiência. Isso significa que uma mesma pesquisa pode usar resultados processados recentemente, sem prometer atualização em tempo real contínua para todos os campos."
  },
  {
    title: "Recorte disponível",
    copy: "A plataforma permite pesquisar por CNAE, estado e cidade. A composição final da lista depende do que for encontrado para cada empresa dentro desse recorte."
  },
  {
    title: "Limites realistas",
    copy: "O produto ajuda a montar listas comerciais com mais clareza, mas não garante resposta de campanha, taxa de conversão, atualidade absoluta de contato ou disponibilidade uniforme de enriquecimento para todos os registros."
  }
];

export default function DataPage() {
  return (
    <main className="page">
      <div className="container">
        <PageHeader
          eyebrow="Dados e atualização"
          title="De onde vêm os dados, o que entra na lista e o que esperar de forma realista."
          lead="Esta página foi criada para reduzir incerteza antes da compra. Ela explica origem, composição, atualização, recorte disponível e limites do material entregue."
        />

        <section className="section section-spaced" aria-label="Detalhes sobre os dados">
          <div className="grid-2">
            {sections.map((section) => (
              <article key={section.title} className="feature feature-rule">
                <h2 className="title-3">{section.title}</h2>
                <p>{section.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section section-spaced tile" aria-labelledby="data-contact">
          <SectionHeader
            id="data-contact"
            eyebrow="Contato"
            title="Ficou alguma dúvida?"
            copy={
              <span className="prose">
                Dúvidas sobre origem dos dados, entrega ou limites de uso podem ser enviadas para{" "}
                <a href={`mailto:${publicContactEmail}`}>{publicContactEmail}</a>.
              </span>
            }
          />
          <div className="cluster">
            <Link href="/faq" className="button-secondary">Ver FAQ</Link>
            <Link href="/contato" className="button-ghost">Abrir página de contato</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

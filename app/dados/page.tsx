import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo";
import { publicContactEmail } from "@/lib/site-content";

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
    copy: "Cada registro pode incluir razão social, nome fantasia, CNPJ, cidade, UF, situação cadastral, endereço e sinais de contato quando esses dados estiverem disponíveis no retorno recebido. Nem todo lead terá telefone e e-mail."
  },
  {
    title: "Atualização e cache",
    copy: "As buscas podem aproveitar cache operacional temporário para melhorar velocidade e consistência da experiência. Isso significa que uma mesma pesquisa pode usar resultados processados recentemente, sem prometer atualização em tempo real contínua para todos os campos."
  },
  {
    title: "Filtros e enriquecimentos",
    copy: "A plataforma permite filtrar por CNAE, estado, cidade, presença de telefone, e-mail, endereço, porte, Simples Nacional, capital social e ano mínimo de início da atividade, conforme o que estiver disponível na base consolidada."
  },
  {
    title: "Limites realistas",
    copy: "O produto ajuda a montar listas comerciais com mais clareza, mas não garante resposta de campanha, taxa de conversão, atualidade absoluta de contato ou disponibilidade uniforme de enriquecimento para todos os registros."
  }
];

export default function DataPage() {
  return (
    <main className="page">
      <section className="container stack">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Dados e atualização</span>
          <h1 className="display-title" style={{ fontSize: "clamp(2.2rem, 4vw, 4rem)" }}>
            De onde vêm os dados, o que entra na lista e o que esperar de forma realista.
          </h1>
          <p className="lead-copy">
            Esta página foi criada para reduzir incerteza antes da compra. Ela explica origem, composição, atualização, filtros disponíveis e limites do material entregue.
          </p>
        </div>

        <div className="grid-2 trust-grid">
          {sections.map((section) => (
            <article key={section.title} className="surface-premium card-lg stack">
              <h2 className="section-title" style={{ fontSize: "1.35rem" }}>{section.title}</h2>
              <p className="section-copy">{section.copy}</p>
            </article>
          ))}
        </div>

        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Contato</span>
          <p className="section-copy">
            Dúvidas sobre origem dos dados, entrega ou limites de uso podem ser enviadas para <a href={`mailto:${publicContactEmail}`}>{publicContactEmail}</a>.
          </p>
          <div className="inline-actions">
            <Link href="/faq" className="button-secondary">Ver FAQ</Link>
            <Link href="/contato" className="button-ghost">Abrir página de contato</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

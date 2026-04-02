import { SearchFilterBuilder } from "@/components/search-filter-builder";
import { SearchImmersiveStage } from "@/components/search-immersive-stage";
import { runSearchAction } from "./server-actions";

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <div className="immersive-search-layout surface-premium card-lg">
      <div className="immersive-search-form-side">
        <div className="stack immersive-search-copy" style={{ gap: 8 }}>
          <span className="eyebrow">Formulário operacional</span>
          <h2 className="section-title immersive-search-title">Monte buscas no Dashboard com o mesmo padrão da pesquisa principal.</h2>
          <p className="section-copy">
            Use o chat de IA para localizar CNAEs, clique nas sugestões para incluir no filtro e combine múltiplos estados e cidades na mesma operação.
          </p>
        </div>

        {error ? <div className="notice danger">{error}</div> : null}

        <form action={runSearchAction} className="stack immersive-search-form">
          <SearchFilterBuilder />

          <div className="home-form-actions home-form-actions-premium immersive-submit-row">
            <button type="submit" className="button button-lg">
              Buscar estabelecimentos
            </button>
            <span className="tiny">
              O resultado fica salvo no Dashboard e já mostra a rota de compra da lista para avançar sem sair do fluxo operacional.
            </span>
          </div>
        </form>
      </div>

      <div className="immersive-search-visual-side">
        <SearchImmersiveStage />
        <div className="immersive-search-benefits">
          <div className="signal-card">
            <span className="kicker">Chat de IA</span>
            <strong>Descubra CNAEs mais rápido</strong>
            <span className="muted">Descreva a atividade da empresa e transforme as sugestões em filtros com um clique.</span>
          </div>
          <div className="signal-card">
            <span className="kicker">Operação contínua</span>
            <strong>Pesquisar, revisar e comprar no mesmo fluxo</strong>
            <span className="muted">A busca fica registrada e o resultado já oferece a opção de comprar a lista encontrada.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

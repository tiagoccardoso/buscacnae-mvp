import { DashboardSearchForm } from "@/components/dashboard-search-form";
import { runSearchAction } from "./server-actions";

 type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : "";

  return (
    <div className="panel-grid two dashboard-search-grid">
      <div className="surface-premium card-lg stack">
        <span className="eyebrow">Nova busca</span>
        <h2 className="section-title">Recorte seu mercado com a mesma clareza visual do restante da plataforma.</h2>
        <p className="section-copy">
          Use esta área para criar pesquisas internas, persistir histórico e abrir caminho para revisão de listas, favoritos e fichas de estabelecimento.
        </p>
        <div className="stat-grid stat-grid-premium">
          <div className="stat-box stat-box-premium">
            <strong>CNAE</strong>
            <span className="muted">Defina a subclasse como base do recorte.</span>
          </div>
          <div className="stat-box stat-box-premium">
            <strong>UF + cidade</strong>
            <span className="muted">Delimite o território comercial com precisão.</span>
          </div>
          <div className="stat-box stat-box-premium">
            <strong>Histórico</strong>
            <span className="muted">A busca fica registrada no dashboard para consulta posterior.</span>
          </div>
        </div>
      </div>

      <div className="surface-premium card-lg stack">
        <span className="eyebrow">Formulário operacional</span>
        {error ? <div className="notice danger">{error}</div> : null}

        <DashboardSearchForm action={runSearchAction} />
      </div>
    </div>
  );
}

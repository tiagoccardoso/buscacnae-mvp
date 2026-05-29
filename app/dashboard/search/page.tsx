import { SearchFilterBuilder } from "@/components/search-filter-builder";
import { SearchImmersiveStage } from "@/components/search-immersive-stage";
import { DashboardSearchSubmitButton } from "@/components/dashboard-search-submit-button";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { getSearchFilterDefaults } from "@/lib/search-filter-defaults";
import { runSearchAction } from "./server-actions";

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = searchParams ? await searchParams : {};
  const error = typeof params.error === "string" ? params.error : "";
  const reuse = typeof params.reuse === "string" ? params.reuse : "";
  const suggestedYear = typeof params.suggestedYear === "string" ? params.suggestedYear : "";
  const suggestedExact = params.suggestedExact === "1";

  let reuseDefaults = {};
  let reuseMessage = "";
  const db = createDbClient();

  if (reuse) {
    const user = await getCurrentUser();

    if (user) {
      const { data: reusedSearch } = await db
        .from("search_queries")
        .select("query_payload")
        .eq("id", reuse)
        .eq("profile_id", user.id)
        .maybeSingle();

      if (reusedSearch?.query_payload) {
        reuseDefaults = getSearchFilterDefaults(reusedSearch.query_payload);
        reuseMessage = "Filtros carregados a partir de uma busca anterior. Ajuste o que quiser antes de rodar novamente.";
      }
    }
  }
  if (suggestedYear) {
    reuseDefaults = {
      ...reuseDefaults,
      defaultActivityStartYear: suggestedYear,
      defaultActivityStartYearExact: suggestedExact
    };
  }

  return (
    <div className="immersive-search-layout surface-premium card-lg">
      <div className="immersive-search-form-side">
        <div className="stack immersive-search-copy" style={{ gap: 8 }}>
          <span className="eyebrow">Nova busca</span>
          <h2 className="section-title immersive-search-title">Monte uma nova lista ou repita um recorte já validado.</h2>
          <p className="section-copy">
            Use o assistente de CNAE, reaproveite filtros antigos e envie a busca para uma nova prévia sem sair do dashboard.
          </p>
        </div>

        {reuseMessage ? <div className="notice success">{reuseMessage}</div> : null}
        {error ? <div className="notice danger">{error}</div> : null}

        <form action={runSearchAction} className="stack immersive-search-form" data-analytics-event="search_started" data-analytics-label="Dashboard search form">
          <SearchFilterBuilder {...reuseDefaults} />

          <div className="home-form-actions home-form-actions-premium immersive-submit-row">
            <DashboardSearchSubmitButton />
            <span className="tiny">
              O resultado fica salvo no dashboard e já mostra a rota de compra da lista para avançar sem sair do fluxo.
            </span>
          </div>
        </form>
      </div>

      <div className="immersive-search-visual-side">
        <SearchImmersiveStage />
        <div className="immersive-search-benefits">
          <div className="signal-card">
            <span className="kicker">Recompra</span>
            <strong>Repita filtros que já deram certo</strong>
            <span className="muted">Abra uma busca anterior, carregue o mesmo recorte e ajuste só o que mudou para a próxima rodada.</span>
          </div>
          <div className="signal-card">
            <span className="kicker">Prévia operacional</span>
            <strong>Volume, composição e preço antes do checkout</strong>
            <span className="muted">A mesma lógica da página pública continua aqui, com mais conveniência para quem usa o dashboard no dia a dia.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

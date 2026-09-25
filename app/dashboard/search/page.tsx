import { SearchFilterBuilder } from "@/components/search-filter-builder";
import { SearchSubmitButton } from "@/components/search-submit-button";
import { SectionHeader } from "@/components/ui/section-header";
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
  // Destino após a busca: lista (padrão) ou Mapa Empresarial. Os filtros são os mesmos.
  const resultView = params.view === "mapa" ? "mapa" : "lista";

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
    <section className="section" aria-labelledby="dashboard-search-title">
      <SectionHeader
        id="dashboard-search-title"
        eyebrow="Nova busca"
        title="Monte uma nova lista ou repita um recorte já validado."
        copy="Reaproveite filtros antigos e envie a busca para uma nova prévia sem sair do dashboard. O resultado fica salvo no histórico."
      />

      <div className="search-panel search-panel-plain">
        {reuseMessage ? <div className="notice success">{reuseMessage}</div> : null}
        {error ? <div className="notice danger" role="alert">{error}</div> : null}

        <form
          action={runSearchAction}
          className="search-form"
          data-analytics-event="search_started"
          data-analytics-label="Dashboard search form"
          aria-label="Nova busca por CNAE e região"
        >
          <input type="hidden" name="resultView" value={resultView} />
          <SearchFilterBuilder {...reuseDefaults} />

          <div className="search-submit">
            <SearchSubmitButton idleLabel="Ver volume e preço da busca" pendingLabel="Buscando volume e preço..." />
            <p className="footnote">
              {resultView === "mapa"
                ? "O resultado fica salvo no dashboard e abre direto no Mapa Empresarial; a mesma busca continua disponível em lista."
                : "O resultado fica salvo no dashboard e já mostra a rota de compra da lista para avançar sem sair do fluxo."}
            </p>
          </div>
        </form>
      </div>
    </section>
  );
}

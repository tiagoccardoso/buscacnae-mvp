import Link from "next/link";
import { redirect } from "next/navigation";
import { BusinessMapWorkspace } from "@/components/map/business-map-workspace";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { getCurrentUser } from "@/lib/auth/server";
import { getPublicMapConfig } from "@/lib/env";
import { isUuid, listMapSearchOptions } from "@/lib/map/service";
import { mapLayerFromParam } from "@/lib/map/types";
import { parseCompanyFilters, writeCompanyFilters } from "@/lib/results/filter-params";

export const metadata = {
  title: "Mapa empresarial"
};

type MapPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Mapa Empresarial: visualização geográfica das buscas salvas do usuário.
 * Não possui base própria — exibe os resultados da busca oficial (Casa dos Dados).
 */
export default async function BusinessMapPage({ searchParams }: MapPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in?message=Faça login para acessar o dashboard.");
  }

  const params = searchParams ? await searchParams : {};
  const requested = typeof params.search === "string" && isUuid(params.search) ? params.search : "";
  const options = await listMapSearchOptions(user.id);
  const searchId = requested || options[0]?.id || "";
  // Fase 3: a Inteligência de Mercado vive no resultado da busca (Empresas | Mapa | Inteligência).
  if (params.view === "inteligencia" && searchId) {
    const query = writeCompanyFilters(new URLSearchParams({ view: "inteligencia" }), parseCompanyFilters(params));
    redirect(`/dashboard/search/${searchId}?${query.toString()}`);
  }
  const view = "mapa" as const;
  const filters = parseCompanyFilters(params);
  const company = typeof params.empresa === "string" && isUuid(params.empresa) ? params.empresa : null;
  const viewHref = (target: "mapa" | "inteligencia") => {
    const query = writeCompanyFilters(new URLSearchParams(), filters);
    if (target === "inteligencia") {
      query.set("view", target);
      return `/dashboard/search/${searchId}?${query.toString()}`;
    }
    if (searchId) query.set("search", searchId);
    const text = query.toString();
    return `/dashboard/mapa${text ? `?${text}` : ""}`;
  };

  return (
    <section className="section" aria-labelledby="map-page-title">
      <div className="section-header-row">
        <SectionHeader
          id="map-page-title"
          eyebrow="Mapa empresarial"
          title="Veja onde estão as empresas da sua busca."
          copy="Os mesmos resultados e filtros da lista, agrupados no mapa. Aproxime para ver cada empresa ou busque em uma nova região."
        />
        <div className="cluster">
          <Link href="/dashboard/search?view=mapa" className="button-secondary">
            Nova busca no mapa
          </Link>
        </div>
      </div>

      {searchId ? (
        <nav className="segmented" aria-label="Modo do mapa">
          <Link href={viewHref("mapa")} className="segmented-item" aria-current={view === "mapa" ? "page" : undefined} scroll={false}>
            Mapa
          </Link>
          <Link href={viewHref("inteligencia")} className="segmented-item">
            Inteligência
          </Link>
        </nav>
      ) : null}

      {searchId ? (
        <BusinessMapWorkspace
          key={view}
          searchId={searchId}
          config={getPublicMapConfig()}
          variant="page"
          view={view}
          searchOptions={options}
          initialState={{ filters, layer: mapLayerFromParam(params.camada), companyId: company }}
        />
      ) : (
        <EmptyState
          title="Nenhuma busca para exibir no mapa"
          description="Faça uma busca por CNAE e região. O resultado aparece em lista e no Mapa Empresarial."
          ctaHref="/dashboard/search?view=mapa"
          ctaLabel="Fazer uma busca"
        />
      )}
    </section>
  );
}

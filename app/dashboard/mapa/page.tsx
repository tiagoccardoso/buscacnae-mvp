import Link from "next/link";
import { redirect } from "next/navigation";
import { BusinessMapWorkspace } from "@/components/map/business-map-workspace";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { getCurrentUser } from "@/lib/auth/server";
import { getPublicMapConfig } from "@/lib/env";
import { isUuid, listMapSearchOptions } from "@/lib/map/service";

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
        <BusinessMapWorkspace searchId={searchId} config={getPublicMapConfig()} variant="page" searchOptions={options} />
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

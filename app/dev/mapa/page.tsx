import { notFound } from "next/navigation";
import { BusinessMapWorkspace } from "@/components/map/business-map-workspace";
import { getPublicMapConfig } from "@/lib/env";
import { mapLayerFromParam } from "@/lib/map/types";
import { parseCompanyFilters } from "@/lib/results/filter-params";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Validação do mapa",
  robots: { index: false, follow: false }
};

type DevMapPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const ALLOWED_SIZES = [100, 1_000, 10_000, 20_000, 50_000];

/**
 * Ambiente LOCAL de validação do Mapa Empresarial com dados sintéticos (100 a 50.000
 * empresas), sem login, banco ou Casa dos Dados. Fora de desenvolvimento só existe com
 * MAP_DEV_HARNESS=1 — em produção a rota responde 404.
 */
export default async function DevMapPage({ searchParams }: DevMapPageProps) {
  if (process.env.NODE_ENV === "production" && process.env.MAP_DEV_HARNESS !== "1") notFound();

  const params = searchParams ? await searchParams : {};
  const requested = Number(Array.isArray(params.n) ? params.n[0] : params.n);
  const size = ALLOWED_SIZES.includes(requested) ? requested : 1_000;
  const view = params.view === "inteligencia" ? "inteligencia" : "mapa";
  const searchId = "00000000-0000-4000-8000-000000000000";

  return (
    <main className="container section" style={{ paddingBlock: "var(--space-6)" }}>
      <nav className="cluster" aria-label="Volume de teste">
        {ALLOWED_SIZES.map((option) => (
          <a key={option} className={option === size ? "button button-sm" : "button-secondary button-sm"} href={`/dev/mapa?n=${option}&view=${view}`}>
            {new Intl.NumberFormat("pt-BR").format(option)}
          </a>
        ))}
        <a className="button-ghost button-sm" href={`/dev/mapa?n=${size}&view=${view === "mapa" ? "inteligencia" : "mapa"}`}>
          {view === "mapa" ? "Inteligência" : "Mapa"}
        </a>
      </nav>
      <BusinessMapWorkspace
        key={`${size}-${view}`}
        searchId={searchId}
        config={getPublicMapConfig()}
        variant="embedded"
        view={view}
        dataEndpoint={`/api/dev/map-data?n=${size}`}
        initialState={{
          filters: parseCompanyFilters(params),
          layer: mapLayerFromParam(params.camada),
          companyId: typeof params.empresa === "string" ? params.empresa : null
        }}
      />
    </main>
  );
}

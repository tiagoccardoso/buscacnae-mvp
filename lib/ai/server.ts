import { createDbClient } from "@/lib/db-client";
import { getLatestSearchAccessOrderBySearchQueryId } from "@/lib/billing";
import { toCompanySummary } from "@/lib/company-model";
import { analysisReferenceDate } from "@/lib/analytics/dimensions";
import { toAnalyticsRecords } from "@/lib/analytics/records";
import { loadSearchUniverse } from "@/lib/analytics/universe-server";
import { buildMapCompanies, buildRegionSeats, isUuid, MapSearchNotFoundError } from "@/lib/map/service";
import { getSearchSummary } from "@/lib/search-summary";
import { buildSyntheticMapData } from "@/lib/map/dev-fixtures";
import type { AssistantDataset } from "@/lib/ai/orchestrator";
import type { MapSearchData } from "@/lib/map/types";

/**
 * Carga do universo para o assistente (servidor).
 *
 * Mesma regra de GET /api/map/searches/[id] (Mapa/Inteligência) e da aba Empresas:
 * busca do PRÓPRIO usuário (profile_id), liberação pela compra, `loadSearchUniverse`
 * (mesmas linhas, mesma ordem, mesmo teto) e o mesmo adaptador `MapCompany` →
 * `AnalyticsRecord`. Sem geocodificação e sem contatos: o assistente não precisa deles.
 *
 * A única entrada do usuário que chega ao banco é o id da busca (UUID validado),
 * sempre com o id do usuário autenticado — nada escrito pelo modelo vira consulta.
 */

const UNLOCKED_STATUSES = new Set(["paid", "free"]);
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 32;

const cache = new Map<string, { expires: number; dataset: AssistantDataset }>();

export async function loadAssistantDataset(searchId: string, profileId: string): Promise<AssistantDataset> {
  if (!isUuid(searchId)) throw new MapSearchNotFoundError();
  const cacheKey = `${profileId}:${searchId}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.dataset;

  const db = createDbClient();
  const { data: search } = await db.from("search_queries").select("*").eq("id", searchId).eq("profile_id", profileId).maybeSingle();
  if (!search) throw new MapSearchNotFoundError();

  const order = await getLatestSearchAccessOrderBySearchQueryId(searchId);
  const unlocked = Boolean(order && UNLOCKED_STATUSES.has(String(order.status)));
  const reported = Math.max(0, Number(search.total_results ?? 0) || 0);
  const universe = await loadSearchUniverse({ searchId, unlocked, reported }, db);
  const summaries = universe.companies.map((item) => toCompanySummary(item.company));
  const companies = buildMapCompanies(summaries, new Set(), new Map());
  const records = toAnalyticsRecords(companies, buildRegionSeats(summaries));
  const createdAt = typeof search.created_at === "string" ? search.created_at : search.created_at instanceof Date ? search.created_at.toISOString() : null;

  const dataset: AssistantDataset = {
    records,
    companies,
    referenceDate: analysisReferenceDate(),
    universe: universe.counts,
    source: { headline: getSearchSummary(search).headline, createdAt, unlocked, lockedCount: universe.counts.locked }
  };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, dataset });
  return dataset;
}

/** Universo a partir do JSON do mapa (ambiente local /dev/mapa e testes). */
export function datasetFromMapData(data: MapSearchData): AssistantDataset {
  return {
    records: toAnalyticsRecords(data.companies, data.regions),
    companies: data.companies,
    referenceDate: data.referenceDate,
    universe: data.universe,
    source: { headline: data.headline, createdAt: data.createdAt, unlocked: data.unlocked, lockedCount: data.lockedCount }
  };
}

const syntheticCache = new Map<number, AssistantDataset>();

export function syntheticDataset(size: number) {
  let dataset = syntheticCache.get(size);
  if (!dataset) {
    dataset = datasetFromMapData(buildSyntheticMapData(size));
    syntheticCache.set(size, dataset);
  }
  return dataset;
}

import type { CompanySearchDocument } from "@/lib/search/company-documents";
import { SearchEngineError, isSearchEngineError, type MeiliClient } from "@/lib/search/meilisearch";
import { LEGAL_SUFFIX_WORDS, PT_STOP_WORDS } from "@/lib/search/text";

/**
 * Índice de empresas no Meilisearch: configuração, escrita e consulta.
 * As regras de relevância foram escolhidas pelo benchmark (docs/BUSCA_AVANCADA.md §5).
 */

export const COMPANY_FACETS = ["stateCode", "city", "primaryCnae", "registrationStatus", "companySize", "headquarters"] as const;
export type CompanyFacet = (typeof COMPANY_FACETS)[number];

export const COMPANY_INDEX_SETTINGS = {
  // Ordem = peso do regra "attribute": nome vale mais que atividade, que vale mais que cidade.
  searchableAttributes: ["legalName", "tradeName", "cnpj", "cnpjRoot", "primaryCnaeLabel", "city"],
  // Permissões e datas internas não voltam na resposta.
  displayedAttributes: [
    "id",
    "cnpj",
    "legalName",
    "tradeName",
    "primaryCnae",
    "primaryCnaeLabel",
    "city",
    "cityIbge",
    "stateCode",
    "registrationStatus",
    "headquarters",
    "companySize",
    "openedYear",
    "source",
    "sourceFetchedAt",
    "indexedAt"
  ],
  filterableAttributes: [
    "profileIds",
    "workspaceIds",
    "expiresAt",
    "sourceFetchedAt",
    "cnpj",
    "cnpjRoot",
    "stateCode",
    "city",
    "cityIbge",
    "primaryCnae",
    "cnaeClass",
    "cnaeDivision",
    "secondaryCnaes",
    "registrationStatus",
    "headquarters",
    "companySize",
    "openedYear",
    "source"
  ],
  sortableAttributes: ["legalName", "openedYear", "sourceFetchedAt"],
  rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness"],
  stopWords: Array.from(new Set([...PT_STOP_WORDS, ...LEGAL_SUFFIX_WORDS])).sort(),
  synonyms: {
    transportadora: ["transportes", "transporte"],
    transportadoras: ["transportadora", "transportes", "transporte"],
    transportes: ["transportadora", "transporte"],
    logistica: ["transportes"],
    cia: ["companhia"],
    companhia: ["cia"],
    comercio: ["comercial"],
    comercial: ["comercio"],
    industria: ["industrial"],
    industrial: ["industria"],
    distribuidora: ["distribuicao"],
    construtora: ["construcoes", "construcao"],
    padaria: ["panificadora"],
    panificadora: ["padaria"],
    farmacia: ["drogaria"],
    drogaria: ["farmacia"],
    auto: ["automotivo", "automoveis"],
    mecanica: ["autocenter", "oficina"],
    oficina: ["mecanica"]
  },
  typoTolerance: {
    enabled: true,
    // "brnaco" (6 letras) aceita 1 erro; nomes longos aceitam 2.
    minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
    // CNPJ e raiz nunca casam "por aproximação".
    disableOnNumbers: true,
    disableOnAttributes: ["cnpj", "cnpjRoot"]
  },
  faceting: { maxValuesPerFacet: 100, sortFacetValuesBy: { "*": "count" } },
  pagination: { maxTotalHits: 1000 },
  proximityPrecision: "byAttribute",
  localizedAttributes: [{ attributePatterns: ["*"], locales: ["por"] }]
} as const;

type MeiliIndexInfo = { uid: string; primaryKey?: string | null };

export async function ensureCompanyIndex(client: MeiliClient, uid: string) {
  try {
    await client.request<MeiliIndexInfo>(`/indexes/${encodeURIComponent(uid)}`, { timeoutMs: 5_000 });
  } catch (error) {
    if (!isSearchEngineError(error) || error.kind !== "not_found") throw error;
    const taskUid = await client.enqueue("/indexes", "POST", { uid, primaryKey: "id" });
    await client.waitForTask(taskUid).catch((taskError: unknown) => {
      if (isSearchEngineError(taskError) && taskError.code === "index_already_exists") return null;
      throw taskError;
    });
  }
  const settingsTask = await client.enqueue(`/indexes/${encodeURIComponent(uid)}/settings`, "PATCH", COMPANY_INDEX_SETTINGS);
  await client.waitForTask(settingsTask, { timeoutMs: 120_000 });
}

/** Substitui os documentos inteiros (addOrReplace): campos removidos na origem somem do índice. */
export async function replaceCompanyDocuments(client: MeiliClient, uid: string, documents: CompanySearchDocument[]) {
  if (documents.length === 0) return null;
  return client.enqueue(`/indexes/${encodeURIComponent(uid)}/documents?primaryKey=id`, "POST", documents);
}

export async function deleteCompanyDocuments(client: MeiliClient, uid: string, ids: string[]) {
  if (ids.length === 0) return null;
  return client.enqueue(`/indexes/${encodeURIComponent(uid)}/documents/delete-batch`, "POST", ids);
}

export async function deleteExpiredCompanyDocuments(client: MeiliClient, uid: string, nowEpoch: number) {
  return client.enqueue(`/indexes/${encodeURIComponent(uid)}/documents/delete`, "POST", {
    filter: `expiresAt <= ${Math.trunc(nowEpoch)}`
  });
}

/** Troca atômica usada na reindexação completa (índice novo construído à parte). */
export async function swapIndexes(client: MeiliClient, left: string, right: string) {
  return client.enqueue("/swap-indexes", "POST", [{ indexes: [left, right] }]);
}

export async function deleteIndex(client: MeiliClient, uid: string) {
  return client.enqueue(`/indexes/${encodeURIComponent(uid)}`, "DELETE");
}

export type CompanyIndexStats = { numberOfDocuments: number; isIndexing: boolean; rawDocumentDbSize?: number };

export async function getCompanyIndexStats(client: MeiliClient, uid: string) {
  return client.request<CompanyIndexStats>(`/indexes/${encodeURIComponent(uid)}/stats`, { timeoutMs: 5_000 });
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export type CompanySearchFilters = {
  stateCodes?: string[];
  cityIbges?: string[];
  cities?: string[];
  primaryCnaes?: string[];
  cnaeClasses?: string[];
  registrationStatuses?: string[];
  companySizes?: string[];
  headquarters?: "matriz" | "filial" | null;
  cnpj?: string | null;
  cnpjRoot?: string | null;
};

export type CompanySearchScope = { profileId: string; workspaceIds: string[] };

/** Aspas e barras escapadas: valor do usuário nunca vira sintaxe de filtro. */
export function quoteFilterValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function inFilter(attribute: string, values: string[] | undefined) {
  const clean = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(0, 50);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `${attribute} = ${quoteFilterValue(clean[0])}`;
  return `${attribute} IN [${clean.map(quoteFilterValue).join(", ")}]`;
}

export function buildCompanyFilter(scope: CompanySearchScope, filters: CompanySearchFilters, nowEpoch: number) {
  if (!scope.profileId) throw new SearchEngineError("invalid_request", "Busca de empresas exige um usuário.");
  const visibility = [`profileIds = ${quoteFilterValue(scope.profileId)}`];
  const workspaces = inFilter("workspaceIds", scope.workspaceIds);
  if (workspaces) visibility.push(workspaces);

  const parts = [`(${visibility.join(" OR ")})`, `expiresAt > ${Math.trunc(nowEpoch)}`];
  const add = (clause: string | null) => {
    if (clause) parts.push(clause);
  };
  add(inFilter("stateCode", filters.stateCodes?.map((value) => value.toUpperCase())));
  add(inFilter("cityIbge", filters.cityIbges));
  add(inFilter("city", filters.cities));
  add(inFilter("primaryCnae", filters.primaryCnaes));
  add(inFilter("cnaeClass", filters.cnaeClasses));
  add(inFilter("registrationStatus", filters.registrationStatuses?.map((value) => value.toUpperCase())));
  add(inFilter("companySize", filters.companySizes));
  if (filters.headquarters) add(`headquarters = ${quoteFilterValue(filters.headquarters)}`);
  if (filters.cnpj) add(`cnpj = ${quoteFilterValue(filters.cnpj)}`);
  if (filters.cnpjRoot) add(`cnpjRoot = ${quoteFilterValue(filters.cnpjRoot)}`);
  return parts.join(" AND ");
}

export type CompanySearchHit = {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  primaryCnae: string | null;
  primaryCnaeLabel: string | null;
  city: string | null;
  stateCode: string | null;
  registrationStatus: string | null;
  headquarters: "matriz" | "filial" | null;
  companySize: string | null;
  openedYear: number | null;
  source: "casadosdados";
  sourceFetchedAt: string | null;
};

export type CompanySearchResponse = {
  engine: "meilisearch" | "database";
  degraded: boolean;
  hits: CompanySearchHit[];
  totalHits: number;
  totalIsEstimate: boolean;
  facets: Partial<Record<CompanyFacet, Record<string, number>>>;
  processingTimeMs: number;
  query: string;
  appliedFilter: string | null;
};

type MeiliSearchResult = {
  hits: Array<Record<string, unknown>>;
  estimatedTotalHits?: number;
  totalHits?: number;
  facetDistribution?: Record<string, Record<string, number>>;
  processingTimeMs?: number;
};

function epochToIso(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

export function mapCompanyHit(hit: Record<string, unknown>): CompanySearchHit {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  return {
    cnpj: String(hit.cnpj ?? hit.id ?? ""),
    legalName: text(hit.legalName) ?? "Sem razão social",
    tradeName: text(hit.tradeName),
    primaryCnae: text(hit.primaryCnae),
    primaryCnaeLabel: text(hit.primaryCnaeLabel),
    city: text(hit.city),
    stateCode: text(hit.stateCode),
    registrationStatus: text(hit.registrationStatus),
    headquarters: hit.headquarters === "matriz" || hit.headquarters === "filial" ? hit.headquarters : null,
    companySize: text(hit.companySize),
    openedYear: typeof hit.openedYear === "number" ? hit.openedYear : null,
    source: "casadosdados",
    sourceFetchedAt: epochToIso(hit.sourceFetchedAt)
  };
}

export async function searchCompanyIndex(
  client: MeiliClient,
  uid: string,
  input: {
    q: string;
    scope: CompanySearchScope;
    filters?: CompanySearchFilters;
    facets?: boolean;
    limit?: number;
    offset?: number;
    nowEpoch?: number;
    signal?: AbortSignal | null;
    matchingStrategy?: "last" | "all" | "frequency";
  }
): Promise<CompanySearchResponse> {
  const nowEpoch = input.nowEpoch ?? Math.floor(Date.now() / 1000);
  const filter = buildCompanyFilter(input.scope, input.filters ?? {}, nowEpoch);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  const offset = Math.min(Math.max(Math.trunc(input.offset ?? 0), 0), 1000);
  const result = await client.request<MeiliSearchResult>(`/indexes/${encodeURIComponent(uid)}/search`, {
    method: "POST",
    signal: input.signal,
    body: {
      q: input.q.slice(0, 200),
      filter,
      limit,
      offset,
      facets: input.facets ? [...COMPANY_FACETS] : undefined,
      matchingStrategy: input.matchingStrategy ?? "last",
      attributesToRetrieve: COMPANY_INDEX_SETTINGS.displayedAttributes
    }
  });
  return {
    engine: "meilisearch",
    degraded: false,
    hits: (result.hits ?? []).map(mapCompanyHit),
    totalHits: result.totalHits ?? result.estimatedTotalHits ?? result.hits?.length ?? 0,
    totalIsEstimate: result.totalHits === undefined,
    facets: (result.facetDistribution ?? {}) as CompanySearchResponse["facets"],
    processingTimeMs: result.processingTimeMs ?? 0,
    query: input.q,
    appliedFilter: filter
  };
}

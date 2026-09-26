import { searchCompaniesInDatabase } from "@/lib/search/company-fallback";
import { searchCompanyIndex, type CompanySearchFilters, type CompanySearchResponse } from "@/lib/search/company-index";
import { planCompanyQuery } from "@/lib/search/company-query-plan";
import { companyIndexUid, getSearchEngineConfig, isCompanySearchEngineEnabled } from "@/lib/search/config";
import { createMeiliClient, isSearchEngineError, type MeiliClient } from "@/lib/search/meilisearch";
import { primaryCnaeGroup, type QueryInterpretation } from "@/lib/search/query-understanding";
import { loadWorkspaceIds } from "@/lib/search/visibility";

/**
 * Serviço da busca na PRÓPRIA BASE do usuário (empresas já liberadas, salvas ou no CRM).
 *
 * Ordem: Meilisearch (se habilitado) → fallback no PostgreSQL → erro tratável.
 * Nenhum caminho aqui chama a Casa dos Dados: descobrir empresas NOVAS continua sendo o
 * fluxo de busca existente (CNAE + cidade), para o qual devolvemos uma sugestão pronta.
 */

export type DiscoverySuggestion = {
  /** Texto pronto para a interface: "Transporte rodoviário de carga em Pato Branco/PR". */
  label: string;
  cnaes: Array<{ code: string; formattedCode: string; label: string }>;
  city: { name: string; stateCode: string; ibge: string; confidence: "high" | "low" } | null;
  stateCode: string | null;
  /** Abre /dashboard/search com os filtros preenchidos; a busca roda na Casa dos Dados. */
  href: string;
};

export type CityFilterSuggestion = { name: string; stateCode: string; ibge: string };

export type CompanySearchResult = CompanySearchResponse & {
  interpretation: Pick<QueryInterpretation, "cnpj" | "stateCode" | "municipality" | "municipalityAlternatives" | "activityTerms">;
  discovery: DiscoverySuggestion | null;
  cityFilterSuggestions: CityFilterSuggestion[];
  fallbackReason: string | null;
};

const MIN_CNAE_SCORE = 3;

export function buildDiscoverySuggestion(interpretation: QueryInterpretation): DiscoverySuggestion | null {
  const strongCnaes = interpretation.cnaes.filter((candidate) => candidate.score >= MIN_CNAE_SCORE);
  const group = primaryCnaeGroup(strongCnaes);
  if (group.length === 0) return null;
  const municipality = interpretation.municipality;
  const stateCode = municipality?.stateCode ?? interpretation.stateCode ?? null;
  const params = new URLSearchParams();
  params.set("cnae", group.map((candidate) => candidate.code).join(","));
  if (stateCode) params.set("uf", stateCode);
  if (municipality) params.set("city", municipality.name);
  const activity = group[0].label.replace(/^[\d./-]+\s*·\s*/, "");
  const place = municipality ? ` em ${municipality.name}/${municipality.stateCode}` : stateCode ? ` em ${stateCode}` : "";
  return {
    label: `${activity}${place}`,
    cnaes: group.map(({ code, formattedCode, label }) => ({ code, formattedCode, label })),
    city: municipality
      ? { name: municipality.name, stateCode: municipality.stateCode, ibge: municipality.ibge, confidence: municipality.confidence }
      : null,
    stateCode,
    href: `/dashboard/search?${params.toString()}`
  };
}

function cityFilterSuggestions(interpretation: QueryInterpretation): CityFilterSuggestion[] {
  const all = [interpretation.municipality, ...interpretation.municipalityAlternatives].filter(
    (item): item is NonNullable<typeof item> => Boolean(item)
  );
  const unique = new Map(all.map((item) => [item.ibge, { name: item.name, stateCode: item.stateCode, ibge: item.ibge }]));
  return Array.from(unique.values()).slice(0, 5);
}

let cachedClient: { key: string; client: MeiliClient } | null = null;

function searchClient() {
  const config = getSearchEngineConfig();
  const key = `${config.url}|${config.searchKey}|${config.timeoutMs}`;
  if (!cachedClient || cachedClient.key !== key) {
    cachedClient = { key, client: createMeiliClient({ url: config.url, apiKey: config.searchKey, timeoutMs: config.timeoutMs }) };
  }
  return cachedClient.client;
}

export class CompanySearchUnavailableError extends Error {
  constructor() {
    super("A busca na sua base está indisponível agora. A busca de novas empresas (Casa dos Dados) continua funcionando.");
    this.name = "CompanySearchUnavailableError";
  }
}

export async function searchCompanies(
  input: {
    profileId: string;
    q: string;
    filters?: CompanySearchFilters;
    facets?: boolean;
    limit?: number;
    offset?: number;
    signal?: AbortSignal | null;
  },
  dependencies: {
    client?: MeiliClient | null;
    loadWorkspaces?: (profileId: string) => Promise<string[]>;
    fallback?: typeof searchCompaniesInDatabase;
    engineEnabled?: boolean;
    indexUid?: string;
  } = {}
): Promise<CompanySearchResult> {
  const config = getSearchEngineConfig();
  const plan = planCompanyQuery(input.q, input.filters ?? {});
  const workspaceIds = await (dependencies.loadWorkspaces ?? loadWorkspaceIds)(input.profileId).catch(() => [] as string[]);
  const scope = { profileId: input.profileId, workspaceIds };
  const engineEnabled = dependencies.engineEnabled ?? isCompanySearchEngineEnabled(config);
  let fallbackReason: string | null = engineEnabled ? null : "not_configured";
  let response: CompanySearchResponse | null = null;

  if (engineEnabled) {
    try {
      response = await searchCompanyIndex(dependencies.client ?? searchClient(), dependencies.indexUid ?? companyIndexUid(config), {
        q: plan.q,
        scope,
        filters: plan.filters,
        facets: input.facets,
        limit: input.limit,
        offset: input.offset,
        signal: input.signal
      });
    } catch (error) {
      if (!isSearchEngineError(error)) throw error;
      fallbackReason = error.kind;
      console.warn("[search] mecanismo de busca indisponível; usando o banco", { kind: error.kind, status: error.status });
    }
  }

  if (!response) {
    try {
      response = await (dependencies.fallback ?? searchCompaniesInDatabase)({
        q: plan.q,
        scope,
        filters: plan.filters,
        limit: input.limit,
        offset: input.offset,
        ttlDays: config.ttlDays
      });
    } catch (error) {
      console.error("[search] fallback no banco falhou", { name: error instanceof Error ? error.name : "unknown" });
      throw new CompanySearchUnavailableError();
    }
  }

  const { cnpj, stateCode, municipality, municipalityAlternatives, activityTerms } = plan.interpretation;
  return {
    ...response,
    interpretation: { cnpj, stateCode, municipality, municipalityAlternatives, activityTerms },
    discovery: buildDiscoverySuggestion(plan.interpretation),
    cityFilterSuggestions: cityFilterSuggestions(plan.interpretation),
    fallbackReason
  };
}

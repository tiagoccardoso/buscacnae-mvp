import { sql } from "@/lib/db";
import { normalizeCnaeCode } from "@/lib/cnae-utils";
import { resolveSourceFetchedAt } from "@/lib/search/company-documents";
import {
  COMPANY_FACETS,
  type CompanySearchFilters,
  type CompanySearchHit,
  type CompanySearchResponse,
  type CompanySearchScope
} from "@/lib/search/company-index";
import { foldSearchText, stripPersonalIdentifiers } from "@/lib/search/text";
import { visibleEstablishmentsSql } from "@/lib/search/visibility";
import { resolveHeadquartersOrBranch } from "@/lib/company-model";

/**
 * Fallback da busca na própria base quando o Meilisearch não está configurado ou falha.
 *
 * Mesmo contrato, mesmas regras de visibilidade e de validade, porém SEM tolerância a
 * erro de digitação (todos os termos precisam aparecer, sem acento/caixa — o comportamento
 * que a tabela de resultados já tinha). Facetas são calculadas sobre no máximo
 * FALLBACK_SCAN_LIMIT linhas e marcadas como aproximadas via `degraded: true`.
 */
const FALLBACK_SCAN_LIMIT = 500;
const ACCENTS_FROM = "áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
const ACCENTS_TO = "aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN";

type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
const defaultQuery: Query = (text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>;

function folded(column: string) {
  return `lower(translate(COALESCE(${column}, ''), '${ACCENTS_FROM}', '${ACCENTS_TO}'))`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function searchCompaniesInDatabase(
  input: {
    q: string;
    scope: CompanySearchScope;
    filters?: CompanySearchFilters;
    limit?: number;
    offset?: number;
    nowEpoch?: number;
    ttlDays: number;
  },
  query: Query = defaultQuery
): Promise<CompanySearchResponse> {
  const started = performance.now();
  const nowEpoch = input.nowEpoch ?? Math.floor(Date.now() / 1000);
  const filters = input.filters ?? {};
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const profileParam = bind(input.scope.profileId);
  const workspacesParam = bind(input.scope.workspaceIds);
  const visible = await visibleEstablishmentsSql(profileParam, workspacesParam, query);
  const where: string[] = [`e.id IN ${visible}`, `e.cnpj IS NOT NULL`];

  if (filters.cnpj) where.push(`e.cnpj = ${bind(filters.cnpj)}`);
  if (filters.cnpjRoot) where.push(`e.cnpj LIKE ${bind(`${escapeLike(filters.cnpjRoot)}%`)}`);
  if (filters.stateCodes?.length) where.push(`upper(e.state_code) = ANY(${bind(filters.stateCodes.map((value) => value.toUpperCase()))})`);
  if (filters.cityIbges?.length) where.push(`e.city_ibge = ANY(${bind(filters.cityIbges)})`);
  if (filters.cities?.length) where.push(`${folded("e.city_name")} = ANY(${bind(filters.cities.map((city) => foldSearchText(city)))})`);
  if (filters.primaryCnaes?.length) {
    where.push(`regexp_replace(COALESCE(e.primary_cnae_code, ''), '\\D', '', 'g') = ANY(${bind(filters.primaryCnaes.map(normalizeCnaeCode))})`);
  }
  if (filters.cnaeClasses?.length) {
    where.push(`left(regexp_replace(COALESCE(e.primary_cnae_code, ''), '\\D', '', 'g'), 5) = ANY(${bind(filters.cnaeClasses)})`);
  }
  if (filters.registrationStatuses?.length) {
    where.push(`upper(${folded("e.registration_status")}) = ANY(${bind(filters.registrationStatuses.map((value) => foldSearchText(value).toUpperCase()))})`);
  }
  if (filters.companySizes?.length) where.push(`e.company_size = ANY(${bind(filters.companySizes)})`);

  const digits = input.q.replace(/\D/g, "");
  const terms = foldSearchText(input.q).split(" ").filter(Boolean).slice(0, 8);
  if (digits.length >= 5 && digits.length === input.q.replace(/[^0-9A-Za-z]/g, "").length) {
    where.push(`e.cnpj LIKE ${bind(`${escapeLike(digits)}%`)}`);
  } else {
    const haystack = `(${folded("e.company_name")} || ' ' || ${folded("e.trade_name")} || ' ' || ${folded("e.city_name")} || ' ' || ${folded("e.primary_cnae_description")} || ' ' || COALESCE(e.primary_cnae_code, ''))`;
    for (const term of terms) where.push(`${haystack} LIKE ${bind(`%${escapeLike(term)}%`)}`);
  }

  const rows = await query(
    `SELECT e.cnpj, e.company_name, e.trade_name, e.primary_cnae_code, e.primary_cnae_description, e.city_name, e.city_ibge,
            e.state_code, e.registration_status, e.company_size, e.opened_at::text AS opened_at, e.provider_payload,
            to_jsonb(e.*) -> 'updated_at' AS updated_at, to_jsonb(e.*) -> 'created_at' AS created_at
       FROM establishments e
      WHERE ${where.join(" AND ")}
      ORDER BY e.company_name NULLS LAST, e.cnpj
      LIMIT ${FALLBACK_SCAN_LIMIT}`,
    params
  );

  const cutoff = nowEpoch - input.ttlDays * 86_400;
  const fresh = rows.filter((row) => resolveSourceFetchedAt(row, nowEpoch) > cutoff);
  const firstTerm = terms[0] ?? "";
  // Relevância mínima: nome que começa com o termo vem antes.
  fresh.sort((left, right) => {
    const leftStarts = foldSearchText(String(left.company_name ?? "")).startsWith(firstTerm) ? 0 : 1;
    const rightStarts = foldSearchText(String(right.company_name ?? "")).startsWith(firstTerm) ? 0 : 1;
    return leftStarts - rightStarts;
  });

  const facets: CompanySearchResponse["facets"] = {};
  for (const facet of COMPANY_FACETS) facets[facet] = {};
  const hits: CompanySearchHit[] = fresh.map((row) => {
    const primaryCnae = normalizeCnaeCode(String(row.primary_cnae_code ?? "")) || null;
    const hit: CompanySearchHit = {
      cnpj: String(row.cnpj),
      legalName: stripPersonalIdentifiers(typeof row.company_name === "string" ? row.company_name : null) ?? "Sem razão social",
      tradeName: stripPersonalIdentifiers(typeof row.trade_name === "string" ? row.trade_name : null),
      primaryCnae,
      primaryCnaeLabel: typeof row.primary_cnae_description === "string" ? row.primary_cnae_description : null,
      city: typeof row.city_name === "string" ? row.city_name : null,
      stateCode: typeof row.state_code === "string" ? row.state_code.toUpperCase() : null,
      registrationStatus: typeof row.registration_status === "string" ? foldSearchText(row.registration_status).toUpperCase() : null,
      headquarters: resolveHeadquartersOrBranch(String(row.cnpj), row.provider_payload),
      companySize: typeof row.company_size === "string" ? row.company_size : null,
      openedYear: typeof row.opened_at === "string" && /^\d{4}/.test(row.opened_at) ? Number(row.opened_at.slice(0, 4)) : null,
      source: "casadosdados",
      sourceFetchedAt: new Date(resolveSourceFetchedAt(row, nowEpoch) * 1000).toISOString()
    };
    const add = (facet: (typeof COMPANY_FACETS)[number], value: string | null) => {
      if (!value) return;
      const bucket = facets[facet]!;
      bucket[value] = (bucket[value] ?? 0) + 1;
    };
    add("stateCode", hit.stateCode);
    add("city", hit.city);
    add("primaryCnae", hit.primaryCnae);
    add("registrationStatus", hit.registrationStatus);
    add("companySize", hit.companySize);
    add("headquarters", hit.headquarters);
    return hit;
  });

  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  const offset = Math.min(Math.max(Math.trunc(input.offset ?? 0), 0), 1000);
  return {
    engine: "database",
    degraded: true,
    hits: hits.slice(offset, offset + limit),
    totalHits: hits.length,
    totalIsEstimate: rows.length >= FALLBACK_SCAN_LIMIT,
    facets,
    processingTimeMs: Math.round(performance.now() - started),
    query: input.q,
    appliedFilter: null
  };
}

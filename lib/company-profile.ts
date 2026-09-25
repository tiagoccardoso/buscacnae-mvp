import type { NormalizedEstablishment } from "@/lib/types";
import { hasLegacyProviderData, sanitizeProviderPayload } from "@/lib/provider-payload";

/**
 * Regras da ficha da empresa.
 *
 * A ficha usa somente a Casa dos Dados (pesquisa + consulta detalhada `GET /v4/cnpj`).
 * Não existe fonte secundária: se a consulta detalhada falhar, a ficha segue com os
 * dados já salvos da própria Casa dos Dados.
 *
 * Registros antigos podem ter campos preenchidos pela integração removida (CNPJ.ws).
 * Para eles a ficha força uma revalidação na Casa dos Dados e, quando ela conclui,
 * os campos que só a consulta detalhada fornece são substituídos pelo valor da Casa dos
 * Dados (inclusive ficando vazios quando ela não retorna o campo), para que nenhum valor
 * antigo seja apresentado como se viesse da fonte atual.
 */
export type EstablishmentRow = {
  id: string;
  cnpj: string;
  cnpj_root?: string | null;
  company_name: string;
  trade_name?: string | null;
  registration_status?: string | null;
  opened_at?: string | null;
  primary_cnae_code?: string | null;
  primary_cnae_description?: string | null;
  secondary_cnaes?: unknown;
  legal_nature_code?: string | null;
  legal_nature_description?: string | null;
  company_size?: string | null;
  simples_opt_in?: boolean | null;
  mei_opt_in?: boolean | null;
  capital_social?: number | string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  state_code?: string | null;
  city_name?: string | null;
  city_ibge?: string | null;
  neighborhood?: string | null;
  cep?: string | null;
  address_line?: string | null;
  address_number?: string | null;
  complement?: string | null;
  provider_payload?: unknown;
};

export type CompanyDetailFetcher = (cnpj: string) => Promise<{
  raw: Record<string, unknown>;
  normalized: NormalizedEstablishment | null;
  fetchedAt?: string;
}>;

/** Mesmo nome de chave usado pelo provider (lib/discovery/providers/casadosdados.ts). */
const DETAIL_FETCHED_AT_KEY = "casadosdados_detalhe_em";

export type CompanyProfileResult = {
  company: EstablishmentRow;
  /** Linha alterada que deve ser persistida (null quando nada mudou). */
  updatePayload: ReturnType<typeof buildEstablishmentUpdatePayload> | null;
  /** A consulta detalhada da Casa dos Dados foi concluída nesta abertura. */
  refreshed: boolean;
  /**
   * Registro salvo em versão anterior da plataforma que não pôde ser revalidado agora.
   * A ficha informa isso ao usuário sem citar fornecedores.
   */
  pendingRevalidation: boolean;
};

function hasValue(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

export function needsDetailedRefresh(row: EstablishmentRow) {
  if (hasLegacyProviderData(row.provider_payload)) return true;

  const detailedFields = [
    row.registration_status,
    row.primary_cnae_code,
    row.primary_cnae_description,
    row.opened_at,
    row.city_name,
    row.state_code,
    row.cep,
    row.address_line,
    row.email,
    row.phone,
    row.legal_nature_description
  ];

  return detailedFields.filter(hasValue).length < 8;
}

function mergeProviderPayload(existingPayload: unknown, detailedPayload: Record<string, unknown>, fetchedAt?: string) {
  const detailKey = "casadosdados_detalhe";
  const sanitizedExisting = sanitizeProviderPayload(existingPayload);
  const stamp = fetchedAt ? { [DETAIL_FETCHED_AT_KEY]: fetchedAt } : {};

  if (sanitizedExisting && typeof sanitizedExisting === "object" && !Array.isArray(sanitizedExisting)) {
    return { ...(sanitizedExisting as Record<string, unknown>), [detailKey]: detailedPayload, ...stamp };
  }

  if (sanitizedExisting) {
    return { casadosdados_pesquisa: sanitizedExisting, [detailKey]: detailedPayload, ...stamp };
  }

  return { [detailKey]: detailedPayload, ...stamp };
}

/**
 * Campos que, no fluxo antigo, podiam ser preenchidos pela fonte removida (a pesquisa da
 * Casa dos Dados não os retornava). Em registros legados eles passam a refletir
 * exclusivamente a consulta detalhada da Casa dos Dados.
 */
const DETAIL_ONLY_FIELDS = new Set<keyof EstablishmentRow>([
  "email",
  "phone",
  "website",
  "simples_opt_in",
  "mei_opt_in",
  "legal_nature_code",
  "legal_nature_description",
  "company_size",
  "capital_social",
  "secondary_cnaes",
  "complement",
  "country"
]);

export function mergeEstablishmentRow(
  current: EstablishmentRow,
  normalized: NormalizedEstablishment,
  detailedPayload: Record<string, unknown>,
  options: { authoritative?: boolean; fetchedAt?: string } = {}
): EstablishmentRow {
  const pick = <K extends keyof EstablishmentRow>(key: K, next: EstablishmentRow[K] | null | undefined) => {
    if (next !== null && next !== undefined && !(typeof next === "string" && !next.trim())) return next;
    if (options.authoritative && DETAIL_ONLY_FIELDS.has(key)) return null as EstablishmentRow[K];
    return (current[key] ?? null) as EstablishmentRow[K];
  };

  return {
    ...current,
    cnpj: normalized.cnpj || current.cnpj,
    cnpj_root: pick("cnpj_root", normalized.cnpjRoot),
    company_name: normalized.companyName || current.company_name,
    trade_name: pick("trade_name", normalized.tradeName),
    registration_status: pick("registration_status", normalized.registrationStatus),
    opened_at: pick("opened_at", normalized.openedAt),
    primary_cnae_code: pick("primary_cnae_code", normalized.primaryCnaeCode),
    primary_cnae_description: pick("primary_cnae_description", normalized.primaryCnaeDescription),
    secondary_cnaes: pick("secondary_cnaes", normalized.secondaryCnaes),
    legal_nature_code: pick("legal_nature_code", normalized.legalNatureCode),
    legal_nature_description: pick("legal_nature_description", normalized.legalNatureDescription),
    company_size: pick("company_size", normalized.companySize),
    simples_opt_in: pick("simples_opt_in", normalized.simplesOptIn),
    mei_opt_in: pick("mei_opt_in", normalized.meiOptIn),
    capital_social: pick("capital_social", normalized.capitalSocial),
    email: pick("email", normalized.email),
    phone: pick("phone", normalized.phone),
    website: pick("website", normalized.website),
    country: pick("country", normalized.country),
    state_code: pick("state_code", normalized.stateCode),
    city_name: pick("city_name", normalized.cityName),
    city_ibge: pick("city_ibge", normalized.cityIbge),
    neighborhood: pick("neighborhood", normalized.neighborhood),
    cep: pick("cep", normalized.cep),
    address_line: pick("address_line", normalized.addressLine),
    address_number: pick("address_number", normalized.addressNumber),
    complement: pick("complement", normalized.complement),
    provider_payload: mergeProviderPayload(current.provider_payload, detailedPayload, options.fetchedAt)
  };
}

export function buildEstablishmentUpdatePayload(row: EstablishmentRow) {
  return {
    cnpj_root: row.cnpj_root ?? null,
    company_name: row.company_name,
    trade_name: row.trade_name ?? null,
    registration_status: row.registration_status ?? null,
    opened_at: row.opened_at ?? null,
    primary_cnae_code: row.primary_cnae_code ?? null,
    primary_cnae_description: row.primary_cnae_description ?? null,
    secondary_cnaes: row.secondary_cnaes ?? null,
    legal_nature_code: row.legal_nature_code ?? null,
    legal_nature_description: row.legal_nature_description ?? null,
    company_size: row.company_size ?? null,
    simples_opt_in: row.simples_opt_in ?? null,
    mei_opt_in: row.mei_opt_in ?? null,
    capital_social: row.capital_social ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    website: row.website ?? null,
    country: row.country ?? null,
    state_code: row.state_code ?? null,
    city_name: row.city_name ?? null,
    city_ibge: row.city_ibge ?? null,
    neighborhood: row.neighborhood ?? null,
    cep: row.cep ?? null,
    address_line: row.address_line ?? null,
    address_number: row.address_number ?? null,
    complement: row.complement ?? null,
    provider_payload: sanitizeProviderPayload(row.provider_payload ?? null)
  };
}

/**
 * Resolve os dados exibidos na ficha. Única dependência externa: `fetchDetail`
 * (consulta detalhada da Casa dos Dados). Erros não derrubam a ficha.
 */
export async function resolveCompanyProfile(
  row: EstablishmentRow,
  fetchDetail: CompanyDetailFetcher,
  onDetailError?: (error: unknown) => void
): Promise<CompanyProfileResult> {
  const legacy = hasLegacyProviderData(row.provider_payload);
  const sanitizedRow: EstablishmentRow = { ...row, provider_payload: sanitizeProviderPayload(row.provider_payload ?? null) };

  if (!needsDetailedRefresh(row)) {
    return { company: sanitizedRow, updatePayload: null, refreshed: false, pendingRevalidation: false };
  }

  try {
    const detail = await fetchDetail(row.cnpj);
    if (detail.normalized) {
      const merged = mergeEstablishmentRow(sanitizedRow, detail.normalized, detail.raw, {
        authoritative: legacy,
        fetchedAt: detail.fetchedAt
      });
      return {
        company: merged,
        updatePayload: buildEstablishmentUpdatePayload(merged),
        refreshed: true,
        pendingRevalidation: false
      };
    }
  } catch (error) {
    onDetailError?.(error);
  }

  return {
    company: sanitizedRow,
    // Sem revalidação o registro continua marcado como legado para nova tentativa na
    // próxima abertura; o conteúdo legado já não é exibido (payload higienizado acima).
    updatePayload: null,
    refreshed: false,
    pendingRevalidation: legacy
  };
}

import { canonicalizeEstablishment, mergeEstablishmentSources, normalizedToPresenterSource } from "@/lib/establishment-canonical";
import { getEstablishmentPayload } from "@/lib/establishment-presenter";
import { buildAddressSummary } from "@/lib/establishment-detail-sections";
import { extractProviderCoordinates } from "@/lib/geo/company-location";
import type { NormalizedEstablishment } from "@/lib/types";
import { extractSingleObject } from "@/lib/utils";
import {
  assessEstablishmentQuality,
  cleanString,
  normalizeCep,
  normalizeCnae,
  normalizeEmail,
  normalizeIbgeCode,
  normalizePhone,
  normalizeUf,
  normalizeWebsite,
  type DataQualityReport
} from "@/lib/data-quality";

/**
 * Modelo empresarial central do BuscaCNAE.
 *
 * Fluxo único:
 *   Casa dos Dados (POST /v5/cnpj/pesquisa + GET /v4/cnpj)
 *     → adapter `normalizeCasaDosDadosEstablishment` (NormalizedEstablishment)
 *     → persistência (establishments / search_results)
 *     → `canonicalizeEstablishment` (fallbacks lidos do payload da própria Casa dos Dados)
 *     → Company (este arquivo)
 *
 * Lista, ficha, exportação e mapa consomem Company (ou suas projeções
 * CompanySummary / CompanyListItem). Nenhum dado é criado: campo ausente na fonte = null.
 *
 * Regras de limpeza (CNPJ, telefone, CEP, UF, município, CNAE, vazios…) vivem em
 * lib/data-quality e são aplicadas no adapter e novamente aqui (registros antigos do banco).
 */

export type CompanyCnae = { code: string | null; description: string | null };

export type HeadquartersOrBranch = "matriz" | "filial";

export type CompanyAddress = {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  cityIbge: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  /** Endereço em uma linha, pronto para exibição. */
  summary: string | null;
};

export type CompanyContacts = {
  email: string | null;
  phone: string | null;
  phoneIsMobile: boolean;
  website: string | null;
};

/**
 * Coordenadas informadas pela própria Casa dos Dados.
 * - address: coordenada do endereço (quando a fonte fornecer);
 * - city: coordenada IBGE do município (endereco.ibge.latitude/longitude).
 * Geocodificação por CEP/município fica em lib/geo (Fase 2 / mapa).
 */
export type CompanyProviderLocation = {
  latitude: number;
  longitude: number;
  precision: "address" | "city";
};

/** Origem do registro. Hoje existe uma única fonte empresarial: a Casa dos Dados. */
export type CompanyProvenance = {
  source: "casadosdados";
  /** Quando a consulta detalhada (GET /v4/cnpj) foi obtida; null = só dados da pesquisa. */
  detailFetchedAt: string | null;
};

export type Company = {
  id: string;
  source: "casadosdados";
  provenance: CompanyProvenance;
  /** Diagnóstico não destrutivo (CNPJ com DV inválido, sem contato, sem CEP…). */
  quality: DataQualityReport;
  cnpj: string;
  cnpjRoot: string | null;
  legalName: string;
  tradeName: string | null;
  displayName: string;
  status: string | null;
  openedAt: string | null;
  legalNature: { code: string | null; description: string | null };
  headquartersOrBranch: HeadquartersOrBranch | null;
  size: string | null;
  shareCapital: number | null;
  simplesOptIn: boolean | null;
  meiOptIn: boolean | null;
  primaryCnae: CompanyCnae;
  secondaryCnaes: CompanyCnae[];
  address: CompanyAddress;
  contacts: CompanyContacts;
  location: CompanyProviderLocation | null;
  /** Payload já higienizado (sem blocos de fontes removidas). Nunca enviado ao cliente. */
  payload: Record<string, unknown> | null;
};

/** Projeção histórica usada pelo mapa (lib/map/*). Mantida por compatibilidade. */
export type CompanySummary = {
  id: string;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  displayName: string;
  status: string | null;
  openedAt: string | null;
  primaryCnaeCode: string | null;
  primaryCnaeDescription: string | null;
  companySize: string | null;
  capitalSocial: number | null;
  email: string | null;
  phone: string | null;
  phoneIsMobile: boolean;
  headquartersOrBranch: HeadquartersOrBranch | null;
  neighborhood: string | null;
  cityName: string | null;
  cityIbge: string | null;
  stateCode: string | null;
  postalCode: string | null;
  /** Payload já higienizado (sem blocos de fontes removidas). */
  payload: Record<string, unknown> | null;
};

/**
 * Projeção enxuta e serializável para a tabela de resultados (componente client).
 * Não carrega payload bruto: reduz drasticamente o HTML/RSC enviado ao navegador.
 */
export type CompanyListItem = {
  id: string;
  position: number;
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  status: string | null;
  openedAt: string | null;
  headquartersOrBranch: HeadquartersOrBranch | null;
  size: string | null;
  shareCapital: number | null;
  simplesOptIn: boolean | null;
  meiOptIn: boolean | null;
  legalNature: string | null;
  primaryCnae: string | null;
  primaryCnaeDescription: string | null;
  secondaryCnaes: string[];
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  addressSummary: string | null;
  email: string | null;
  phone: string | null;
  phoneIsMobile: boolean;
  website: string | null;
  saved: boolean;
};

const cleanText = cleanString;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = cleanText(value)?.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!text) return null;
  if (["true", "1", "sim", "s", "optante"].includes(text)) return true;
  if (["false", "0", "nao", "n", "nao optante"].includes(text)) return false;
  return null;
}

function parseCnaeEntry(item: unknown): CompanyCnae | null {
  const record = asRecord(item);
  if (record) {
    const code = cleanText(record.codigo ?? record.code ?? record.id ?? record.subclasse);
    const description = cleanText(record.descricao ?? record.description ?? record.text);
    if (!code && !description) return null;
    return { code: code ? code.replace(/\D/g, "") || code : null, description };
  }
  const text = cleanText(item);
  if (!text) return null;
  const match = text.match(/^(\d[\d./-]{5,})\s*[-–:]?\s*(.*)$/);
  if (match) return { code: match[1].replace(/\D/g, ""), description: match[2] || null };
  return { code: null, description: text };
}

export function parseSecondaryCnaes(value: unknown): CompanyCnae[] {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const seen = new Set<string>();
  const result: CompanyCnae[] = [];
  for (const item of list) {
    const parsed = parseCnaeEntry(item);
    if (!parsed) continue;
    const key = `${parsed.code ?? ""}|${parsed.description ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(parsed);
  }
  return result;
}

function findPayloadValue(payload: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5) return null;
  const record = asRecord(payload);
  if (!record) return null;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
  }
  for (const nestedKey of ["casadosdados_detalhe", "casadosdados_pesquisa", "data", "estabelecimento", "pesquisa"]) {
    if (nestedKey in record) {
      const found = findPayloadValue(record[nestedKey], keys, depth + 1);
      if (found !== null && found !== undefined) return found;
    }
  }
  return null;
}

/**
 * Matriz/filial: prioriza o campo da Casa dos Dados (`matriz_filial`,
 * `identificador_matriz_filial`); na ausência, usa a regra oficial do CNPJ
 * (ordem 0001 = matriz), válida também para o CNPJ alfanumérico.
 */
export function resolveHeadquartersOrBranch(cnpj: string | null, payload: unknown): HeadquartersOrBranch | null {
  const raw = findPayloadValue(payload, ["matriz_filial", "identificador_matriz_filial", "tipo_estabelecimento"]);
  const record = asRecord(raw);
  const text = cleanText(record ? record.descricao ?? record.codigo ?? record.id : raw)
    ?.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (text) {
    if (text === "1" || text.startsWith("matriz")) return "matriz";
    if (text === "2" || text.startsWith("filial")) return "filial";
  }
  const normalized = (cnpj ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (normalized.length !== 14) return null;
  return normalized.slice(8, 12) === "0001" ? "matriz" : "filial";
}

function readDetailFetchedAt(payload: unknown): string | null {
  const value = findPayloadValue(payload, ["casadosdados_detalhe_em"]);
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * Adapter principal: registro de estabelecimento (linha salva, já mesclada com o
 * payload do resultado) → Company.
 */
export function companyFromEstablishment(source: Record<string, unknown>): Company {
  const canonical = canonicalizeEstablishment(source);
  const display = canonical.display;
  const legalName = canonical.companyName ?? "Razão social não informada";
  const tradeName = canonical.tradeName;
  const payload = getEstablishmentPayload(display);
  const cnpj = canonical.cnpj ?? "";
  const coordinates = extractProviderCoordinates(payload ?? display.provider_payload) as {
    address: { latitude: number; longitude: number } | null;
    municipality: { latitude: number; longitude: number } | null;
  };
  const phone = normalizePhone(canonical.phone);
  const email = normalizeEmail(canonical.email);
  const state = normalizeUf(canonical.stateCode);
  const postalCode = normalizeCep(display.cep);
  const primaryCnaeCode = normalizeCnae(display.primary_cnae_code);
  const addressLine = cleanText(canonical.addressLine);
  const city = cleanText(canonical.cityName);
  const location: CompanyProviderLocation | null = coordinates.address
    ? { ...coordinates.address, precision: "address" }
    : coordinates.municipality
      ? { ...coordinates.municipality, precision: "city" }
      : null;

  return {
    id: String(source.id ?? cnpj),
    source: "casadosdados",
    provenance: {
      source: "casadosdados",
      detailFetchedAt: readDetailFetchedAt(display.provider_payload) ?? readDetailFetchedAt(payload)
    },
    quality: assessEstablishmentQuality({
      cnpj,
      companyName: legalName,
      tradeName,
      registrationStatus: canonical.registrationStatus,
      openedAt: cleanText(display.opened_at),
      primaryCnaeCode,
      legalNatureDescription: cleanText(display.legal_nature_description),
      companySize: canonical.companySizeLabel,
      capitalSocial: canonical.capitalSocialValue,
      email,
      phone: phone?.formatted ?? null,
      stateCode: state,
      cityName: city,
      cep: postalCode,
      addressLine,
      neighborhood: canonical.neighborhood
    }),
    cnpj,
    cnpjRoot: cleanText(display.cnpj_root) ?? (cnpj.length === 14 ? cnpj.slice(0, 8) : null),
    legalName,
    tradeName,
    displayName: tradeName || legalName,
    status: canonical.registrationStatus,
    openedAt: cleanText(display.opened_at),
    legalNature: {
      code: cleanText(display.legal_nature_code),
      description: cleanText(display.legal_nature_description)
    },
    headquartersOrBranch: resolveHeadquartersOrBranch(cnpj, payload ?? display.provider_payload),
    size: canonical.companySizeLabel,
    shareCapital: canonical.capitalSocialValue,
    simplesOptIn: canonical.simplesOptIn,
    meiOptIn: parseBoolean(display.mei_opt_in),
    primaryCnae: {
      code: primaryCnaeCode,
      description: cleanText(display.primary_cnae_description)
    },
    secondaryCnaes: parseSecondaryCnaes(display.secondary_cnaes),
    address: {
      street: addressLine,
      number: cleanText(display.address_number),
      complement: cleanText(display.complement),
      neighborhood: canonical.neighborhood,
      city,
      cityIbge: normalizeIbgeCode(display.city_ibge),
      state,
      postalCode,
      country: cleanText(display.country),
      summary: buildAddressSummary(display)
    },
    contacts: {
      email,
      phone: phone?.formatted ?? null,
      phoneIsMobile: phone?.isMobile ?? false,
      website: normalizeWebsite(display.website)
    },
    location,
    payload
  };
}

/** Adapter direto do resultado normalizado da Casa dos Dados (antes de persistir). */
export function companyFromNormalized(row: NormalizedEstablishment): Company {
  return companyFromEstablishment(normalizedToPresenterSource(row));
}

/** Linha de `search_results` com join `establishments(*)` → Company (null sem estabelecimento). */
export function companyFromSearchRow(row: { establishments?: unknown; provider_payload?: unknown }): Company | null {
  const establishment = extractSingleObject(row.establishments);
  if (!establishment) return null;
  return companyFromEstablishment(mergeEstablishmentSources(establishment, extractSingleObject(row.provider_payload)));
}

export function toCompanySummary(company: Company): CompanySummary {
  return {
    id: company.id,
    cnpj: company.cnpj,
    legalName: company.legalName,
    tradeName: company.tradeName,
    displayName: company.displayName,
    status: company.status,
    openedAt: company.openedAt,
    primaryCnaeCode: company.primaryCnae.code,
    primaryCnaeDescription: company.primaryCnae.description,
    companySize: company.size,
    capitalSocial: company.shareCapital,
    email: company.contacts.email,
    phone: company.contacts.phone,
    phoneIsMobile: company.contacts.phoneIsMobile,
    headquartersOrBranch: company.headquartersOrBranch,
    neighborhood: company.address.neighborhood,
    cityName: company.address.city,
    cityIbge: company.address.cityIbge,
    stateCode: company.address.state,
    postalCode: company.address.postalCode,
    payload: company.payload
  };
}

function formatCnaeLabel(cnae: CompanyCnae) {
  if (cnae.code && cnae.description) return `${cnae.code} - ${cnae.description}`;
  return cnae.description ?? cnae.code ?? "";
}

export function toCompanyListItem(company: Company, extra: { position: number; saved?: boolean }): CompanyListItem {
  return {
    id: company.id,
    position: extra.position,
    cnpj: company.cnpj,
    legalName: company.legalName,
    tradeName: company.tradeName,
    status: company.status,
    openedAt: company.openedAt,
    headquartersOrBranch: company.headquartersOrBranch,
    size: company.size,
    shareCapital: company.shareCapital,
    simplesOptIn: company.simplesOptIn,
    meiOptIn: company.meiOptIn,
    legalNature: company.legalNature.description,
    primaryCnae: company.primaryCnae.code,
    primaryCnaeDescription: company.primaryCnae.description,
    secondaryCnaes: company.secondaryCnaes.map(formatCnaeLabel).filter(Boolean),
    city: company.address.city,
    state: company.address.state,
    neighborhood: company.address.neighborhood,
    postalCode: company.address.postalCode,
    addressSummary: company.address.summary,
    email: company.contacts.email,
    phone: company.contacts.phone,
    phoneIsMobile: company.contacts.phoneIsMobile,
    website: company.contacts.website,
    saved: extra.saved === true
  };
}

/** Compatibilidade: mesma assinatura usada pelo mapa e pelos testes existentes. */
export function companySummaryFromSearchRow(row: { establishments?: unknown; provider_payload?: unknown }): CompanySummary | null {
  const company = companyFromSearchRow(row);
  return company ? toCompanySummary(company) : null;
}

export function companySummaryFromEstablishment(source: Record<string, unknown>): CompanySummary {
  return toCompanySummary(companyFromEstablishment(source));
}

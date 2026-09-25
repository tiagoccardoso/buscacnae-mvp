import type { NormalizedEstablishment } from "@/lib/types";
import { countFilledFields } from "./dedupe";
import {
  cleanString,
  isValidCnpj,
  normalizeAddressNumber,
  normalizeAddressText,
  normalizeCep,
  normalizeCnae,
  normalizeCnpjValue,
  normalizeCompanyName,
  normalizeEmail,
  normalizeIbgeCode,
  normalizeIsoDate,
  normalizeMunicipalityName,
  normalizePhone,
  normalizeUf,
  normalizeWebsite
} from "./normalize";

function digitsOrNull(value: unknown) {
  const text = cleanString(value);
  const digits = text ? text.replace(/\D/g, "") : "";
  return digits || null;
}

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Etapa única de higienização do adapter da Casa dos Dados: toda linha normalizada
 * passa por aqui antes de chegar à persistência, à lista, à ficha, ao mapa ou à IA.
 * Idempotente: aplicar duas vezes produz o mesmo resultado.
 */
export function cleanNormalizedEstablishment(row: NormalizedEstablishment): NormalizedEstablishment {
  const cnpj = normalizeCnpjValue(row.cnpj) ?? row.cnpj;
  const phone = normalizePhone(row.phone);
  return {
    ...row,
    cnpj,
    cnpjRoot: cnpj.length === 14 ? cnpj.slice(0, 8) : digitsOrNull(row.cnpjRoot),
    companyName: normalizeCompanyName(row.companyName) ?? "Sem razão social",
    tradeName: normalizeCompanyName(row.tradeName),
    registrationStatus: cleanString(row.registrationStatus),
    openedAt: normalizeIsoDate(row.openedAt),
    primaryCnaeCode: normalizeCnae(row.primaryCnaeCode),
    primaryCnaeDescription: cleanString(row.primaryCnaeDescription),
    legalNatureCode: digitsOrNull(row.legalNatureCode),
    legalNatureDescription: cleanString(row.legalNatureDescription),
    companySize: cleanString(row.companySize),
    capitalSocial: finiteNonNegative(row.capitalSocial),
    email: normalizeEmail(row.email),
    phone: phone ? phone.formatted : null,
    website: normalizeWebsite(row.website),
    country: cleanString(row.country),
    stateCode: normalizeUf(row.stateCode),
    cityName: normalizeMunicipalityName(row.cityName),
    cityIbge: normalizeIbgeCode(row.cityIbge),
    neighborhood: normalizeAddressText(row.neighborhood),
    cep: normalizeCep(row.cep),
    addressLine: normalizeAddressText(row.addressLine),
    addressNumber: normalizeAddressNumber(row.addressNumber),
    complement: normalizeAddressText(row.complement)
  };
}

export type DataQualityIssue =
  | "cnpj_check_digits"
  | "missing_primary_cnae"
  | "missing_address"
  | "missing_postal_code"
  | "missing_city"
  | "missing_contact";

export type DataQualityReport = {
  issues: DataQualityIssue[];
  /** 0–1: fração dos campos comerciais relevantes preenchidos. */
  completeness: number;
};

const COMPLETENESS_FIELDS = [
  "tradeName",
  "registrationStatus",
  "openedAt",
  "primaryCnaeCode",
  "legalNatureDescription",
  "companySize",
  "capitalSocial",
  "email",
  "phone",
  "stateCode",
  "cityName",
  "cep",
  "addressLine",
  "neighborhood"
] as const;

/** Diagnóstico (não destrutivo) de uma linha já higienizada. */
export function assessEstablishmentQuality(row: NormalizedEstablishment): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  if (!isValidCnpj(row.cnpj)) issues.push("cnpj_check_digits");
  if (!row.primaryCnaeCode) issues.push("missing_primary_cnae");
  if (!row.addressLine) issues.push("missing_address");
  if (!row.cep) issues.push("missing_postal_code");
  if (!row.cityName || !row.stateCode) issues.push("missing_city");
  if (!row.email && !row.phone) issues.push("missing_contact");
  const filled = countFilledFields(row as unknown as Record<string, unknown>, COMPLETENESS_FIELDS);
  return { issues, completeness: Math.round((filled / COMPLETENESS_FIELDS.length) * 100) / 100 };
}

/**
 * Entre duas versões do mesmo CNPJ, mantém a mais completa como base e completa
 * campos vazios com a outra (nunca sobrescreve um valor existente).
 */
export function mergeDuplicateEstablishments(a: NormalizedEstablishment, b: NormalizedEstablishment): NormalizedEstablishment {
  const scoreA = countFilledFields(a as unknown as Record<string, unknown>, COMPLETENESS_FIELDS);
  const scoreB = countFilledFields(b as unknown as Record<string, unknown>, COMPLETENESS_FIELDS);
  const [base, extra] = scoreB > scoreA ? [b, a] : [a, b];
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = merged[key];
    const empty = current === null || current === undefined || (typeof current === "string" && !current.trim());
    if (empty && value !== null && value !== undefined) merged[key] = value;
  }
  return merged as NormalizedEstablishment;
}

import { buildDisplayEstablishment, type DisplayEstablishment } from "@/lib/establishment-presenter";
import type { NormalizedEstablishment } from "@/lib/types";

function asCleanString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    if (["-", "—", "null", "undefined", "n/a", "na", "nao informado", "não informado", "sem email", "sem e-mail", "sem telefone"].includes(normalized)) {
      return null;
    }
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneUnknown(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, cloneUnknown(nested)])
    );
  }
  return value;
}

function mergeUnknownObjects(base: unknown, overlay: unknown): unknown {
  const baseRecord = asRecord(base);
  const overlayRecord = asRecord(overlay);

  if (!baseRecord && !overlayRecord) {
    return overlay ?? base;
  }

  if (!baseRecord) return cloneUnknown(overlayRecord);
  if (!overlayRecord) return cloneUnknown(baseRecord);

  const result: Record<string, unknown> = { ...cloneUnknown(baseRecord) as Record<string, unknown> };

  for (const [key, overlayValue] of Object.entries(overlayRecord)) {
    const baseValue = result[key];
    const merged = mergeUnknownObjects(baseValue, overlayValue);
    result[key] = merged ?? cloneUnknown(overlayValue);
  }

  return result;
}

function pickPreferred<T>(primary: T | null | undefined, fallback: T | null | undefined): T | null {
  if (primary !== null && primary !== undefined) return primary;
  if (fallback !== null && fallback !== undefined) return fallback;
  return null;
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value
      .trim()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    if (["false", "0", "nao", "n", "no", "nao optante", "não optante"].includes(normalized)) return false;
    if (["true", "1", "sim", "s", "yes", "y", "optante"].includes(normalized)) return true;
  }
  return null;
}

function parseCapitalValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed
      .replace(/\s+/g, "")
      .replace(/R\$/gi, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseOpenedYear(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const yearPrefix = trimmed.match(/^(\d{4})/);
  if (yearPrefix) {
    const parsed = Number(yearPrefix[1]);
    return Number.isInteger(parsed) ? parsed : null;
  }
  const brazilianDate = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brazilianDate) {
    const parsed = Number(brazilianDate[3]);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}


function hasUsableEmail(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function hasUsablePhone(value: string | null): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10;
}

function hasUsableAddress(addressLine: string | null, neighborhood: string | null, cep: string | null): boolean {
  if (addressLine) return true;
  return Boolean(neighborhood && cep);
}

function isLikelyBrazilMobilePhone(value: string | null): boolean {
  if (!value) return false;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }
  if (digits.length === 11) {
    return digits.charAt(2) === "9";
  }
  if (digits.length === 9) {
    return digits.charAt(0) === "9";
  }
  return false;
}

function normalizeCompanySizeCode(value: string | null): string | null {
  if (!value) return null;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/empresa/g, " ")
    .replace(/porte/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;
  if (/(^| )mei( |$)|microempreendedor individual/.test(normalized)) return "mei";
  if (/(^| )micro( |$)|microempresa/.test(normalized)) return "micro";
  if (/pequeno|epp/.test(normalized)) return "small";
  if (/medio|m[eé]dio/.test(value.toLowerCase()) || /medio/.test(normalized)) return "medium";
  if (/grande/.test(normalized)) return "large";
  return normalized;
}

export type CanonicalEstablishment = {
  display: DisplayEstablishment;
  cnpj: string | null;
  companyName: string | null;
  tradeName: string | null;
  cityName: string | null;
  stateCode: string | null;
  registrationStatus: string | null;
  email: string | null;
  phone: string | null;
  neighborhood: string | null;
  addressLine: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  hasAddress: boolean;
  isMobilePhone: boolean;
  companySizeLabel: string | null;
  companySizeCode: string | null;
  simplesOptIn: boolean | null;
  capitalSocialValue: number | null;
  openedYear: number | null;
};

export function mergeProviderPayloads(base: unknown, overlay: unknown) {
  return mergeUnknownObjects(base, overlay);
}

export function mergeEstablishmentSources(
  base: Record<string, unknown>,
  overlay: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!overlay) return { ...base };

  const mergedProviderPayload = mergeProviderPayloads(base.provider_payload, overlay.provider_payload);

  return {
    ...base,
    ...overlay,
    provider_payload: mergedProviderPayload,
  };
}

export function canonicalizeEstablishment(source: Record<string, unknown>): CanonicalEstablishment {
  const display = buildDisplayEstablishment(source);
  const email = asCleanString(display.email);
  const phone = asCleanString(display.phone);
  const addressLine = asCleanString(display.address_line);
  const companySizeLabel = asCleanString(display.company_size);
  const cep = asCleanString(display.cep);

  return {
    display,
    cnpj: asCleanString(display.cnpj),
    companyName: asCleanString(display.company_name),
    tradeName: asCleanString(display.trade_name),
    cityName: asCleanString(display.city_name),
    stateCode: asCleanString(display.state_code),
    registrationStatus: asCleanString(display.registration_status),
    email,
    phone,
    neighborhood: asCleanString(display.neighborhood),
    addressLine,
    hasEmail: hasUsableEmail(email),
    hasPhone: hasUsablePhone(phone),
    hasAddress: hasUsableAddress(addressLine, asCleanString(display.neighborhood), cep),
    isMobilePhone: isLikelyBrazilMobilePhone(phone),
    companySizeLabel,
    companySizeCode: normalizeCompanySizeCode(companySizeLabel),
    simplesOptIn: parseBooleanLike(display.simples_opt_in),
    capitalSocialValue: parseCapitalValue(display.capital_social),
    openedYear: parseOpenedYear(asCleanString(display.opened_at)),
  };
}

export function normalizedToPresenterSource(row: NormalizedEstablishment): Record<string, unknown> {
  return {
    cnpj: row.cnpj,
    cnpj_root: row.cnpjRoot,
    company_name: row.companyName,
    trade_name: row.tradeName,
    registration_status: row.registrationStatus,
    opened_at: row.openedAt,
    primary_cnae_code: row.primaryCnaeCode,
    primary_cnae_description: row.primaryCnaeDescription,
    secondary_cnaes: row.secondaryCnaes,
    legal_nature_code: row.legalNatureCode,
    legal_nature_description: row.legalNatureDescription,
    company_size: row.companySize,
    simples_opt_in: row.simplesOptIn,
    mei_opt_in: row.meiOptIn,
    capital_social: row.capitalSocial,
    email: row.email,
    phone: row.phone,
    website: row.website,
    country: row.country,
    state_code: row.stateCode,
    city_name: row.cityName,
    city_ibge: row.cityIbge,
    neighborhood: row.neighborhood,
    cep: row.cep,
    address_line: row.addressLine,
    address_number: row.addressNumber,
    complement: row.complement,
    provider_payload: row.providerPayload,
  };
}

export function hydrateNormalizedEstablishment(row: NormalizedEstablishment): NormalizedEstablishment {
  const canonical = canonicalizeEstablishment(normalizedToPresenterSource(row));
  return {
    ...row,
    cnpj: canonical.cnpj ?? row.cnpj,
    companyName: canonical.companyName ?? row.companyName,
    tradeName: canonical.tradeName ?? row.tradeName ?? null,
    registrationStatus: canonical.registrationStatus ?? row.registrationStatus ?? null,
    openedAt: canonical.display.opened_at as string | null,
    companySize: canonical.companySizeLabel ?? row.companySize ?? null,
    simplesOptIn: canonical.simplesOptIn,
    capitalSocial: canonical.capitalSocialValue,
    email: canonical.email,
    phone: canonical.phone,
    stateCode: canonical.stateCode ?? row.stateCode ?? null,
    cityName: canonical.cityName ?? row.cityName ?? null,
    neighborhood: canonical.neighborhood ?? row.neighborhood ?? null,
    addressLine: canonical.addressLine,
  };
}

export function mergeNormalizedEstablishments(
  primary: NormalizedEstablishment,
  secondary: NormalizedEstablishment
): NormalizedEstablishment {
  const hydratedPrimary = hydrateNormalizedEstablishment(primary);
  const hydratedSecondary = hydrateNormalizedEstablishment(secondary);
  const primaryCanonical = canonicalizeEstablishment(normalizedToPresenterSource(hydratedPrimary));
  const secondaryCanonical = canonicalizeEstablishment(normalizedToPresenterSource(hydratedSecondary));

  return {
    cnpj: primary.cnpj || secondary.cnpj,
    cnpjRoot: pickPreferred(hydratedPrimary.cnpjRoot, hydratedSecondary.cnpjRoot),
    companyName: pickPreferred(primaryCanonical.companyName, secondaryCanonical.companyName) ?? hydratedPrimary.companyName ?? hydratedSecondary.companyName ?? "Sem razão social",
    tradeName: pickPreferred(primaryCanonical.tradeName, secondaryCanonical.tradeName),
    registrationStatus: pickPreferred(primaryCanonical.registrationStatus, secondaryCanonical.registrationStatus),
    openedAt: pickPreferred(primaryCanonical.display.opened_at as string | null, secondaryCanonical.display.opened_at as string | null),
    primaryCnaeCode: pickPreferred(hydratedPrimary.primaryCnaeCode, hydratedSecondary.primaryCnaeCode),
    primaryCnaeDescription: pickPreferred(hydratedPrimary.primaryCnaeDescription, hydratedSecondary.primaryCnaeDescription),
    secondaryCnaes: hydratedPrimary.secondaryCnaes ?? hydratedSecondary.secondaryCnaes ?? null,
    legalNatureCode: pickPreferred(hydratedPrimary.legalNatureCode, hydratedSecondary.legalNatureCode),
    legalNatureDescription: pickPreferred(hydratedPrimary.legalNatureDescription, hydratedSecondary.legalNatureDescription),
    companySize: pickPreferred(primaryCanonical.companySizeLabel, secondaryCanonical.companySizeLabel),
    simplesOptIn: pickPreferred(primaryCanonical.simplesOptIn, secondaryCanonical.simplesOptIn),
    meiOptIn: pickPreferred(hydratedPrimary.meiOptIn, hydratedSecondary.meiOptIn),
    capitalSocial: pickPreferred(primaryCanonical.capitalSocialValue, secondaryCanonical.capitalSocialValue),
    email: pickPreferred(primaryCanonical.email, secondaryCanonical.email),
    phone: pickPreferred(primaryCanonical.phone, secondaryCanonical.phone),
    website: pickPreferred(hydratedPrimary.website, hydratedSecondary.website),
    country: pickPreferred(hydratedPrimary.country, hydratedSecondary.country),
    stateCode: pickPreferred(primaryCanonical.stateCode, secondaryCanonical.stateCode),
    cityName: pickPreferred(primaryCanonical.cityName, secondaryCanonical.cityName),
    cityIbge: pickPreferred(hydratedPrimary.cityIbge, hydratedSecondary.cityIbge),
    neighborhood: pickPreferred(primaryCanonical.neighborhood, secondaryCanonical.neighborhood),
    cep: pickPreferred(hydratedPrimary.cep, hydratedSecondary.cep),
    addressLine: pickPreferred(primaryCanonical.addressLine, secondaryCanonical.addressLine),
    addressNumber: pickPreferred(hydratedPrimary.addressNumber, hydratedSecondary.addressNumber),
    complement: pickPreferred(hydratedPrimary.complement, hydratedSecondary.complement),
    providerPayload: mergeProviderPayloads(hydratedPrimary.providerPayload, hydratedSecondary.providerPayload),
  };
}

export function normalizeCompanySizeInput(value: string): string | null {
  return normalizeCompanySizeCode(value);
}

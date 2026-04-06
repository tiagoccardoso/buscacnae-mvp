import { buildDisplayEstablishment, type DisplayEstablishment } from "@/lib/establishment-presenter";
import type { NormalizedEstablishment } from "@/lib/types";

function asCleanString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "sim", "s", "yes", "y", "optante"].includes(normalized)) return true;
    if (["false", "0", "nao", "não", "n", "no", "nao optante", "não optante"].includes(normalized)) return false;
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

export function canonicalizeEstablishment(source: Record<string, unknown>): CanonicalEstablishment {
  const display = buildDisplayEstablishment(source);
  const email = asCleanString(display.email);
  const phone = asCleanString(display.phone);
  const addressLine = asCleanString(display.address_line);
  const companySizeLabel = asCleanString(display.company_size);
  const digits = (phone ?? "").replace(/\D/g, "");
  const subscriber = digits.length >= 9 ? digits.slice(-9) : digits;

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
    hasEmail: Boolean(email),
    hasPhone: Boolean(phone),
    hasAddress: Boolean(addressLine),
    isMobilePhone: digits.length >= 10 && ["9", "8", "7"].includes(subscriber.charAt(0)),
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

export function normalizeCompanySizeInput(value: string): string | null {
  return normalizeCompanySizeCode(value);
}

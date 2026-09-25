import { canonicalizeEstablishment, mergeEstablishmentSources } from "@/lib/establishment-canonical";
import { getEstablishmentPayload } from "@/lib/establishment-presenter";
import { extractSingleObject } from "@/lib/utils";

/**
 * Modelo empresarial normalizado consumido por Lista, Ficha (resumo) e Mapa.
 *
 * Fluxo: Casa dos Dados (resposta bruta) → adapter (lib/discovery/providers/casadosdados.ts,
 * NormalizedEstablishment) → persistência (establishments/search_results) →
 * canonicalizeEstablishment → CompanySummary.
 *
 * Não cria dados: campos ausentes na fonte permanecem null.
 */
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
  cityName: string | null;
  cityIbge: string | null;
  stateCode: string | null;
  postalCode: string | null;
  /** Payload já higienizado (sem blocos de fontes removidas). */
  payload: Record<string, unknown> | null;
};

function cleanText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Constrói o resumo a partir de uma linha de `search_results` com o join `establishments(*)`.
 * Retorna null quando a linha não tem estabelecimento associado.
 */
export function companySummaryFromSearchRow(row: { establishments?: unknown; provider_payload?: unknown }): CompanySummary | null {
  const establishment = extractSingleObject(row.establishments);
  if (!establishment) return null;
  const merged = mergeEstablishmentSources(establishment, extractSingleObject(row.provider_payload));
  return companySummaryFromEstablishment(merged);
}

export function companySummaryFromEstablishment(source: Record<string, unknown>): CompanySummary {
  const canonical = canonicalizeEstablishment(source);
  const display = canonical.display;
  const legalName = canonical.companyName ?? "Razão social não informada";
  const tradeName = canonical.tradeName;

  return {
    id: String(source.id ?? canonical.cnpj ?? ""),
    cnpj: canonical.cnpj ?? "",
    legalName,
    tradeName,
    displayName: tradeName || legalName,
    status: canonical.registrationStatus,
    openedAt: cleanText(display.opened_at),
    primaryCnaeCode: cleanText(display.primary_cnae_code),
    primaryCnaeDescription: cleanText(display.primary_cnae_description),
    companySize: canonical.companySizeLabel,
    capitalSocial: canonical.capitalSocialValue,
    email: canonical.email,
    phone: canonical.phone,
    cityName: canonical.cityName,
    cityIbge: cleanText(display.city_ibge),
    stateCode: canonical.stateCode ? canonical.stateCode.toUpperCase() : null,
    postalCode: cleanText(display.cep),
    payload: getEstablishmentPayload(display)
  };
}

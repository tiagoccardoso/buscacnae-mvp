import type { ProvenanceValue, ScoreInput } from "./types";

export type EnrichmentFact = {
  fieldKey: "domain" | "digital_presence";
  value: unknown;
  source: string;
  collectedAt: string;
  confidence: number | null;
  isPersonal: false;
};

function normalizeDomain(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return hostname.includes(".") ? hostname : null;
  } catch {
    return null;
  }
}

export function deriveEnrichmentFacts(input: ScoreInput, collectedAt = new Date().toISOString()): EnrichmentFact[] {
  const website = String(input.website ?? "").trim();
  const domain = website ? normalizeDomain(website) : null;
  const facts: EnrichmentFact[] = [];

  if (domain) {
    facts.push({
      fieldKey: "domain",
      value: domain,
      source: "derived:establishments.website",
      collectedAt,
      confidence: 0.95,
      isPersonal: false
    });
  }

  facts.push({
    fieldKey: "digital_presence",
    value: {
      website: Boolean(domain),
      publicBusinessEmail: Boolean(String(input.email ?? "").trim()),
      publicBusinessPhone: Boolean(String(input.phone ?? "").trim())
    },
    source: "official:establishments",
    collectedAt,
    confidence: 1,
    isPersonal: false
  });

  return facts;
}

export function asCompanyProvenance<T>(value: T, source: string, collectedAt: string, confidence: number | null): ProvenanceValue<T> {
  return { value, source, collectedAt, confidence, dataClass: "company" };
}

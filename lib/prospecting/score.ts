import type { LeadScore, ScoreCriteria, ScoreInput, ScoreBreakdownItem } from "./types";

export const DEFAULT_SCORE_CRITERIA: ScoreCriteria = {
  targetStates: [],
  targetCnaeCodes: [],
  targetCompanySizes: [],
  minYearsActive: null,
  weights: {
    activeStatus: 15,
    companySize: 15,
    location: 20,
    cnae: 20,
    tenure: 15,
    digitalPresence: 15
  }
};

const SIZE_ALIASES: Record<string, string> = {
  mei: "mei",
  micro: "micro",
  microempresa: "micro",
  pequena: "small",
  pequeno: "small",
  epp: "small",
  media: "medium",
  medio: "medium",
  média: "medium",
  médio: "medium",
  grande: "large"
};

function clean(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanList(values: unknown, normalize = clean) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(normalize).filter(Boolean)));
}

function asWeight(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback;
}

export function normalizeScoreCriteria(value: unknown): ScoreCriteria {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sourceWeights = source.weights && typeof source.weights === "object" && !Array.isArray(source.weights)
    ? source.weights as Record<string, unknown>
    : {};
  const defaults = DEFAULT_SCORE_CRITERIA;
  const minYears = Number(source.minYearsActive);

  return {
    targetStates: cleanList(source.targetStates),
    targetCnaeCodes: cleanList(source.targetCnaeCodes, (item) => String(item).replace(/\D/g, "")),
    targetCompanySizes: cleanList(source.targetCompanySizes, (item) => SIZE_ALIASES[clean(item)] ?? clean(item)),
    minYearsActive: Number.isInteger(minYears) && minYears >= 0 && minYears <= 200 ? minYears : defaults.minYearsActive,
    weights: {
      activeStatus: asWeight(sourceWeights.activeStatus, defaults.weights.activeStatus),
      companySize: asWeight(sourceWeights.companySize, defaults.weights.companySize),
      location: asWeight(sourceWeights.location, defaults.weights.location),
      cnae: asWeight(sourceWeights.cnae, defaults.weights.cnae),
      tenure: asWeight(sourceWeights.tenure, defaults.weights.tenure),
      digitalPresence: asWeight(sourceWeights.digitalPresence, defaults.weights.digitalPresence)
    }
  };
}

function parseOpenedYear(value: string | null | undefined) {
  const match = String(value ?? "").match(/^(\d{4})|\/(\d{4})$/);
  return match ? Number(match[1] ?? match[2]) : null;
}

function yearsActive(openedAt: string | null | undefined, referenceDate: Date) {
  const year = parseOpenedYear(openedAt);
  if (!year || year > referenceDate.getUTCFullYear()) return null;
  return Math.max(0, referenceDate.getUTCFullYear() - year);
}

function fractionForTenure(input: ScoreInput, criteria: ScoreCriteria, referenceDate: Date) {
  const years = yearsActive(input.openedAt, referenceDate);
  if (years === null) return { fraction: 0, reason: "tempo de atividade não informado" };
  if (criteria.minYearsActive !== null) {
    return {
      fraction: criteria.minYearsActive === 0 || years >= criteria.minYearsActive ? 1 : years / criteria.minYearsActive,
      reason: `${years} ano(s) de atividade; alvo: ${criteria.minYearsActive}`
    };
  }
  return { fraction: Math.min(1, years / 10), reason: `${years} ano(s) de atividade` };
}

function item(key: ScoreBreakdownItem["key"], label: string, points: number, maxPoints: number, reason: string): ScoreBreakdownItem {
  return { key, label, points: Math.round(points * 100) / 100, maxPoints, reason };
}

export function calculateLeadScore(
  input: ScoreInput,
  criteriaInput: unknown = DEFAULT_SCORE_CRITERIA,
  referenceDate = new Date()
): LeadScore {
  const criteria = normalizeScoreCriteria(criteriaInput);
  const size = SIZE_ALIASES[clean(input.companySize)] ?? clean(input.companySize);
  const state = clean(input.stateCode);
  const cnae = String(input.primaryCnaeCode ?? "").replace(/\D/g, "");
  const statusActive = clean(input.registrationStatus).startsWith("ativa");
  const hasDigitalPresence = Boolean(String(input.website ?? "").trim()) || Boolean(String(input.email ?? "").trim());
  const tenure = fractionForTenure(input, criteria, referenceDate);
  const sizePoints = criteria.targetCompanySizes.length === 0
    ? criteria.weights.companySize * ({ large: 1, medium: 0.75, small: 0.5, micro: 0.25, mei: 0.1 }[size] ?? 0)
    : criteria.targetCompanySizes.includes(size) ? criteria.weights.companySize : 0;

  const breakdown = [
    item("activeStatus", "Situação cadastral", statusActive ? criteria.weights.activeStatus : 0, criteria.weights.activeStatus, statusActive ? "empresa ativa" : "empresa não marcada como ativa"),
    item("companySize", "Porte", sizePoints, criteria.weights.companySize, criteria.targetCompanySizes.length === 0 ? `porte considerado: ${size || "não informado"}` : criteria.targetCompanySizes.includes(size) ? "porte está no alvo configurado" : "porte fora do alvo configurado"),
    item("location", "Localização", criteria.targetStates.length > 0 && criteria.targetStates.includes(state) ? criteria.weights.location : 0, criteria.weights.location, criteria.targetStates.length > 0 ? (criteria.targetStates.includes(state) ? "UF está no alvo configurado" : "UF fora do alvo configurado") : "nenhuma UF-alvo configurada"),
    item("cnae", "CNAE", criteria.targetCnaeCodes.length > 0 && criteria.targetCnaeCodes.includes(cnae) ? criteria.weights.cnae : 0, criteria.weights.cnae, criteria.targetCnaeCodes.length > 0 ? (criteria.targetCnaeCodes.includes(cnae) ? "CNAE está no alvo configurado" : "CNAE fora do alvo configurado") : "nenhum CNAE-alvo configurado"),
    item("tenure", "Tempo de atividade", tenure.fraction * criteria.weights.tenure, criteria.weights.tenure, tenure.reason),
    item("digitalPresence", "Presença digital", hasDigitalPresence ? criteria.weights.digitalPresence : 0, criteria.weights.digitalPresence, hasDigitalPresence ? "site ou e-mail empresarial informado" : "site e e-mail não informados")
  ];

  const score = Math.max(0, Math.min(100, Math.round(breakdown.reduce((total, current) => total + current.points, 0))));
  return { score, breakdown };
}

export function scoreExplanation(score: LeadScore) {
  return score.breakdown
    .filter((entry) => entry.points > 0)
    .map((entry) => `${entry.label}: ${entry.points}/${entry.maxPoints} — ${entry.reason}`)
    .join("; ");
}

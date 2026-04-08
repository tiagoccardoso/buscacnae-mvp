export type LeadPricingTierKey = "basic" | "phone" | "email" | "complete";

export type LeadPricingTier = {
  key: LeadPricingTierKey;
  label: string;
  unitAmountCents: number;
  count: number;
  subtotalAmountCents: number;
  helperText: string;
};

export type LeadPricingSummary = {
  totalLeads: number;
  totalAmountCents: number;
  averageUnitAmountCents: number;
  tiers: LeadPricingTier[];
};

type ContactLike = {
  email?: string | null;
  phone?: string | null;
  providerPayload?: unknown;
  provider_payload?: unknown;
};

export type LeadContactSignals = {
  emails: string[];
  phones: string[];
  hasEmail: boolean;
  hasPhone: boolean;
};

export const LEAD_PRICING_TABLE: Array<{ key: LeadPricingTierKey; label: string; unitAmountCents: number; helperText: string }> = [
  { key: "basic", label: "Base", unitAmountCents: 5, helperText: "Registro com dados cadastrais essenciais." },
  { key: "phone", label: "Contato", unitAmountCents: 10, helperText: "Registro com informações adicionais úteis para abordagem." },
  { key: "email", label: "Contato plus", unitAmountCents: 15, helperText: "Registro com mais sinais disponíveis para prospecção." },
  { key: "complete", label: "Completo", unitAmountCents: 20, helperText: "Registro com maior nível de detalhamento disponível." }
];

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_KEY_HINT_REGEX = /(phone|telefone|celular|whatsapp|contato_telefonico|contato telefonico|completo|ddd|numero)/i;
const EMAIL_KEY_HINT_REGEX = /(email|e-mail|mail|contato_email|contato email)/i;
const INVALID_TEXT_REGEX = /^(nao informado|não informado|nao identificado|não identificado|sem email|sem e-mail|sem telefone|null|undefined|n\/a|na)$/i;

function hasTrimmedText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmailCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || INVALID_TEXT_REGEX.test(normalized)) {
    return null;
  }

  const match = normalized.match(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i);
  return match ? match[0] : null;
}

function normalizePhoneCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || INVALID_TEXT_REGEX.test(trimmed)) {
    return null;
  }

  if (trimmed.includes("*") || trimmed.includes("x") || trimmed.includes("X")) {
    return null;
  }

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }

  if (digits.length < 8 || digits.length > 11) {
    return null;
  }

  if (/^(\d)\1+$/.test(digits)) {
    return null;
  }

  return digits;
}

function tryParseStructuredString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (!["{", "["].includes(trimmed[0]) && !trimmed.includes("\"email\"") && !trimmed.includes("\"telefone\""))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function collectFromString(value: string, keyHint: string, emails: Set<string>, phones: Set<string>) {
  const normalizedDirectEmail = normalizeEmailCandidate(value);
  if (normalizedDirectEmail) {
    emails.add(normalizedDirectEmail);
  }

  const matchedEmails = value.match(EMAIL_REGEX) ?? [];
  for (const email of matchedEmails) {
    const normalizedEmail = normalizeEmailCandidate(email);
    if (normalizedEmail) {
      emails.add(normalizedEmail);
    }
  }

  if (PHONE_KEY_HINT_REGEX.test(keyHint) || /^\+?[\d\s().-]+$/.test(value.trim())) {
    const normalizedPhone = normalizePhoneCandidate(value);
    if (normalizedPhone) {
      phones.add(normalizedPhone);
    }
  }

  const parsed = tryParseStructuredString(value);
  if (parsed && parsed !== value) {
    collectContactSignals(parsed, emails, phones, keyHint);
  }
}

function collectFromObject(record: Record<string, unknown>, emails: Set<string>, phones: Set<string>, keyHint: string) {
  const ddd = typeof record.ddd === "string" || typeof record.ddd === "number" ? String(record.ddd) : "";
  const numero = typeof record.numero === "string" || typeof record.numero === "number" ? String(record.numero) : "";
  const completo = typeof record.completo === "string" ? record.completo : "";

  if (completo) {
    const normalizedPhone = normalizePhoneCandidate(completo);
    if (normalizedPhone) {
      phones.add(normalizedPhone);
    }
  }

  if (ddd || numero) {
    const combined = `${ddd}${numero}`;
    const normalizedPhone = normalizePhoneCandidate(combined);
    if (normalizedPhone) {
      phones.add(normalizedPhone);
    }
  }

  for (const [nestedKey, nestedValue] of Object.entries(record)) {
    const composedHint = keyHint ? `${keyHint}.${nestedKey}` : nestedKey;

    if (EMAIL_KEY_HINT_REGEX.test(composedHint) && typeof nestedValue === "string") {
      const normalizedEmail = normalizeEmailCandidate(nestedValue);
      if (normalizedEmail) {
        emails.add(normalizedEmail);
      }
    }

    if (PHONE_KEY_HINT_REGEX.test(composedHint)) {
      if (typeof nestedValue === "string") {
        const normalizedPhone = normalizePhoneCandidate(nestedValue);
        if (normalizedPhone) {
          phones.add(normalizedPhone);
        }
      }
      if (typeof nestedValue === "number") {
        const normalizedPhone = normalizePhoneCandidate(String(nestedValue));
        if (normalizedPhone) {
          phones.add(normalizedPhone);
        }
      }
    }

    collectContactSignals(nestedValue, emails, phones, composedHint);
  }
}

function collectContactSignals(value: unknown, emails: Set<string>, phones: Set<string>, keyHint = "") {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    collectFromString(value, keyHint, emails, phones);
    return;
  }

  if (typeof value === "number") {
    if (PHONE_KEY_HINT_REGEX.test(keyHint)) {
      const normalizedPhone = normalizePhoneCandidate(String(value));
      if (normalizedPhone) {
        phones.add(normalizedPhone);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectContactSignals(item, emails, phones, keyHint);
    }
    return;
  }

  if (typeof value === "object") {
    collectFromObject(value as Record<string, unknown>, emails, phones, keyHint);
  }
}

export function extractLeadContactSignals(lead: ContactLike): LeadContactSignals {
  const emails = new Set<string>();
  const phones = new Set<string>();

  if (hasTrimmedText(lead.email)) {
    const normalizedEmail = normalizeEmailCandidate(String(lead.email));
    if (normalizedEmail) {
      emails.add(normalizedEmail);
    }
  }

  if (hasTrimmedText(lead.phone)) {
    const normalizedPhone = normalizePhoneCandidate(String(lead.phone));
    if (normalizedPhone) {
      phones.add(normalizedPhone);
    }
  }

  collectContactSignals(lead.providerPayload, emails, phones, "providerPayload");
  collectContactSignals(lead.provider_payload, emails, phones, "provider_payload");

  return {
    emails: Array.from(emails),
    phones: Array.from(phones),
    hasEmail: emails.size > 0,
    hasPhone: phones.size > 0
  };
}

export function classifyLeadPricingTier(lead: ContactLike): LeadPricingTierKey {
  const signals = extractLeadContactSignals(lead);

  if (signals.hasEmail && signals.hasPhone) return "complete";
  if (signals.hasEmail) return "email";
  if (signals.hasPhone) return "phone";
  return "basic";
}

export function buildLeadPricingSummaryFromCounts(counts: Partial<Record<LeadPricingTierKey, number>>): LeadPricingSummary {
  const tiers = LEAD_PRICING_TABLE.map((tier) => {
    const count = Math.max(0, Math.trunc(counts[tier.key] ?? 0));
    return {
      ...tier,
      count,
      subtotalAmountCents: count * tier.unitAmountCents
    };
  });

  const totalLeads = tiers.reduce((sum, tier) => sum + tier.count, 0);
  const totalAmountCents = tiers.reduce((sum, tier) => sum + tier.subtotalAmountCents, 0);
  const averageUnitAmountCents = totalLeads > 0 ? Math.round(totalAmountCents / totalLeads) : 0;

  return {
    totalLeads,
    totalAmountCents,
    averageUnitAmountCents,
    tiers
  };
}

export function buildLeadPricingSummary(leads: ContactLike[]): LeadPricingSummary {
  const counts: Partial<Record<LeadPricingTierKey, number>> = {};

  for (const lead of leads) {
    const key = classifyLeadPricingTier(lead);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return buildLeadPricingSummaryFromCounts(counts);
}

export function readLeadPricingSummary(value: unknown): LeadPricingSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const counts: Partial<Record<LeadPricingTierKey, number>> = {
    basic: typeof record.basic === "number" ? record.basic : typeof record.basicCount === "number" ? record.basicCount : undefined,
    phone: typeof record.phone === "number" ? record.phone : typeof record.phoneCount === "number" ? record.phoneCount : undefined,
    email: typeof record.email === "number" ? record.email : typeof record.emailCount === "number" ? record.emailCount : undefined,
    complete: typeof record.complete === "number" ? record.complete : typeof record.completeCount === "number" ? record.completeCount : undefined
  };

  const summary = buildLeadPricingSummaryFromCounts(counts);
  const overrideTotal = typeof record.totalAmountCents === "number" ? record.totalAmountCents : null;
  if (overrideTotal !== null && Number.isFinite(overrideTotal) && overrideTotal >= 0) {
    return {
      ...summary,
      totalAmountCents: Math.trunc(overrideTotal),
      averageUnitAmountCents: summary.totalLeads > 0 ? Math.round(Math.trunc(overrideTotal) / summary.totalLeads) : 0
    };
  }

  return summary;
}

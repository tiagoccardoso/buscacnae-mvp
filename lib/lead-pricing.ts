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
};

const LEAD_PRICING_TABLE: Array<{ key: LeadPricingTierKey; label: string; unitAmountCents: number; helperText: string }> = [
  { key: "basic", label: "Básico (sem contato)", unitAmountCents: 5, helperText: "Lead sem telefone e sem e-mail." },
  { key: "phone", label: "Com telefone", unitAmountCents: 10, helperText: "Lead com telefone, mas sem e-mail." },
  { key: "email", label: "Com e-mail", unitAmountCents: 15, helperText: "Lead com e-mail, mas sem telefone." },
  { key: "complete", label: "Completo", unitAmountCents: 20, helperText: "Lead com telefone e e-mail." }
];

function hasTrimmedText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function classifyLeadPricingTier(lead: ContactLike): LeadPricingTierKey {
  const hasEmail = hasTrimmedText(lead.email);
  const hasPhone = hasTrimmedText(lead.phone);

  if (hasEmail && hasPhone) return "complete";
  if (hasEmail) return "email";
  if (hasPhone) return "phone";
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

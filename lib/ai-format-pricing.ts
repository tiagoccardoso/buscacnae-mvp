import { formatMoney } from "@/lib/format";

export type AiFormatPricingTier = {
  id: "up_to_50" | "from_51_to_200" | "from_201_to_500" | "from_501_to_1000" | "above_1000";
  label: string;
  minLeads: number;
  maxLeads: number | null;
  baseAmountCents: number;
  extraLeadUnitAmountCents: number;
};

export type AiFormattingPriceSummary = {
  totalLeads: number;
  amountCents: number;
  formattedAmount: string;
  tierLabel: string;
  baseAmountCents: number;
  extraLeadCount: number;
  extraLeadUnitAmountCents: number;
  hasAdditionalLeadCharge: boolean;
};

const AI_FORMAT_PRICING_TABLE: readonly AiFormatPricingTier[] = [
  {
    id: "up_to_50",
    label: "Até 50 leads",
    minLeads: 0,
    maxLeads: 50,
    baseAmountCents: 790,
    extraLeadUnitAmountCents: 0
  },
  {
    id: "from_51_to_200",
    label: "51 a 200 leads",
    minLeads: 51,
    maxLeads: 200,
    baseAmountCents: 1490,
    extraLeadUnitAmountCents: 0
  },
  {
    id: "from_201_to_500",
    label: "201 a 500 leads",
    minLeads: 201,
    maxLeads: 500,
    baseAmountCents: 2490,
    extraLeadUnitAmountCents: 0
  },
  {
    id: "from_501_to_1000",
    label: "501 a 1.000 leads",
    minLeads: 501,
    maxLeads: 1000,
    baseAmountCents: 3990,
    extraLeadUnitAmountCents: 0
  },
  {
    id: "above_1000",
    label: "Acima de 1.000 leads",
    minLeads: 1001,
    maxLeads: null,
    baseAmountCents: 3990,
    extraLeadUnitAmountCents: 3
  }
] as const;

function normalizeLeadCount(totalLeads: number) {
  if (!Number.isFinite(totalLeads)) return 0;
  return Math.max(0, Math.floor(totalLeads));
}

export function getAiFormatPricingTable() {
  return [...AI_FORMAT_PRICING_TABLE];
}

function findTierByLeadCount(totalLeads: number) {
  const normalized = normalizeLeadCount(totalLeads);

  return (
    AI_FORMAT_PRICING_TABLE.find((tier) => {
      if (normalized < tier.minLeads) return false;
      if (tier.maxLeads === null) return true;
      return normalized <= tier.maxLeads;
    }) ?? AI_FORMAT_PRICING_TABLE[AI_FORMAT_PRICING_TABLE.length - 1]
  );
}

export function getAiFormattingPriceSummary(totalLeads: number): AiFormattingPriceSummary {
  const normalizedLeadCount = normalizeLeadCount(totalLeads);
  const tier = findTierByLeadCount(normalizedLeadCount);
  const extraLeadCount = tier.maxLeads === null ? Math.max(0, normalizedLeadCount - 1000) : 0;
  const extraAmountCents = extraLeadCount * tier.extraLeadUnitAmountCents;
  const amountCents = tier.baseAmountCents + extraAmountCents;

  return {
    totalLeads: normalizedLeadCount,
    amountCents,
    formattedAmount: formatMoney(amountCents / 100),
    tierLabel: tier.label,
    baseAmountCents: tier.baseAmountCents,
    extraLeadCount,
    extraLeadUnitAmountCents: tier.extraLeadUnitAmountCents,
    hasAdditionalLeadCharge: extraLeadCount > 0
  };
}

export function getAiFormattingPriceCentsByLeadCount(totalLeads: number): number {
  return getAiFormattingPriceSummary(totalLeads).amountCents;
}

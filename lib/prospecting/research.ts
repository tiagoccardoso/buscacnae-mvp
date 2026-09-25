import type { ResearchBrief, ResearchClaim, ScoreInput } from "./types";

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function buildResearchBrief(input: ScoreInput & { companyName?: string | null; cityName?: string | null; stateCode?: string | null; primaryCnaeDescription?: string | null }, collectedAt = new Date().toISOString()): ResearchBrief {
  const name = clean(input.companyName) ?? "A empresa";
  const claims: ResearchClaim[] = [];
  const add = (key: string, value: string | null, source: string, dataClass: ResearchClaim["dataClass"] = "company", confidence: number | null = 1) => {
    if (!value) return;
    claims.push({ key, value, source, collectedAt, confidence, dataClass });
  };

  const location = [clean(input.cityName), clean(input.stateCode)].filter(Boolean).join("/");
  add("company_name", name, "official:establishments");
  add("location", location, "official:establishments");
  add("cnae", clean(input.primaryCnaeDescription) ?? clean(input.primaryCnaeCode), "official:establishments");
  add("company_size", clean(input.companySize), "official:establishments");
  add("registration_status", clean(input.registrationStatus), "official:establishments");
  add("opened_at", clean(input.openedAt), "official:establishments");
  add("website", clean(input.website), "official:establishments");

  const digital = Boolean(clean(input.website) || clean(input.email));
  const commercialProfile = digital
    ? "Empresa com presença digital ou canal empresarial informado; a adequação comercial precisa ser confirmada pelo usuário."
    : "Empresa sem presença digital ou canal empresarial informado na base oficial; a ausência não prova que não exista.";

  return {
    summary: `${name}${location ? ` está registrada em ${location}` : ""}${clean(input.primaryCnaeDescription) ? ` e atua em ${clean(input.primaryCnaeDescription)}` : ""}.`,
    commercialProfile: {
      value: commercialProfile,
      source: "inference:official:establishments",
      collectedAt,
      confidence: 0.6,
      dataClass: "inferred"
    },
    claims,
    limitations: [
      "O perfil comercial é uma hipótese assistida, não uma classificação oficial.",
      "A pesquisa não coleta nem armazena dados pessoais de contato.",
      "Afirmações externas só devem ser adicionadas quando acompanhadas da URL/fonte e data de coleta."
    ]
  };
}

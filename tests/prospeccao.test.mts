import assert from "node:assert/strict";
import test from "node:test";
import { deriveEnrichmentFacts } from "../lib/prospecting/enrichment.ts";
import { buildResearchBrief } from "../lib/prospecting/research.ts";
import { calculateLeadScore, normalizeScoreCriteria } from "../lib/prospecting/score.ts";

const referenceDate = new Date("2026-09-25T00:00:00.000Z");

test("normaliza critérios sem deixar o score depender de texto livre", () => {
  const criteria = normalizeScoreCriteria({
    targetStates: [" PR ", "pr"],
    targetCnaeCodes: ["69.20-6/01", "6920601"],
    targetCompanySizes: ["Média"],
    minYearsActive: "5"
  });

  assert.deepEqual(criteria.targetStates, ["pr"]);
  assert.deepEqual(criteria.targetCnaeCodes, ["6920601"]);
  assert.deepEqual(criteria.targetCompanySizes, ["medium"]);
  assert.equal(criteria.minYearsActive, 5);
});

test("score é determinístico, configurável e auditável", () => {
  const criteria = {
    targetStates: ["PR"],
    targetCnaeCodes: ["6920601"],
    targetCompanySizes: ["medium"],
    minYearsActive: 5,
    weights: { activeStatus: 15, companySize: 15, location: 20, cnae: 20, tenure: 15, digitalPresence: 15 }
  };
  const input = {
    registrationStatus: "ATIVA",
    companySize: "Média",
    stateCode: "PR",
    primaryCnaeCode: "69.20-6/01",
    openedAt: "2018-01-01",
    website: "https://empresa.example",
    email: "contato@empresa.example"
  };
  const score = calculateLeadScore(input, criteria, referenceDate);
  assert.equal(score.score, 100);
  assert.equal(score.breakdown.length, 6);
  assert.ok(score.breakdown.every((item) => item.points <= item.maxPoints));

  const mismatch = calculateLeadScore({ ...input, stateCode: "SP", primaryCnaeCode: "1234567", website: "", email: "" }, criteria, referenceDate);
  assert.ok(mismatch.score < score.score);
  assert.equal(calculateLeadScore(input, criteria, referenceDate).score, score.score);
});

test("enriquecimento registra domínio e presença sem duplicar contato", () => {
  const facts = deriveEnrichmentFacts({ website: "https://www.acme.com.br/oficial", email: "contato@acme.com.br", phone: "(41) 3333-0000" }, "2026-09-25T12:00:00.000Z");
  assert.deepEqual(facts[0], {
    fieldKey: "domain",
    value: "acme.com.br",
    source: "derived:establishments.website",
    collectedAt: "2026-09-25T12:00:00.000Z",
    confidence: 0.95,
    isPersonal: false
  });
  assert.equal(JSON.stringify(facts).includes("publicBusinessEmail"), true, "presença pode indicar canal empresarial");
  assert.equal(facts.some((fact) => fact.fieldKey === "email"), false, "e-mail não é copiado para o enriquecimento");
  assert.ok(facts.every((fact) => fact.source && fact.collectedAt && fact.confidence !== null));
});

test("pesquisa assistida separa fato oficial de hipótese comercial", () => {
  const brief = buildResearchBrief({
    companyName: "ACME LTDA",
    cityName: "Curitiba",
    stateCode: "PR",
    primaryCnaeDescription: "Atividades de contabilidade",
    registrationStatus: "ATIVA",
    website: "https://acme.com.br",
    email: "pessoa@acme.com.br",
    phone: "(41) 3333-0000"
  }, "2026-09-25T12:00:00.000Z");

  assert.match(brief.summary, /ACME LTDA/);
  assert.equal(brief.commercialProfile.dataClass, "inferred");
  assert.equal(brief.commercialProfile.source, "inference:official:establishments");
  assert.ok(brief.claims.every((claim) => claim.source === "official:establishments"));
  assert.equal(JSON.stringify(brief).includes("pessoa@acme.com.br"), false, "pesquisa não armazena contato");
});

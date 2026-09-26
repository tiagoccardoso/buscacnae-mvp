import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

/**
 * Fase 7 — integração com um Meilisearch REAL (opcional).
 *
 * Roda só com MEILISEARCH_TEST_URL (e MEILISEARCH_TEST_KEY, se houver chave mestra):
 *   docker run -p 7700:7700 getmeili/meilisearch:v1.54 (ou o binário)
 *   MEILISEARCH_TEST_URL=http://127.0.0.1:7700 MEILISEARCH_TEST_KEY=... npm test
 * Sem a variável, os testes são pulados (o CI não depende de infraestrutura externa).
 * Usa as MESMAS configurações de produção (COMPANY_INDEX_SETTINGS) e um índice descartável.
 */
const url = process.env.MEILISEARCH_TEST_URL ?? "";
const key = process.env.MEILISEARCH_TEST_KEY ?? "";
const skip = url ? false : "MEILISEARCH_TEST_URL não definida";

const { createMeiliClient } = await import("../lib/search/meilisearch.ts");
const index = await import("../lib/search/company-index.ts");
const { toCompanySearchDocument } = await import("../lib/search/company-documents.ts");
const { planCompanyQuery } = await import("../lib/search/company-query-plan.ts");

const UID = `test_companies_${process.pid}_${Date.now()}`;
const NOW = Math.floor(Date.UTC(2026, 8, 26) / 1000);
const P1 = "profile-1";
const P2 = "profile-2";
const W1 = "workspace-1";

const rows: Array<Record<string, unknown> & { visibility: { profileIds: string[]; workspaceIds: string[] }; daysAgo: number }> = [
  { cnpj: "11222333000181", company_name: "TRANSPORTADORA ZANELLA LTDA", trade_name: "Zanella Cargas", primary_cnae_code: "4930202", primary_cnae_description: "Transporte rodoviário de carga", city_name: "Pato Branco", city_ibge: "4118501", state_code: "PR", registration_status: "ATIVA", company_size: "EPP", visibility: { profileIds: [P1], workspaceIds: [] }, daysAgo: 2 },
  { cnpj: "11222333000262", company_name: "TRANSPORTADORA ZANELLA LTDA", trade_name: "Zanella Filial", primary_cnae_code: "4930202", primary_cnae_description: "Transporte rodoviário de carga", city_name: "Cascavel", city_ibge: "4104808", state_code: "PR", registration_status: "ATIVA", company_size: "EPP", visibility: { profileIds: [P1], workspaceIds: [] }, daysAgo: 2 },
  { cnpj: "44555666000102", company_name: "PADARIA CONCEICAO LTDA", trade_name: "Pão da Conceição", primary_cnae_code: "4721102", primary_cnae_description: "Padaria e confeitaria com predominância de revenda", city_name: "São Paulo", city_ibge: "3550308", state_code: "SP", registration_status: "ATIVA", company_size: "ME", visibility: { profileIds: [P1], workspaceIds: [] }, daysAgo: 5 },
  { cnpj: "55666777000144", company_name: "Logística Araújo & Gonçalves Ltda", trade_name: null, primary_cnae_code: "5250804", primary_cnae_description: "Organização logística do transporte de carga", city_name: "Curitiba", city_ibge: "4106902", state_code: "PR", registration_status: "BAIXADA", company_size: "DEMAIS", visibility: { profileIds: [], workspaceIds: [W1] }, daysAgo: 1 },
  { cnpj: "66777888000106", company_name: "TRANSPORTES SEGREDO LTDA", trade_name: null, primary_cnae_code: "4930202", primary_cnae_description: "Transporte rodoviário de carga", city_name: "Pato Branco", city_ibge: "4118501", state_code: "PR", registration_status: "ATIVA", company_size: "ME", visibility: { profileIds: [P2], workspaceIds: [] }, daysAgo: 1 },
  { cnpj: "99888777000155", company_name: "TRANSPORTES ANTIGOS LTDA", trade_name: null, primary_cnae_code: "4930202", primary_cnae_description: "Transporte rodoviário de carga", city_name: "Pato Branco", city_ibge: "4118501", state_code: "PR", registration_status: "ATIVA", company_size: "ME", visibility: { profileIds: [P1], workspaceIds: [] }, daysAgo: 400 }
];

describe("Meilisearch real", { skip }, () => {
  const client = createMeiliClient({ url, apiKey: key, timeoutMs: 10_000 });
  const scope = { profileId: P1, workspaceIds: [W1] };

  async function search(q: string, filters: Parameters<typeof index.searchCompanyIndex>[2]["filters"] = {}, facets = false) {
    const plan = planCompanyQuery(q, filters);
    return index.searchCompanyIndex(client, UID, { q: plan.q, scope, filters: plan.filters, facets, nowEpoch: NOW });
  }

  before(async () => {
    await index.ensureCompanyIndex(client, UID);
    const documents = rows
      .map(({ visibility, daysAgo, ...row }) =>
        toCompanySearchDocument(
          { ...row, provider_payload: { casadosdados_detalhe_em: new Date((NOW - daysAgo * 86_400) * 1000).toISOString() } },
          visibility,
          { nowEpoch: NOW, ttlDays: 90 }
        )
      )
      .filter((document): document is NonNullable<typeof document> => Boolean(document));
    await client.waitForTask((await index.replaceCompanyDocuments(client, UID, documents))!);
  });

  after(async () => {
    await index.deleteIndex(client, UID).then((task) => client.waitForTask(task)).catch(() => null);
  });

  test("typo: 'transportadoras pato brnaco'", async () => {
    const response = await search("transportadoras pato brnaco");
    assert.equal(response.hits[0]?.cnpj, "11222333000181");
  });

  test("typo em razão social e nome fantasia", async () => {
    // matchingStrategy "last": quem tem todos os termos vem primeiro; depois, resultados parciais.
    const zanella = await search("transportadora zanela");
    assert.deepEqual(zanella.hits.slice(0, 2).map((hit) => hit.cnpj).sort(), ["11222333000181", "11222333000262"]);
    assert.equal((await search("zanella crgas")).hits[0]?.cnpj, "11222333000181");
  });

  test("acentos nos dois sentidos", async () => {
    assert.equal((await search("padaria conceição")).hits[0]?.cnpj, "44555666000102");
    assert.equal((await search("logistica araujo goncalves")).hits[0]?.cnpj, "55666777000144");
    assert.equal((await search("pao da conceicao")).hits[0]?.cnpj, "44555666000102");
  });

  test("CNPJ com máscara, sem máscara, raiz e prefixo (sem aproximação)", async () => {
    assert.deepEqual((await search("11.222.333/0001-81")).hits.map((hit) => hit.cnpj), ["11222333000181"]);
    assert.deepEqual((await search("11222333000181")).hits.map((hit) => hit.cnpj), ["11222333000181"]);
    assert.equal((await search("11.222.333")).hits.length, 2);
    assert.equal((await search("112223")).hits.length, 2);
    assert.equal((await search("11222333000182")).hits.length, 0, "dígito diferente não casa por aproximação");
  });

  test("CNAE digitado, cidade e UF", async () => {
    const byCnae = await search("4930-2/02");
    assert.ok(byCnae.hits.length >= 2);
    assert.ok(byCnae.hits.every((hit) => hit.primaryCnae === "4930202"));
    const byCity = await search("cascavel");
    assert.deepEqual(byCity.hits.map((hit) => hit.cnpj), ["11222333000262"]);
    const byUf = await search("padaria", { stateCodes: ["PR"] });
    assert.equal(byUf.hits.length, 0);
    assert.equal((await search("padaria sp")).hits[0]?.cnpj, "44555666000102");
  });

  test("filtros e facetas", async () => {
    const response = await search("", { stateCodes: ["PR"] }, true);
    assert.deepEqual(response.facets.stateCode, { PR: 3 });
    assert.equal(response.facets.city?.["Pato Branco"], 1);
    assert.equal(response.facets.registrationStatus?.BAIXADA, 1);
    const onlyActive = await search("", { stateCodes: ["PR"], registrationStatuses: ["ATIVA"], headquarters: "filial" });
    assert.deepEqual(onlyActive.hits.map((hit) => hit.cnpj), ["11222333000262"]);
  });

  test("isolamento: empresa de outro usuário nunca aparece", async () => {
    const response = await search("transportes segredo");
    assert.equal(response.hits.some((hit) => hit.cnpj === "66777888000106"), false);
  });

  test("CRM: visível pelo workspace", async () => {
    const response = await index.searchCompanyIndex(client, UID, { q: "araujo", scope: { profileId: P2, workspaceIds: [W1] }, nowEpoch: NOW });
    assert.equal(response.hits[0]?.cnpj, "55666777000144");
  });

  test("dado desatualizado (além da validade) não é servido e é expurgado", async () => {
    const stale = await search("transportes antigos");
    assert.equal(stale.hits.some((hit) => hit.cnpj === "99888777000155"), false);
    await client.waitForTask(await index.deleteExpiredCompanyDocuments(client, UID, NOW));
    const stats = await index.getCompanyIndexStats(client, UID);
    assert.equal(stats.numberOfDocuments, rows.length - 1);
  });

  test("sincronização: substituição e exclusão refletem na busca", async () => {
    const updated = toCompanySearchDocument(
      { cnpj: "44555666000102", company_name: "PANIFICADORA NOVA ESPERANCA LTDA", city_name: "São Paulo", state_code: "SP", provider_payload: { casadosdados_detalhe_em: new Date(NOW * 1000).toISOString() } },
      { profileIds: [P1], workspaceIds: [] },
      { nowEpoch: NOW, ttlDays: 90 }
    )!;
    await client.waitForTask((await index.replaceCompanyDocuments(client, UID, [updated]))!);
    const oldName = await search("padaria conceicao");
    // "padaria" ↔ "panificadora" é sinônimo: o documento aparece, mas já com o nome novo.
    assert.equal(oldName.hits.some((hit) => /CONCEICAO/i.test(hit.legalName) || /Conceição/.test(hit.tradeName ?? "")), false);
    assert.equal((await search("panificadora esperança")).hits[0]?.cnpj, "44555666000102");
    await client.waitForTask((await index.deleteCompanyDocuments(client, UID, ["44555666000102"]))!);
    assert.equal((await search("panificadora")).hits.length, 0);
  });

  test("resposta nunca expõe permissões internas", async () => {
    const response = await client.request<{ hits: Array<Record<string, unknown>> }>(`/indexes/${UID}/search`, {
      method: "POST",
      body: { q: "zanella", filter: index.buildCompanyFilter(scope, {}, NOW) }
    });
    assert.ok(response.hits.length > 0);
    for (const hit of response.hits) {
      assert.equal("profileIds" in hit, false);
      assert.equal("workspaceIds" in hit, false);
      assert.equal("expiresAt" in hit, false);
    }
  });
});

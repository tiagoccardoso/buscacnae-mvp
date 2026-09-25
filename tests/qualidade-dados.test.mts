import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Qualidade de dados (lib/data-quality) — regras centralizadas inspiradas no OpenRefine:
 * limpeza de texto, tipos brasileiros (CNPJ, telefone, CEP, UF, município, CNAE)
 * e detecção de duplicidade por colisão de chave (fingerprint / n-gram).
 */
const fetchCalls: string[] = [];
(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  fetchCalls.push(String(url));
  return new Response("{}", { status: 500 });
};

const dq = await import("../lib/data-quality/index.ts");

test("texto: controles, zero-width, NBSP, espaços repetidos e sentinelas viram null/limpos", () => {
  assert.equal(dq.cleanString("  PADARIA   DO\tJOÃO​ "), "PADARIA DO JOÃO");
  assert.equal(dq.cleanString("A\u0000B\u0007C"), "ABC");
  for (const empty of ["", "   ", "-", "--", "N/A", "null", "NÃO INFORMADO", "nao informado", "********", ".", undefined, null, {}]) {
    assert.equal(dq.cleanString(empty), null, `sentinela ${JSON.stringify(empty)}`);
  }
  assert.equal(dq.cleanString(42), "42");
  assert.equal(dq.cleanString("Café"), "Café", "NFC");
});

test("CNPJ: máscara, zeros perdidos, alfanumérico e dígito verificador", () => {
  assert.equal(dq.normalizeCnpjValue("11.222.333/0001-81"), "11222333000181");
  assert.equal(dq.normalizeCnpjValue(1222333000181), "01222333000181");
  assert.equal(dq.normalizeCnpjValue("12.aBc.345/01De-35"), "12ABC34501DE35");
  assert.equal(dq.normalizeCnpjValue("123"), null);
  assert.equal(dq.isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(dq.isValidCnpj("11222333000182"), false);
  assert.equal(dq.isValidCnpj("00000000000000"), false);
  // Exemplo oficial da Receita Federal para o CNPJ alfanumérico.
  assert.equal(dq.isValidCnpj("12.ABC.345/01DE-35"), true);
});

test("telefone: +55, zero de longa distância, operadora, DDD inválido e repetidos", () => {
  assert.deepEqual(dq.normalizePhone("+55 (11) 98765-4321"), { digits: "11987654321", ddd: "11", isMobile: true, formatted: "(11) 98765-4321" });
  assert.equal(dq.normalizePhone("011 3333-4444")?.formatted, "(11) 3333-4444");
  assert.equal(dq.normalizePhone("0 21 11 987654321")?.formatted, "(11) 98765-4321");
  assert.equal(dq.normalizePhone("(11) 3333-4444")?.isMobile, false);
  assert.equal(dq.normalizePhone("0800 123 4567")?.formatted, "0800 123 4567");
  assert.equal(dq.normalizePhone("3333-4444"), null, "sem DDD não é discável");
  assert.equal(dq.normalizePhone("(20) 98765-4321"), null, "DDD 20 não existe");
  assert.equal(dq.normalizePhone("(11) 00000-0000"), null);
  assert.equal(dq.normalizePhone("(11) 88765-4321"), null, "9 dígitos precisa começar com 9");
});

test("CEP, UF, município, IBGE e número do endereço", () => {
  assert.equal(dq.normalizeCep("01001-000"), "01001000");
  assert.equal(dq.normalizeCep(1001000), "01001000");
  assert.equal(dq.normalizeCep("00000-000"), null);
  assert.equal(dq.normalizeCep("123"), null);
  assert.equal(dq.formatCep("01001000"), "01001-000");
  assert.equal(dq.normalizeUf(" sp "), "SP");
  assert.equal(dq.normalizeUf("São Paulo"), "SP");
  assert.equal(dq.normalizeUf("XX"), null);
  assert.equal(dq.normalizeMunicipalityName("RIO DE JANEIRO"), "Rio de Janeiro");
  assert.equal(dq.normalizeMunicipalityName("SANTA BARBARA D'OESTE"), "Santa Barbara d'Oeste");
  assert.equal(dq.normalizeMunicipalityName("EMBU-GUACU"), "Embu-Guacu");
  assert.equal(dq.normalizeMunicipalityName("SAO PAULO/SP"), "Sao Paulo");
  assert.equal(dq.normalizeIbgeCode("3550308"), "3550308");
  assert.equal(dq.normalizeIbgeCode("35"), null);
  assert.equal(dq.normalizeAddressNumber("s/n"), "S/N");
  assert.equal(dq.normalizeAddressNumber("0"), "S/N");
  assert.equal(dq.normalizeAddressNumber("100 A"), "100 A");
});

test("empresa: razão social, CNAE, e-mail, site e data", () => {
  assert.equal(dq.normalizeCompanyName('  "PADARIA  SAO JOAO LTDA" '), "PADARIA SAO JOAO LTDA");
  assert.equal(dq.normalizeCnae("4781-4/00"), "4781400");
  assert.equal(dq.normalizeCnae(111301), "0111301");
  assert.equal(dq.normalizeCnae("123"), null);
  assert.equal(dq.formatCnae("4781400"), "4781-4/00");
  assert.equal(dq.normalizeEmail(" Contato@Empresa.COM.br ; outro@x.com"), "contato@empresa.com.br");
  assert.equal(dq.normalizeEmail("mailto:vendas@x.com.br"), "vendas@x.com.br");
  assert.equal(dq.normalizeEmail("sem email"), null);
  assert.equal(dq.normalizeWebsite("WWW.Empresa.COM.BR/Contato"), "www.empresa.com.br/Contato");
  assert.equal(dq.normalizeWebsite("contato@empresa.com"), null);
  assert.equal(dq.normalizeIsoDate("10/03/2015"), "2015-03-10");
  assert.equal(dq.normalizeIsoDate("2015-03-10T00:00:00Z"), "2015-03-10");
  assert.equal(dq.normalizeIsoDate("31/02/2015"), null);
});

test("higienização da linha é idempotente e não inventa campos", () => {
  const raw = {
    cnpj: "11.222.333/0001-81",
    companyName: " PADARIA ",
    tradeName: "N/A",
    phone: "11987654321",
    email: "X@Y.COM",
    stateCode: "sp",
    cityName: "SAO PAULO",
    cep: "01001-000",
    primaryCnaeCode: "1091-1/02",
    capitalSocial: -5,
    openedAt: "data inválida"
  };
  const once = dq.cleanNormalizedEstablishment(raw);
  const twice = dq.cleanNormalizedEstablishment(once);
  assert.deepEqual(twice, once);
  assert.equal(once.cnpjRoot, "11222333");
  assert.equal(once.tradeName, null);
  assert.equal(once.capitalSocial, null);
  assert.equal(once.openedAt, null);
  assert.equal(once.website, null);
  assert.equal(once.cityName, "Sao Paulo");
  const report = dq.assessEstablishmentQuality(once);
  assert.deepEqual(report.issues, ["missing_address"]);
  assert.ok(report.completeness > 0 && report.completeness < 1);
  assert.ok(dq.assessEstablishmentQuality({ cnpj: "11222333000182", companyName: "X" }).issues.includes("cnpj_check_digits"));
});

test("duplicidade: fingerprint e n-gram agrupam grafias diferentes (colisão de chave)", () => {
  assert.equal(dq.fingerprint("Padaria  São-João Ltda."), dq.fingerprint("LTDA PADARIA SAO JOAO"));
  assert.equal(dq.ngramFingerprint("PadariaSaoJoao"), dq.ngramFingerprint("Padaria Sao Joao"));
  assert.equal(dq.companyNameKey("PADARIA SAO JOAO LTDA - ME"), dq.companyNameKey("Padaria São João"));
  assert.equal(dq.companyNameKey("PETROLEO BRASILEIRO S/A"), dq.companyNameKey("Petróleo Brasileiro SA"));
  const rows = [
    { id: 1, name: "Padaria São João LTDA" },
    { id: 2, name: "PADARIA SAO JOAO" },
    { id: 3, name: "Mercado Central" },
    { id: 4, name: "padaria são joão - ME" }
  ];
  const clusters = dq.findDuplicateClusters(rows, (row) => dq.companyNameKey(row.name));
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].items.map((row) => row.id), [1, 2, 4]);
});

test("duplicidade por CNPJ: mantém a ordem e completa campos vazios sem sobrescrever", () => {
  const rows = [
    { cnpj: "11222333000181", companyName: "A", email: null, phone: "(11) 3333-4444" },
    { cnpj: "99888777000166", companyName: "B" },
    { cnpj: "11.222.333/0001-81", companyName: "A LTDA", email: "a@a.com", phone: "(11) 98765-4321" }
  ];
  const deduped = dq.dedupeByKey(rows, (row) => dq.normalizeCnpjValue(row.cnpj), dq.mergeDuplicateEstablishments);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].email, "a@a.com");
  assert.equal(deduped[1].companyName, "B");
});

test("regras são puras: nenhuma requisição externa", () => {
  dq.cleanNormalizedEstablishment({ cnpj: "11222333000181", companyName: "X", cep: "01001000" });
  assert.equal(fetchCalls.length, 0);
});

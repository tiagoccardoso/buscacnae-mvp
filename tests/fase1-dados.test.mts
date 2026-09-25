import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Fase 1 — fundação de dados: modelo Company, tabela de resultados, persistência em lote,
 * reuso de detalhe, diretório de CEP (complemento) e ausência total de CNPJ.ws.
 */
delete process.env.DATABASE_URL;
process.env.CASA_DOS_DADOS_API_KEY = "test-key-secret";
delete process.env.LOCATION_POSTAL_DIRECTORY;

const fetchCalls: string[] = [];
(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  fetchCalls.push(String(url));
  return new Response("{}", { status: 500 });
};

// lib/db não pode mais quebrar na importação sem DATABASE_URL (quebrava `next build`).
const dbModule = await import("../lib/db.ts");
process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";

const { normalizeCasaDosDadosEstablishment } = await import("../lib/discovery/providers/casadosdados.ts");
const companyModel = await import("../lib/company-model.ts");
const tableModel = await import("../lib/results/company-table-model.ts");
const persistence = await import("../lib/discovery/persistence.ts");
const detailStore = await import("../lib/discovery/detail-store.ts");
const postal = await import("../lib/geo/postal-code-directory.ts");
const { buildCompanyCrmSheet } = await import("../lib/export/company-sheet.ts");
const { formatDate } = await import("../lib/format.ts");

type ListItem = import("../lib/company-model.ts").CompanyListItem;

const searchRecord = {
  cnpj: "12345678000190",
  cnpj_raiz: "12345678",
  razao_social: "PADARIA SÃO JOÃO LTDA",
  nome_fantasia: "PADARIA DO JOÃO",
  matriz_filial: "MATRIZ",
  codigo_natureza_juridica: "2062",
  descricao_natureza_juridica: "Sociedade Empresária Limitada",
  situacao_cadastral: { situacao_cadastral: "ATIVA" },
  porte_empresa: { codigo: "01", descricao: "Microempresa" },
  data_abertura: "2015-03-10",
  capital_social: 50000,
  endereco: {
    cep: "01001000",
    tipo_logradouro: "PRACA",
    logradouro: "DA SE",
    numero: "100",
    bairro: "SE",
    uf: "SP",
    municipio: "SAO PAULO",
    ibge: { codigo_municipio: "3550308", latitude: -23.55, longitude: -46.63 }
  }
};

const detailRecord = {
  cnpj: "12345678000190",
  atividade_principal: { codigo: "1091102", descricao: "Padaria e confeitaria" },
  atividade_secundaria: [
    { codigo: "4721102", descricao: "Padaria e confeitaria com predominância de revenda" },
    { codigo: "5611203", descricao: "Lanchonetes" }
  ],
  contato_telefonico: [{ completo: "11987654321" }],
  contato_email: [{ email: "contato@padaria.com.br" }],
  simples: { optante: true },
  mei: { optante: false }
};

function buildCompany(extra: Record<string, unknown> = {}) {
  const normalized = normalizeCasaDosDadosEstablishment({ ...searchRecord, ...extra });
  assert.ok(normalized);
  return companyModel.companyFromNormalized({
    ...normalized,
    providerPayload: { casadosdados_pesquisa: { ...searchRecord, ...extra }, casadosdados_detalhe: detailRecord }
  });
}

test("lib/db é criado sob demanda: importar sem DATABASE_URL não lança", () => {
  assert.equal(typeof dbModule.sql, "function");
  assert.equal(typeof dbModule.sql.query, "function");
});

test("Company: adapter Casa dos Dados → modelo normalizado", () => {
  const company = buildCompany();
  assert.equal(company.source, "casadosdados");
  assert.equal(company.cnpj, "12345678000190");
  assert.equal(company.cnpjRoot, "12345678");
  assert.equal(company.legalName, "PADARIA SÃO JOÃO LTDA");
  assert.equal(company.displayName, "PADARIA DO JOÃO");
  assert.equal(company.status, "ATIVA");
  assert.equal(company.headquartersOrBranch, "matriz");
  assert.equal(company.legalNature.description, "Sociedade Empresária Limitada");
  assert.equal(company.shareCapital, 50000);
  assert.equal(company.address.state, "SP");
  assert.equal(company.address.postalCode, "01001000");
  assert.equal(company.address.cityIbge, "3550308");
  assert.ok(company.address.summary?.includes("CEP"));
  assert.deepEqual(company.location, { latitude: -23.55, longitude: -46.63, precision: "city" });
});

test("Company: campos ausentes continuam null (nada é inventado)", () => {
  const normalized = normalizeCasaDosDadosEstablishment({ cnpj: "11222333000181", razao_social: "X LTDA" });
  assert.ok(normalized);
  const company = companyModel.companyFromNormalized(normalized);
  assert.equal(company.contacts.email, null);
  assert.equal(company.contacts.phone, null);
  assert.equal(company.shareCapital, null);
  assert.equal(company.location, null);
  assert.deepEqual(company.secondaryCnaes, []);
});

test("Company: matriz/filial pela fonte e, na ausência, pela ordem do CNPJ", () => {
  assert.equal(companyModel.resolveHeadquartersOrBranch("12345678000271", { casadosdados_pesquisa: { matriz_filial: "FILIAL" } }), "filial");
  assert.equal(companyModel.resolveHeadquartersOrBranch("12345678000190", null), "matriz");
  assert.equal(companyModel.resolveHeadquartersOrBranch("12345678000271", null), "filial");
  assert.equal(companyModel.resolveHeadquartersOrBranch("12ABC34501DE35", { identificador_matriz_filial: 1 }), "matriz");
  assert.equal(companyModel.resolveHeadquartersOrBranch("123", null), null);
});

test("Company: CNAEs secundários de objetos ou texto, sem duplicatas", () => {
  assert.deepEqual(companyModel.parseSecondaryCnaes([
    { codigo: "47.21-1/02", descricao: "Padaria" },
    { codigo: "4721102", descricao: "Padaria" },
    "5611-2/03 - Lanchonetes"
  ]), [
    { code: "4721102", description: "Padaria" },
    { code: "5611203", description: "Lanchonetes" }
  ]);
});

test("CompanySummary (mapa) continua com o mesmo formato", () => {
  const summary = companyModel.toCompanySummary(buildCompany());
  assert.deepEqual(Object.keys(summary).sort(), [
    "capitalSocial", "cityIbge", "cityName", "cnpj", "companySize", "displayName", "email", "id", "legalName",
    "openedAt", "payload", "phone", "postalCode", "primaryCnaeCode", "primaryCnaeDescription", "stateCode", "status", "tradeName"
  ]);
});

test("CompanyListItem não leva payload bruto ao navegador", () => {
  const item = companyModel.toCompanyListItem(buildCompany(), { position: 3, saved: true });
  const serialized = JSON.stringify(item);
  assert.equal(item.position, 3);
  assert.equal(item.saved, true);
  assert.equal(serialized.includes("casadosdados"), false);
  assert.equal(serialized.includes("provider_payload"), false);
  assert.ok(serialized.length < 2000, `item enxuto (${serialized.length} bytes)`);
});

function makeItem(index: number, extra: Partial<ListItem> = {}): ListItem {
  return {
    id: `id-${index}`,
    position: index + 1,
    cnpj: String(10000000000100 + index).padStart(14, "0"),
    legalName: `EMPRESA ${index} LTDA`,
    tradeName: index % 2 ? `Fantasia ${index}` : null,
    status: index % 5 === 0 ? "BAIXADA" : "ATIVA",
    openedAt: `20${String(10 + (index % 15)).padStart(2, "0")}-01-01`,
    headquartersOrBranch: index % 3 === 0 ? "filial" : "matriz",
    size: null,
    shareCapital: index % 4 === 0 ? null : index * 1000,
    simplesOptIn: null,
    meiOptIn: null,
    legalNature: null,
    primaryCnae: "4781400",
    primaryCnaeDescription: "Comércio varejista de artigos do vestuário",
    secondaryCnaes: [],
    city: index % 2 ? "São Paulo" : "Campinas",
    state: index % 7 === 0 ? "RJ" : "SP",
    neighborhood: "Centro",
    postalCode: "01001000",
    addressSummary: null,
    email: index % 3 === 0 ? `c${index}@x.com` : null,
    phone: index % 2 ? "(11) 98765-4321" : index % 4 === 0 ? "(11) 3333-4444" : null,
    phoneIsMobile: index % 2 === 1,
    website: null,
    saved: false,
    ...extra
  };
}

test("tabela: busca sem acento/caixa, por CNPJ com máscara e por múltiplos termos", () => {
  const items = [makeItem(1), makeItem(2), makeItem(3, { legalName: "CONFECÇÕES ÁGUA LTDA" })];
  const f = tableModel.DEFAULT_COMPANY_TABLE_FILTERS;
  assert.deepEqual(tableModel.filterCompanyListItems(items, { ...f, query: "confeccoes agua" }).map((i) => i.id), ["id-3"]);
  assert.deepEqual(tableModel.filterCompanyListItems(items, { ...f, query: tableModel.formatCnpjDigits(items[1].cnpj) }).map((i) => i.id), ["id-2"]);
  assert.equal(tableModel.filterCompanyListItems(items, { ...f, query: "campinas" }).length, 1);
});

test("tabela: filtros de situação, contato, UF e matriz/filial", () => {
  const items = Array.from({ length: 30 }, (_, i) => makeItem(i));
  const f = tableModel.DEFAULT_COMPANY_TABLE_FILTERS;
  assert.ok(tableModel.filterCompanyListItems(items, { ...f, status: "active" }).every((i) => i.status === "ATIVA"));
  assert.ok(tableModel.filterCompanyListItems(items, { ...f, status: "inactive" }).every((i) => i.status !== "ATIVA"));
  assert.ok(tableModel.filterCompanyListItems(items, { ...f, contact: "mobile" }).every((i) => i.phone && i.phoneIsMobile));
  assert.ok(tableModel.filterCompanyListItems(items, { ...f, contact: "email" }).every((i) => i.email));
  assert.ok(tableModel.filterCompanyListItems(items, { ...f, state: "RJ" }).every((i) => i.state === "RJ"));
  assert.ok(tableModel.filterCompanyListItems(items, { ...f, branch: "filial" }).every((i) => i.headquartersOrBranch === "filial"));
  assert.equal(tableModel.hasActiveFilters(f), false);
  assert.equal(tableModel.hasActiveFilters({ ...f, query: "  " }), false);
  assert.deepEqual(tableModel.listStates(items), ["RJ", "SP"]);
});

test("tabela: ordenação mantém valores ausentes no fim", () => {
  const values = [3, null, 1, undefined, 2];
  assert.deepEqual([...values].sort(tableModel.compareNullable), [1, 2, 3, null, undefined]);
  assert.ok(tableModel.compareNullable("Água", "abacaxi") > 0);
});

test("tabela: grandes resultados (20.000 linhas) filtram rápido", () => {
  const items = Array.from({ length: 20_000 }, (_, i) => makeItem(i));
  const started = performance.now();
  const result = tableModel.filterCompanyListItems(items, { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, query: "fantasia 1", contact: "phone" });
  const elapsed = performance.now() - started;
  assert.ok(result.length > 0);
  assert.ok(elapsed < 1500, `filtro levou ${elapsed.toFixed(0)}ms`);
  assert.ok(tableModel.VIRTUALIZATION_THRESHOLD <= 100);
});

test("CSV da seleção: BOM, separador ; e neutralização de fórmulas", () => {
  const csv = tableModel.buildCompanyCsv([makeItem(1, { legalName: "=HYPERLINK(\"x\")", tradeName: "A;B" })]);
  assert.ok(csv.startsWith("﻿"));
  const [, line] = csv.slice(1).split("\r\n");
  assert.ok(line.includes("\"'=HYPERLINK(\"\"x\"\")\""), line);
  assert.ok(line.includes("\"A;B\""));
});

test("exportação XLSX (Leads CRM) usa o modelo Company com colunas alinhadas", () => {
  const sheet = buildCompanyCrmSheet([{ position: 1, company: buildCompany() }]);
  assert.equal(sheet.rows[0].length, sheet.columnWidths.length);
  assert.equal(sheet.rows[1].length, sheet.rows[0].length);
  const row = Object.fromEntries(sheet.rows[0].map((header, index) => [header, sheet.rows[1][index]]));
  assert.equal(row["CNPJ"], "12.345.678/0001-90");
  assert.equal(row["Matriz/Filial"], "Matriz");
  assert.equal(row["Data de Abertura"], "10/03/2015");
  assert.ok(sheet.wrapColumns.every((index) => index < sheet.columnWidths.length));
});

test("formatDate não desloca datas sem horário para o dia anterior", () => {
  assert.equal(formatDate("2015-03-10"), "10/03/2015");
});

function fakeDb() {
  const calls: Array<{ table: string; action: string; size: number; select?: string }> = [];
  return {
    calls,
    db: {
      from(table: string) {
        const state: { action: string; rows: Array<Record<string, unknown>> } = { action: "", rows: [] };
        const builder = {
          upsert(rows: Array<Record<string, unknown>>) { state.action = "upsert"; state.rows = rows; return builder; },
          insert(rows: Array<Record<string, unknown>>) { state.action = "insert"; state.rows = rows; return builder; },
          select(columns: string) {
            calls.push({ table, action: state.action, size: state.rows.length, select: columns });
            const data = state.rows.map((row, index) => ({ id: `uuid-${String(row.cnpj ?? index)}`, cnpj: row.cnpj }));
            return Promise.resolve({ data, error: null });
          }
        };
        return builder;
      }
    }
  };
}

test("persistência: upsert/insert em lotes com RETURNING enxuto (sem estourar parâmetros)", async () => {
  const rows = Array.from({ length: 1234 }, (_, i) => ({ cnpj: String(20000000000000 + i), companyName: `E${i}`, providerPayload: { a: i } }));
  const { db, calls } = fakeDb();
  const ids = await persistence.upsertEstablishments(db as never, rows as never);
  assert.equal(ids.size, 1234);
  assert.deepEqual(calls.map((c) => c.size), [500, 500, 234]);
  assert.ok(calls.every((c) => c.select === "id, cnpj"));
  // 29 colunas x 500 linhas = 14.500 parâmetros por comando (limite do PostgreSQL: 65.535).
  assert.ok(Object.keys(persistence.toEstablishmentRecord(rows[0] as never)).length * persistence.PERSISTENCE_CHUNK_SIZE < 65535);

  calls.length = 0;
  const inserted = await persistence.insertSearchResults(db as never, { searchQueryId: "s", profileId: "p", rows: rows as never, establishmentIds: ids });
  assert.equal(inserted, 1234);
  assert.deepEqual(calls.map((c) => c.size), [500, 500, 234]);
});

test("reuso de detalhe: somente registros dentro da janela e com detalhe válido", () => {
  const min = new Date(Date.now() - 3600_000).toISOString();
  const fresh = new Date().toISOString();
  const old = new Date(Date.now() - 7200_000).toISOString();
  const parsed = detailStore.parseStoredDetailRows([
    { cnpj: "11.222.333/0001-81", detail: { cnpj: "11222333000181" }, fetched_at: fresh },
    { cnpj: "22333444000181", detail: JSON.stringify({ cnpj: "x" }), fetched_at: fresh },
    { cnpj: "33444555000181", detail: { cnpj: "x" }, fetched_at: old },
    { cnpj: "44555666000181", detail: {}, fetched_at: fresh },
    { cnpj: "55666777000181", detail: { cnpj: "x" }, fetched_at: "invalido" }
  ], min);
  assert.deepEqual([...parsed.keys()], ["11222333000181", "22333444000181"]);
});

test("reuso de detalhe: uma query por lote de CNPJs; desligado com 0 horas", async () => {
  assert.equal(detailStore.createStoredDetailLookup({ reuseHours: 0 }), undefined);
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const lookup = detailStore.createStoredDetailLookup({
    reuseHours: 24,
    query: async (text, params) => {
      queries.push({ text, params });
      return [];
    }
  });
  assert.ok(lookup);
  await lookup!(Array.from({ length: 1500 }, (_, i) => String(30000000000000 + i)));
  assert.equal(queries.length, 2);
  assert.equal((queries[0].params[0] as string[]).length, 1000);
  assert.ok(/casadosdados_detalhe_em/.test(queries[0].text));
});

test("OpenCEP: parse do formato e complemento sem sobrescrever a Casa dos Dados", () => {
  const directory = postal.parsePostalCodeAddress(
    { cep: "01001-000", logradouro: "Praça da Sé", bairro: "Sé", localidade: "São Paulo", uf: "SP", ibge: "3550308" },
    "opencep"
  );
  assert.ok(directory);
  assert.equal(directory!.cep, "01001000");

  const base = { street: "PRACA DA SE", neighborhood: null, city: "Sao Paulo", state: "SP", cityIbge: null, postalCode: "01001000" };
  const result = postal.complementAddressWithPostalDirectory(base, directory);
  assert.deepEqual(result.filled.sort(), ["cityIbge", "neighborhood"]);
  assert.equal(result.address.street, "PRACA DA SE", "valor da Casa dos Dados preservado");
  assert.equal(base.neighborhood, null, "não muta o original");

  const conflict = postal.complementAddressWithPostalDirectory({ ...base, city: "Campinas" }, directory);
  assert.deepEqual(conflict.conflicts, ["city"]);
  assert.deepEqual(conflict.filled, []);

  const otherCep = postal.complementAddressWithPostalDirectory({ ...base, postalCode: "20000000" }, directory);
  assert.deepEqual(otherCep.filled, []);
});

test("OpenCEP: desligado por padrão e, quando ligado, limitado por CEP único", async () => {
  postal.__resetPostalDirectoryCache();
  const before = fetchCalls.length;
  const disabled = await postal.resolvePostalAddresses(["01001000", "01001-000"]);
  assert.equal(disabled.enabled, false);
  assert.equal(fetchCalls.length, before, "nenhuma requisição com o diretório desligado");

  const looked: string[] = [];
  const directory = {
    id: "fake",
    async lookup(cep: string) {
      looked.push(cep);
      return { cep, street: null, neighborhood: null, city: "X", state: "SP", cityIbge: "3550308", source: "fake" };
    }
  };
  const ceps = Array.from({ length: 50 }, (_, i) => String(10000000 + i));
  const result = await postal.resolvePostalAddresses([...ceps, ...ceps], { directory, maxLookups: 10 });
  assert.equal(looked.length, 10);
  assert.equal(result.pending, 40);
  await postal.resolvePostalAddresses(ceps.slice(0, 10), { directory, maxLookups: 10 });
  assert.equal(looked.length, 10, "cache em memória evita repetir CEP");
});

function listSourceFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "public"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|tsx|mts|js|mjs|json)$/.test(name)) out.push(full);
  }
  return out;
}

test("CNPJ.ws removido: nenhuma URL, cliente, dependência ou variável de ambiente", () => {
  const root = join(import.meta.dirname, "..");
  const allowed = new Set(["lib/provider-payload.ts", "lib/company-profile.ts"]); // higienização de payload legado
  const offenders: string[] = [];
  for (const file of listSourceFiles(root)) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel.startsWith("tests/") || allowed.has(rel) || rel.startsWith("data/")) continue;
    if (/cnpj\.ws|cnpjws|CNPJWS/i.test(readFileSync(file, "utf8"))) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);

  for (const file of ["lib/provider-payload.ts", "lib/company-profile.ts"]) {
    const source = readFileSync(join(root, file), "utf8");
    assert.equal(/https?:\/\/[^\s"'`]*cnpj\.ws/i.test(source), false, `${file} não pode chamar a CNPJ.ws`);
    assert.equal(/fetch\(/.test(source), false, `${file} não faz requisições`);
  }
  for (const file of [".env.example", ".env.docker.example", "package.json"]) {
    assert.equal(/cnpj\.?ws/i.test(readFileSync(join(root, file), "utf8")), false, file);
  }
});

test("nenhuma requisição externa ao montar Company, lista, CSV ou planilha", () => {
  const before = fetchCalls.length;
  const company = buildCompany();
  companyModel.toCompanyListItem(company, { position: 1 });
  buildCompanyCrmSheet([{ position: 1, company }]);
  tableModel.buildCompanyCsv([companyModel.toCompanyListItem(company, { position: 1 })]);
  assert.equal(fetchCalls.length, before);
});

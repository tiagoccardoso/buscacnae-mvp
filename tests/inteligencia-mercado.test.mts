import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Fase 3 — Inteligência de Mercado.
 * Cálculos validados contra um dataset CONHECIDO (resultado calculado à mão), invariantes
 * matemáticas (soma dos segmentos = total), consistência Lista × Mapa × Inteligência,
 * drill-down (segmento → exatamente as empresas contadas), universo analisado e performance.
 * Sem rede, sem banco.
 */
process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";
process.env.CASA_DOS_DADOS_API_KEY = "test-key-secret";
(globalThis as { fetch: unknown }).fetch = async () => {
  throw new Error("rede desabilitada nos testes");
};

const dims = await import("../lib/analytics/dimensions.ts");
const metrics = await import("../lib/analytics/metrics.ts");
const universeLib = await import("../lib/analytics/universe.ts");
const { toAnalyticsRecords } = await import("../lib/analytics/records.ts");
const chartOptions = await import("../lib/analytics/chart-options.ts");
const tableModel = await import("../lib/results/company-table-model.ts");
const filterParams = await import("../lib/results/filter-params.ts");
const { filterMapCompanies } = await import("../lib/map/filters.ts");
const { buildMapCompanies } = await import("../lib/map/service.ts");
const { buildSyntheticSummaries, buildSyntheticMapData } = await import("../lib/map/dev-fixtures.ts");
const regionStats = await import("../lib/map/intelligence/region-stats.ts");

type AnalyticsRecord = import("../lib/analytics/metrics.ts").AnalyticsRecord;
type CompanySummary = import("../lib/company-model.ts").CompanySummary;
type CompanyTableFilters = import("../lib/results/company-table-model.ts").CompanyTableFilters;

const REF = "2026-09-25";
const ALL = tableModel.DEFAULT_COMPANY_TABLE_FILTERS;

function record(overrides: Partial<AnalyticsRecord> & { id: string }): AnalyticsRecord {
  return {
    cnpj: `000000000001${overrides.id.padStart(2, "0")}`,
    status: null,
    state: null,
    headquartersOrBranch: "matriz",
    hasPhone: false,
    hasMobilePhone: false,
    hasEmail: false,
    searchText: `EMPRESA ${overrides.id}`,
    municipalityKey: null,
    municipalityLabel: null,
    cnae: null,
    cnaeDescription: null,
    size: null,
    shareCapital: null,
    openedAt: null,
    ...overrides
  };
}

/** Dataset conhecido — números esperados calculados à mão (ver comentários). */
const KNOWN: AnalyticsRecord[] = [
  record({ id: "1", status: "ATIVA", state: "SP", municipalityKey: "3509502", municipalityLabel: "Campinas/SP", cnae: "4781400", cnaeDescription: "Vestuário", size: "ME", shareCapital: 0, openedAt: "2026-05-10", hasPhone: true }),
  record({ id: "2", status: "BAIXADA", state: "SP", municipalityKey: "3509502", municipalityLabel: "Campinas/SP", cnae: "4781400", cnaeDescription: "Vestuário", size: "EPP", shareCapital: 10_000, openedAt: "2019-02-01" }),
  record({ id: "3", status: null, state: "RJ", municipalityKey: "3304557", municipalityLabel: "Rio de Janeiro/RJ", cnae: "5611201", cnaeDescription: "Restaurantes", size: null, shareCapital: null, openedAt: null, hasEmail: true }),
  record({ id: "4", status: "Ativa", state: "SP", municipalityKey: "3550308", municipalityLabel: "São Paulo/SP", cnae: null, size: "ME", shareCapital: 10_000.01, openedAt: "2025-09-25", hasPhone: true, hasEmail: true }),
  record({ id: "5", status: "ATIVA", state: "SP", municipalityKey: "3509502", municipalityLabel: "Campinas/SP", cnae: "5611201", cnaeDescription: "Restaurantes", size: "DEMAIS", shareCapital: 2_500_000.5, openedAt: "2025-09-24" }),
  record({ id: "6", status: "INAPTA", state: null, municipalityKey: null, cnae: "4781400", cnaeDescription: "Vestuário", size: "ME", shareCapital: -10, openedAt: "2026-10-01" })
];

function simplify(distribution: { buckets: Array<{ key: string; label: string; count: number }> }) {
  return distribution.buckets.map((bucket) => [bucket.key, bucket.label, bucket.count]);
}

/* ------------------------------------------------------------ dimensões */

test("dimensões: faixas de capital nos limites exatos (min, max]", () => {
  const cases: Array<[number | null, string]> = [
    [null, "na"],
    [-1, "na"],
    [Number.NaN, "na"],
    [0, "zero"],
    [0.01, "ate-10k"],
    [10_000, "ate-10k"],
    [10_000.01, "10k-50k"],
    [50_000, "10k-50k"],
    [100_000, "50k-100k"],
    [500_000, "100k-500k"],
    [1_000_000, "500k-1m"],
    [10_000_000, "1m-10m"],
    [10_000_000.01, "acima-10m"]
  ];
  for (const [value, expected] of cases) assert.equal(dims.capitalBandKey(value), expected, String(value));
});

test("dimensões: chaves estáveis (situação, porte, CNAE, UF, município)", () => {
  assert.equal(dims.statusKey("ATIVA"), "ativa");
  assert.equal(dims.statusKey(" Baixada "), "baixada");
  assert.equal(dims.statusKey(null), "na");
  assert.equal(dims.sizeKey("Micro Empresa"), "micro-empresa");
  assert.equal(dims.sizeKey(""), "na");
  assert.equal(dims.cnaeKey("4781-4/00"), "4781400");
  assert.equal(dims.cnaeKey("478140"), "na");
  assert.equal(dims.stateKey("sp"), "SP");
  assert.equal(dims.stateKey("São Paulo"), "na");
  assert.equal(dims.municipalityDimensionKey("3509502"), "3509502");
  assert.equal(dims.municipalityDimensionKey("CAMPINAS"), "na");
});

test("datas: referência em São Paulo, janela de 12 meses inclusiva, fim de mês e datas futuras", () => {
  // 02:00 UTC de 26/09 ainda é 25/09 em São Paulo (UTC−3).
  assert.equal(dims.analysisReferenceDate(new Date("2026-09-26T02:00:00Z")), "2026-09-25");
  assert.equal(dims.analysisReferenceDate(new Date("2026-09-26T03:00:00Z")), "2026-09-26");
  assert.equal(dims.newCompanyWindowStart("2026-09-25"), "2025-09-25");
  assert.equal(dims.subtractMonthsIso("2028-02-29", 12), "2027-02-28");
  assert.equal(dims.subtractMonthsIso("2026-03-31", 1), "2026-02-28");
  assert.equal(dims.isNewCompany("2025-09-25", REF), true, "limite inferior incluído");
  assert.equal(dims.isNewCompany("2025-09-24", REF), false);
  assert.equal(dims.isNewCompany("2026-09-25", REF), true, "limite superior incluído");
  assert.equal(dims.isNewCompany("2026-09-26", REF), false, "data futura não é nova");
  assert.equal(dims.isNewCompany("2026-02-30", REF), false, "data inválida");
  assert.deepEqual(dims.monthsEndingAt("2026-01-15", 3), ["2025-11", "2025-12", "2026-01"]);
  assert.equal(dims.openedYearKey("10/05/2020"), "na", "somente ISO");
});

/* ------------------------------------------------------------ dataset conhecido */

test("métricas: dataset conhecido bate com o cálculo manual", () => {
  const report = metrics.buildIntelligenceReport(KNOWN, ALL, REF);
  const summary = report.summary;

  assert.equal(summary.total, 6);
  // Ativas: 1, 4 ("Ativa"), 5 = 3; situação conhecida em 5 (a 3 não tem) → 60%.
  assert.deepEqual(summary.active, { count: 3, known: 5, share: 0.6 });
  // Novas: 1 (2026-05-10) e 4 (2025-09-25, limite incluído) = 2 de 5 com data → 40%.
  assert.equal(summary.newCompanies.count, 2);
  assert.equal(summary.newCompanies.known, 5);
  assert.equal(summary.newCompanies.share, 0.4);
  assert.equal(summary.newCompanies.since, "2025-09-25");
  // Contato: 1 (tel), 3 (e-mail), 4 (ambos) = 3 de 6.
  assert.deepEqual(summary.withContact, { count: 3, known: 6, share: 0.5 });
  assert.deepEqual(summary.distinct, { states: 2, municipalities: 3, cnaes: 2, sizes: 3 });
  // Capital válido: 0; 10.000; 10.000,01; 2.500.000,50 (−10 e null = não informado).
  assert.equal(summary.capital.known, 4);
  assert.equal(summary.capital.notInformed, 2);
  assert.equal(summary.capital.sum, 2_520_000.51);
  assert.equal(summary.capital.mean, 630_000.13); // 252.000.051 centavos / 4 = 63.000.012,75 → 63.000.013
  assert.equal(summary.capital.median, 10_000.005); // (10.000 + 10.000,01) / 2
  assert.equal(summary.capital.min, 0);
  assert.equal(summary.capital.max, 2_500_000.5);

  assert.deepEqual(simplify(report.distributions.status), [
    ["ativa", "Ativa", 3],
    ["baixada", "Baixada", 1],
    ["inapta", "Inapta", 1],
    ["na", "Não informado", 1]
  ]);
  assert.deepEqual(simplify(report.distributions.state), [
    ["SP", "SP", 4],
    ["RJ", "RJ", 1],
    ["na", "Não informado", 1]
  ]);
  assert.equal(report.distributions.state.buckets.at(-1)!.filterable, false, "UF não informada não é filtrável");
  assert.deepEqual(simplify(report.distributions.municipality), [
    ["3509502", "Campinas/SP", 3],
    ["3304557", "Rio de Janeiro/RJ", 1],
    ["3550308", "São Paulo/SP", 1],
    ["na", "Município não identificado", 1]
  ]);
  assert.deepEqual(simplify(report.distributions.cnae), [
    ["4781400", "4781-4/00 · Vestuário", 3],
    ["5611201", "5611-2/01 · Restaurantes", 2],
    ["na", "CNAE não informado", 1]
  ]);
  assert.deepEqual(simplify(report.distributions.size), [
    ["me", "ME", 3],
    ["demais", "DEMAIS", 1],
    ["epp", "EPP", 1],
    ["na", "Porte não informado", 1]
  ]);
  assert.deepEqual(
    report.distributions.capital.buckets.map((bucket) => [bucket.key, bucket.count]),
    [
      ["zero", 1],
      ["ate-10k", 1],
      ["10k-50k", 1],
      ["50k-100k", 0],
      ["100k-500k", 0],
      ["500k-1m", 0],
      ["1m-10m", 1],
      ["acima-10m", 0],
      ["na", 2]
    ]
  );

  // Série anual contígua 2019 → 2026 com zeros, acumulado termina no total com data.
  assert.deepEqual(
    report.opening.byYear.map((point) => [point.key, point.count, point.cumulative]),
    [
      ["2019", 1, 1],
      ["2020", 0, 1],
      ["2021", 0, 1],
      ["2022", 0, 1],
      ["2023", 0, 1],
      ["2024", 0, 1],
      ["2025", 2, 3],
      ["2026", 2, 5]
    ]
  );
  assert.equal(report.opening.known, 5);
  assert.equal(report.opening.notInformed, 1);
  assert.equal(report.opening.afterReference, 1, "abertura em 2026-10-01 é posterior à referência");
  // 24 meses: 2024-10 … 2026-09. Setembro/2025: empresas 4 e 5; maio/2026: empresa 1.
  assert.equal(report.opening.byMonth.length, 24);
  assert.equal(report.opening.byMonth[0].key, "2024-10");
  assert.equal(report.opening.byMonth.at(-1)!.key, "2026-09");
  assert.equal(report.opening.byMonth.find((point) => point.key === "2025-09")!.count, 2);
  assert.equal(report.opening.byMonth.find((point) => point.key === "2026-05")!.count, 1);
  assert.equal(report.opening.byMonth.reduce((sum, point) => sum + point.count, 0), 3);
  assert.equal(report.opening.byMonth.at(-1)!.label, "set/26");
});

test("métricas: denominador zero vira null ('—'), nunca 0%", () => {
  const empty = metrics.summarizeRecords([], REF);
  assert.equal(empty.total, 0);
  assert.equal(empty.active.share, null);
  assert.equal(empty.newCompanies.share, null);
  assert.equal(empty.capital.mean, null);
  assert.equal(empty.capital.median, null);
  assert.equal(metrics.formatShare(null), "—");
  assert.equal(metrics.formatShare(0.6), "60,0%");
  const noStatus = metrics.summarizeRecords([record({ id: "1" })], REF);
  assert.equal(noStatus.active.known, 0);
  assert.equal(noStatus.active.share, null);
  assert.equal(metrics.median([3, 1, 2]), 2);
  assert.equal(metrics.median([4, 1, 3, 2]), 2.5);
});

test("filtros de drill-down no dataset conhecido (cross-filter exclui a própria dimensão)", () => {
  const byCity = metrics.buildIntelligenceReport(KNOWN, { ...ALL, municipality: "3509502" }, REF);
  assert.equal(byCity.summary.total, 3);
  assert.deepEqual(byCity.matchedIds, ["1", "2", "5"]);
  // O gráfico de municípios ignora o próprio filtro: continua mostrando as 6.
  assert.equal(byCity.distributions.municipality.total, 6);
  // Os outros gráficos respeitam o filtro de município.
  assert.deepEqual(simplify(byCity.distributions.status), [
    ["ativa", "Ativa", 2],
    ["baixada", "Baixada", 1]
  ]);

  const newOnes = metrics.buildIntelligenceReport(KNOWN, { ...ALL, opened: "12m" }, REF);
  assert.deepEqual(newOnes.matchedIds, ["1", "4"]);
  const year2025 = metrics.buildIntelligenceReport(KNOWN, { ...ALL, opened: "2025" }, REF);
  assert.deepEqual(year2025.matchedIds, ["4", "5"]);
  const month = metrics.buildIntelligenceReport(KNOWN, { ...ALL, opened: "2025-09" }, REF);
  assert.deepEqual(month.matchedIds, ["4", "5"]);
  const noDate = metrics.buildIntelligenceReport(KNOWN, { ...ALL, opened: "na" }, REF);
  assert.deepEqual(noDate.matchedIds, ["3"]);
  const baixada = metrics.buildIntelligenceReport(KNOWN, { ...ALL, status: "baixada" }, REF);
  assert.deepEqual(baixada.matchedIds, ["2"]);
  const exactActive = metrics.buildIntelligenceReport(KNOWN, { ...ALL, status: "ativa" }, REF);
  const active = metrics.buildIntelligenceReport(KNOWN, { ...ALL, status: "active" }, REF);
  assert.deepEqual(exactActive.matchedIds, active.matchedIds, "'ativa' (gráfico) = 'active' (seletor)");
  const capitalNa = metrics.buildIntelligenceReport(KNOWN, { ...ALL, capital: "na" }, REF);
  assert.deepEqual(capitalNa.matchedIds, ["3", "6"]);
  const combined = metrics.buildIntelligenceReport(KNOWN, { ...ALL, cnae: "4781400", size: "me" }, REF);
  assert.deepEqual(combined.matchedIds, ["1", "6"]);
});

/* ------------------------------------------------------------ invariantes (sintético) */

function syntheticRecords(count: number, seed: number) {
  const data = buildSyntheticMapData(count, seed);
  return { data, records: toAnalyticsRecords(data.companies, data.regions) };
}

test("invariante: soma dos segmentos de toda distribuição = total (sem e com filtros)", () => {
  const { records } = syntheticRecords(5_000, 21);
  const filterSets: CompanyTableFilters[] = [
    ALL,
    { ...ALL, status: "active" },
    { ...ALL, contact: "any", branch: "matriz" },
    { ...ALL, size: "me", opened: "12m" },
    { ...ALL, query: "restaurantes", capital: "10k-50k" }
  ];
  for (const filters of filterSets) {
    const report = metrics.buildIntelligenceReport(records, filters, REF);
    for (const [name, distribution] of Object.entries(report.distributions)) {
      assert.equal(metrics.bucketTotal(distribution), distribution.total, `${name} ${JSON.stringify(filters)}`);
    }
    assert.equal(report.opening.known + report.opening.notInformed, metrics.buildIntelligenceReport(records, { ...filters, opened: "all" }, REF).summary.total);
    // Sem filtro na própria dimensão, o total do gráfico = total filtrado (KPI).
    for (const key of ["status", "state", "municipality", "cnae", "size", "capital"] as const) {
      const facetFilter = key === "state" ? filters.state : filters[key];
      if (facetFilter === "all") assert.equal(report.distributions[key].total, report.summary.total, `${key} ${JSON.stringify(filters)}`);
    }
    // Ativas + não ativas conhecidas + desconhecidas = total.
    const unknownStatus = report.distributions.status.buckets.find((bucket) => bucket.key === "na")?.count ?? 0;
    if (filters.status === "all") assert.equal(report.summary.active.known + unknownStatus, report.summary.total);
  }
});

test("drill-down: cada segmento filtra EXATAMENTE as empresas que ele contou", () => {
  const { records } = syntheticRecords(2_000, 8);
  const report = metrics.buildIntelligenceReport(records, ALL, REF);
  const facets = ["status", "municipality", "cnae", "size", "capital"] as const;
  for (const facet of facets) {
    for (const bucket of report.distributions[facet].buckets) {
      if (!bucket.filterable || bucket.count === 0) continue;
      const drilled = metrics.buildIntelligenceReport(records, { ...ALL, [facet]: bucket.key }, REF);
      assert.equal(drilled.summary.total, bucket.count, `${facet}=${bucket.key}`);
    }
  }
  for (const bucket of report.distributions.state.buckets) {
    if (!bucket.filterable) continue;
    assert.equal(metrics.buildIntelligenceReport(records, { ...ALL, state: bucket.key }, REF).summary.total, bucket.count, `uf=${bucket.key}`);
  }
  for (const point of report.opening.byYear) {
    if (point.count === 0) continue;
    assert.equal(metrics.buildIntelligenceReport(records, { ...ALL, opened: point.key }, REF).summary.total, point.count, `ano ${point.key}`);
  }
  for (const point of report.opening.byMonth) {
    assert.equal(metrics.buildIntelligenceReport(records, { ...ALL, opened: point.key }, REF).summary.total, point.count, `mês ${point.key}`);
  }
  assert.equal(
    metrics.buildIntelligenceReport(records, { ...ALL, opened: "12m" }, REF).summary.total,
    report.summary.newCompanies.count,
    "KPI 'novas' = filtro 12m"
  );
});

test("cross-filter: o gráfico da dimensão filtrada ignora só o próprio filtro", () => {
  const { records } = syntheticRecords(3_000, 13);
  const base = { ...ALL, status: "active" as const };
  const top = metrics.buildIntelligenceReport(records, base, REF).distributions.municipality.buckets[0];
  const withCity = metrics.buildIntelligenceReport(records, { ...base, municipality: top.key }, REF);
  const withoutCity = metrics.buildIntelligenceReport(records, base, REF);
  assert.deepEqual(withCity.distributions.municipality, withoutCity.distributions.municipality);
  assert.equal(withCity.summary.total, top.count);
  assert.notDeepEqual(withCity.distributions.cnae, withoutCity.distributions.cnae);
});

test("determinismo: mesma entrada em outra ordem → mesmos números e mesma ordem de segmentos", () => {
  const { records } = syntheticRecords(3_000, 17);
  const shuffled = [...records].reverse();
  const a = metrics.buildIntelligenceReport(records, { ...ALL, contact: "any" }, REF);
  const b = metrics.buildIntelligenceReport(shuffled, { ...ALL, contact: "any" }, REF);
  assert.deepEqual(a.summary, b.summary);
  assert.deepEqual(a.distributions, b.distributions);
  assert.deepEqual(a.opening, b.opening);
  assert.deepEqual([...a.matchedIds].sort(), [...b.matchedIds].sort());
  assert.deepEqual(metrics.buildIntelligenceReport(records, ALL, REF), metrics.buildIntelligenceReport(records, ALL, REF));
});

/* ------------------------------------------------------------ consistência entre visões */

test("consistência: Lista, Mapa e Inteligência contam as MESMAS empresas para os mesmos filtros", () => {
  const { summaries, postal } = buildSyntheticSummaries(2_500, 5);
  const mapCompanies = buildMapCompanies(summaries, new Set(), postal);
  const records = toAnalyticsRecords(mapCompanies);
  const listItems = summaries.map((item: CompanySummary, index: number) => ({
    id: item.id,
    position: index + 1,
    cnpj: item.cnpj,
    legalName: item.legalName,
    tradeName: item.tradeName,
    status: item.status,
    openedAt: item.openedAt,
    headquartersOrBranch: item.headquartersOrBranch,
    size: item.companySize,
    shareCapital: item.capitalSocial,
    simplesOptIn: null,
    meiOptIn: null,
    legalNature: null,
    primaryCnae: item.primaryCnaeCode,
    primaryCnaeDescription: item.primaryCnaeDescription,
    secondaryCnaes: [],
    city: item.cityName,
    state: item.stateCode,
    neighborhood: item.neighborhood,
    postalCode: item.postalCode,
    addressSummary: null,
    email: item.email,
    phone: item.phone,
    phoneIsMobile: item.phoneIsMobile,
    website: null,
    saved: false,
    // Mesmo cálculo da página (municipalityKey do servidor).
    municipalityKey: mapCompanies[index].regionKey
  }));

  const topCity = metrics.buildIntelligenceReport(records, ALL, REF).distributions.municipality.buckets[0].key;
  const cases: CompanyTableFilters[] = [
    ALL,
    { ...ALL, status: "active" },
    { ...ALL, status: "baixada" },
    { ...ALL, municipality: topCity },
    { ...ALL, cnae: "5611201", size: "me" },
    { ...ALL, capital: "100k-500k", contact: "phone" },
    { ...ALL, opened: "12m", branch: "matriz" },
    { ...ALL, opened: "2010" },
    { ...ALL, query: "restaurantes", state: "SP" }
  ];
  for (const filters of cases) {
    const context = { referenceDate: REF };
    const fromList = tableModel.filterCompanyListItems(listItems, filters, context).map((item) => item.id).sort();
    const fromMap = filterMapCompanies(mapCompanies, filters, context).map((company) => company.id).sort();
    const fromIntelligence = [...metrics.buildIntelligenceReport(records, filters, REF).matchedIds].sort();
    assert.deepEqual(fromMap, fromList, `mapa × lista ${JSON.stringify(filters)}`);
    assert.deepEqual(fromIntelligence, fromList, `inteligência × lista ${JSON.stringify(filters)}`);
    assert.ok(fromList.length > 0, `caso sem resultados: ${JSON.stringify(filters)}`);
  }
});

test("consistência: indicadores do painel de região do mapa = KPIs da Inteligência", () => {
  const data = buildSyntheticMapData(1_500, 4);
  const records = toAnalyticsRecords(data.companies, data.regions);
  const intel = metrics.buildIntelligenceReport(records, ALL, REF).summary;
  const region = regionStats.summarizeCompanies(data.companies, { referenceDate: REF });
  assert.equal(region.total, intel.total);
  assert.equal(region.status.active, intel.active.count);
  assert.equal(region.newCompanies.count, intel.newCompanies.count);
  assert.equal(region.newCompanies.known, intel.newCompanies.known);
  assert.equal(region.distinctCnaes, intel.distinct.cnaes);
});

/* ------------------------------------------------------------ universo analisado */

function row(position: number, id: string | null, cnpj = `1122233300${String(position).padStart(4, "0")}`) {
  return {
    position,
    establishment_id: id,
    provider_payload: null,
    establishments: id
      ? { id, cnpj, company_name: `EMPRESA ${position} LTDA`, registration_status: "ATIVA", state_code: "SP", city_name: "Campinas" }
      : null
  };
}

test("universo: mesma reconciliação para todas as visões (bloqueio, teto, inválidas, duplicadas)", () => {
  const rows = [row(1, "a"), row(2, "b"), row(3, null), row(4, "b"), row(5, "c"), row(6, "d")];

  const unlocked = universeLib.buildAnalysisUniverse(rows, { unlocked: true, maxCompanies: 5, reported: 10, stored: 6 });
  assert.deepEqual(
    unlocked.companies.map((item) => item.company.id),
    ["a", "b", "c"]
  );
  assert.deepEqual(unlocked.counts, {
    reported: 10,
    stored: 6,
    unlocked: true,
    locked: 0,
    overLimit: 1,
    invalid: 1,
    duplicates: 1,
    analyzed: 3,
    maxCompanies: 5
  });
  assert.ok(universeLib.reconcileUniverse(unlocked.counts));
  assert.deepEqual(
    universeLib.describeUniverse(unlocked.counts).map((note) => [note.key, note.count]),
    [
      ["not-stored", 4],
      ["over-limit", 1],
      ["invalid", 1],
      ["duplicates", 1]
    ]
  );

  const locked = universeLib.buildAnalysisUniverse(rows.slice(0, 1), { unlocked: false, maxCompanies: 5, reported: 6, stored: 6 });
  assert.equal(locked.counts.analyzed, 1);
  assert.equal(locked.counts.locked, 5);
  assert.ok(universeLib.reconcileUniverse(locked.counts));
  assert.equal(universeLib.universeRowLimit(false, 10_000), 1, "linhas bloqueadas nunca são carregadas");
  assert.equal(universeLib.universeRowLimit(true, 10_000), 10_000);

  const empty = universeLib.buildAnalysisUniverse([], { unlocked: true, maxCompanies: 10, reported: 0, stored: 0 });
  assert.equal(empty.counts.analyzed, 0);
  assert.ok(universeLib.reconcileUniverse(empty.counts));
  assert.deepEqual(universeLib.describeUniverse(empty.counts), []);
});

/* ------------------------------------------------------------ URL */

test("URL: filtros de drill-down têm nomes estáveis e valores validados", () => {
  const parsed = filterParams.parseCompanyFilters(
    new URLSearchParams("municipio=3509502&cnae=4781-4/00&porte=me&capital=10k-50k&abertura=2025-09&situacao=baixada")
  );
  assert.equal(parsed.municipality, "3509502");
  assert.equal(parsed.cnae, "4781400");
  assert.equal(parsed.size, "me");
  assert.equal(parsed.capital, "10k-50k");
  assert.equal(parsed.opened, "2025-09");
  assert.equal(parsed.status, "baixada");
  const written = filterParams.writeCompanyFilters(new URLSearchParams("view=inteligencia"), parsed).toString();
  assert.equal(written, "view=inteligencia&situacao=baixada&municipio=3509502&cnae=4781400&porte=me&capital=10k-50k&abertura=2025-09");
  assert.deepEqual(filterParams.parseCompanyFilters(new URLSearchParams(written)), parsed, "ida e volta");

  const invalid = filterParams.parseCompanyFilters(
    new URLSearchParams("municipio=Campinas&cnae=12&porte=<script>&capital=muito&abertura=2025-13&situacao=x")
  );
  assert.deepEqual(invalid, ALL);
  assert.equal(filterParams.parseCompanyFilters(new URLSearchParams("abertura=12m")).opened, "12m");
  assert.equal(filterParams.pickFilterQuery("?view=mapa&municipio=3509502&empresa=x"), "municipio=3509502");
});

/* ------------------------------------------------------------ gráficos */

test("gráficos: ranking separa o excedente em 'Outros' sem perder contagem; chaves para o drill-down", () => {
  const palette = {
    accent: "#0A5CE6",
    accentMuted: "rgba(10,92,230,.3)",
    neutral: "#C7C7CC",
    label: "#1D1D1F",
    labelSecondary: "#6E6E73",
    separator: "rgba(0,0,0,.1)",
    surface: "#FFF",
    fontFamily: "system-ui"
  };
  const { records } = syntheticRecords(4_000, 2);
  const distribution = metrics.buildIntelligenceReport(records, ALL, REF).distributions.municipality;
  const model = chartOptions.rankingChartModel(distribution.buckets, {
    palette,
    isSelected: () => false,
    hasSelection: false,
    maxItems: 12,
    total: distribution.total
  });
  const series = (model.option.series as Array<{ data: Array<{ value: number }> }>)[0];
  const sum = series.data.reduce((total, item) => total + item.value, 0);
  assert.ok(model.others && model.others.segments === distribution.buckets.filter((b) => b.key !== "na").length - 12);
  assert.equal(sum + model.others!.count, distribution.total, "barras + Outros (texto) = total");
  assert.deepEqual(model.keys.slice(0, 12), distribution.buckets.slice(0, 12).map((bucket) => bucket.key));

  const selected = chartOptions.rankingChartModel(distribution.buckets, {
    palette,
    isSelected: (key) => key === distribution.buckets[0].key,
    hasSelection: true,
    maxItems: 5,
    total: distribution.total
  });
  const colors = (selected.option.series as Array<{ data: Array<{ itemStyle: { color: string } }> }>)[0].data.map((item) => item.itemStyle.color);
  assert.equal(colors[0], palette.accent);
  assert.equal(colors[1], palette.accentMuted);

  const html = chartOptions.rankingChartModel([{ key: "x", label: "<img src=x onerror=alert(1)>", count: 1, share: 1, filterable: true }], {
    palette,
    isSelected: () => false,
    hasSelection: false,
    total: 1
  });
  const formatter = (html.option.tooltip as { formatter: (params: { dataIndex: number }) => string }).formatter;
  assert.equal(formatter({ dataIndex: 0 }).includes("<img"), false, "tooltip escapa HTML vindo dos dados");
});

/* ------------------------------------------------------------ performance */

test("performance: relatório completo (8 dimensões + cross-filter) de 1.000 a 50.000 empresas", () => {
  const rows: Array<Record<string, string | number>> = [];
  for (const size of [1_000, 10_000, 50_000]) {
    const { records } = syntheticRecords(size, 99);
    const t0 = performance.now();
    const all = metrics.buildIntelligenceReport(records, ALL, REF);
    const t1 = performance.now();
    const filtered = metrics.buildIntelligenceReport(records, { ...ALL, status: "active", contact: "any", size: "me", opened: "12m", query: "empresa" }, REF);
    const t2 = performance.now();
    assert.equal(all.summary.total, size);
    assert.ok(filtered.summary.total <= size);
    rows.push({ empresas: size, "sem filtros (ms)": Math.round(t1 - t0), "5 filtros (ms)": Math.round(t2 - t1) });
    assert.ok(t1 - t0 < 3_000, `relatório de ${size} empresas levou ${Math.round(t1 - t0)} ms`);
  }
  console.table(rows);
});

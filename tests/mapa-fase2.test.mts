import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";
process.env.CASA_DOS_DADOS_API_KEY = "test-key-secret";

const externalRequests: string[] = [];
(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  externalRequests.push(String(url));
  throw new Error("rede desabilitada nos testes");
};

const { resolveCompanyLocation } = await import("../lib/geo/company-location.ts");
const { buildMapCompanies, buildRegionSeats, municipalityKey } = await import("../lib/map/service.ts");
const { buildSyntheticSummaries, buildSyntheticMapData } = await import("../lib/map/dev-fixtures.ts");
const { createCompanyClusterIndex } = await import("../lib/map/clustering.ts");
const { filterMapCompanies, mapCompanyToFilterSubject } = await import("../lib/map/filters.ts");
const tableModel = await import("../lib/results/company-table-model.ts");
const filterParams = await import("../lib/results/filter-params.ts");
const stats = await import("../lib/map/intelligence/region-stats.ts");
const h3grid = await import("../lib/map/intelligence/h3-grid.ts");
const colorScale = await import("../lib/map/intelligence/color-scale.ts");
const viewModel = await import("../lib/map/view-model.ts");
const config = await import("../lib/map/config.ts");
const styles = await import("../lib/map/maplibre/styles.ts");
const geo = await import("../lib/map/geo.ts");
const types = await import("../lib/map/types.ts");

type MapCompany = import("../lib/map/types.ts").MapCompany;
type CompanySummary = import("../lib/company-model.ts").CompanySummary;

function summary(overrides: Partial<CompanySummary> = {}): CompanySummary {
  return {
    id: overrides.id ?? "id-1",
    cnpj: overrides.cnpj ?? "11222333000181",
    legalName: "EMPRESA TESTE LTDA",
    tradeName: null,
    displayName: "EMPRESA TESTE LTDA",
    status: "ATIVA",
    openedAt: "2020-01-01",
    primaryCnaeCode: "4781400",
    primaryCnaeDescription: "Vestuário",
    companySize: "ME",
    capitalSocial: 10000,
    email: null,
    phone: null,
    phoneIsMobile: false,
    headquartersOrBranch: null,
    neighborhood: null,
    cityName: "Campinas",
    cityIbge: null,
    stateCode: "SP",
    postalCode: null,
    payload: null,
    ...overrides
  };
}

/* ------------------------------------------------------------ geolocalização */

test("localização: prioridade fonte → cache por empresa → CEP → município → UF", () => {
  const cache = (cnpj: string) =>
    cnpj === "1" ? { latitude: -22.91, longitude: -47.06, precision: "exact" as const } : null;
  const cep = (value: string) => (value === "13015904" ? { latitude: -22.9, longitude: -47.05 } : null);

  const provider = resolveCompanyLocation(
    { cnpj: "1", cep: "13015904", cityName: "Campinas", stateCode: "SP", payload: { endereco: { latitude: -22.95, longitude: -47.1 } } },
    cep,
    cache
  );
  assert.equal(provider?.precision, "address");
  assert.equal(provider?.source, "provider");

  const cached = resolveCompanyLocation({ cnpj: "1", cep: "13015904", cityName: "Campinas", stateCode: "SP" }, cep, cache);
  assert.equal(cached?.precision, "exact");
  assert.equal(cached?.source, "company_cache");

  const byCep = resolveCompanyLocation({ cnpj: "2", cep: "13015904", cityName: "Campinas", stateCode: "SP" }, cep, cache);
  assert.equal(byCep?.precision, "postal_code");

  const byCity = resolveCompanyLocation({ cnpj: "2", cityName: "Campinas", stateCode: "SP" }, cep, cache);
  assert.equal(byCity?.precision, "city");
});

test("localização: cache por empresa inválido (fora do Brasil ou precisão agregada) é ignorado", () => {
  const outside = resolveCompanyLocation({ cnpj: "1", cityName: "Campinas", stateCode: "SP" }, undefined, () => ({
    latitude: 48.85,
    longitude: 2.35,
    precision: "exact"
  }));
  assert.equal(outside?.precision, "city");
  const aggregated = resolveCompanyLocation({ cnpj: "1", cityName: "Campinas", stateCode: "SP" }, undefined, () => ({
    latitude: -22.9,
    longitude: -47.06,
    precision: "city" as never
  }));
  assert.equal(aggregated?.source, "municipality_centroid");
});

test("precisão: aproximada nunca é tratada como ponto exato em nenhuma camada", () => {
  for (const precision of ["postal_code", "city", "approximate"] as const) {
    assert.equal(types.isPreciseLocation(precision), false);
  }
  const { summaries, postal } = buildSyntheticSummaries(500, 7);
  const companies = buildMapCompanies(summaries, new Set(), postal);
  const counts = { city: 0, postal_code: 0, address: 0 } as Record<string, number>;
  for (const company of companies) if (company.location) counts[company.location.precision] = (counts[company.location.precision] ?? 0) + 1;
  assert.ok(counts.city > counts.postal_code && counts.postal_code > counts.address, JSON.stringify(counts));
  // O espalhamento visual nunca altera a coordenada usada na análise.
  const sameCity = companies.filter((company) => company.location?.precision === "city" && company.cityName === companies.find((c) => c.location?.precision === "city")?.cityName);
  assert.ok(sameCity.length > 1);
  assert.equal(new Set(sameCity.map((company) => `${company.location!.latitude},${company.location!.longitude}`)).size, 1);
});

/* ------------------------------------------------------------ filtros compartilhados */

test("filtros: Lista e Mapa usam a MESMA regra (mesmo resultado para os mesmos dados)", () => {
  const { summaries, postal } = buildSyntheticSummaries(2_000, 3);
  const companies = buildMapCompanies(summaries, new Set(), postal);
  const listItems = summaries.map((item, index) => ({
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
    saved: false
  }));

  const cases = [
    { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, status: "active" as const },
    { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, contact: "mobile" as const },
    { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, contact: "email" as const, state: "SP" },
    { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, branch: "filial" as const, status: "inactive" as const },
    { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, query: "restaurantes" },
    { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, query: "10.000.012" }
  ];
  for (const filters of cases) {
    const fromList = tableModel.filterCompanyListItems(listItems, filters).map((item) => item.id).sort();
    const fromMap = filterMapCompanies(companies, filters).map((company) => company.id).sort();
    assert.deepEqual(fromMap, fromList, JSON.stringify(filters));
    assert.ok(fromList.length > 0, `caso sem resultados: ${JSON.stringify(filters)}`);
  }
});

test("filtros: o mapa recebe só indicadores de contato, nunca o contato", () => {
  const [company] = buildMapCompanies([summary({ email: "a@b.com", phone: "(11) 98765-4321", phoneIsMobile: true })], new Set(), new Map());
  assert.equal(company.hasEmail, true);
  assert.equal(company.hasMobilePhone, true);
  const serialized = JSON.stringify(company);
  assert.equal(serialized.includes("a@b.com"), false);
  assert.equal(serialized.includes("98765"), false);
  assert.equal(mapCompanyToFilterSubject(company).searchText.includes("a@b.com"), false);
});

test("filtros na URL: mesmos nomes na Lista e no Mapa; valores inválidos voltam ao padrão", () => {
  const parsed = filterParams.parseCompanyFilters(new URLSearchParams("q=padaria&situacao=active&contato=mobile&uf=sp&unidade=matriz"));
  assert.deepEqual(parsed, { query: "padaria", status: "active", contact: "mobile", state: "SP", branch: "matriz" });
  assert.deepEqual(
    filterParams.parseCompanyFilters({ situacao: "x", contato: "fax", uf: "São Paulo", unidade: ["filial", "matriz"] }),
    { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, branch: "filial" }
  );
  const written = filterParams.writeCompanyFilters(new URLSearchParams("view=mapa&situacao=inactive"), {
    ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS,
    state: "RJ"
  });
  assert.equal(written.toString(), "view=mapa&uf=RJ");
  assert.equal(filterParams.pickFilterQuery("?view=mapa&empresa=1&uf=RJ&q=abc"), "q=abc&uf=RJ");
  assert.equal(types.mapLayerFromParam("concentracao"), "concentration");
  assert.equal(types.mapLayerFromParam("x"), null);
});

/* ------------------------------------------------------------ indicadores */

test("indicadores de região: ativas, novas (12 meses), CNAEs e porte sem inventar dados", () => {
  const base = buildMapCompanies(
    [
      summary({ id: "1", cnpj: "1", status: "ATIVA", openedAt: "2026-05-10", companySize: "ME", primaryCnaeCode: "4781400" }),
      summary({ id: "2", cnpj: "2", status: "BAIXADA", openedAt: "2019-02-01", companySize: "EPP", primaryCnaeCode: "4781400" }),
      summary({ id: "3", cnpj: "3", status: null, openedAt: null, companySize: null, primaryCnaeCode: "5611201", primaryCnaeDescription: "Restaurantes" }),
      summary({ id: "4", cnpj: "4", status: "Ativa", openedAt: "2025-10-01", companySize: "ME", primaryCnaeCode: null })
    ],
    new Set(),
    new Map()
  );
  const result = stats.summarizeCompanies(base, { now: new Date("2026-09-25T12:00:00Z") });
  assert.equal(result.total, 4);
  assert.deepEqual(result.status, { active: 2, inactive: 1, unknown: 1 });
  assert.deepEqual({ count: result.newCompanies.count, known: result.newCompanies.known }, { count: 2, known: 3 });
  assert.equal(result.newCompanies.since, "2025-09-25");
  assert.equal(result.topCnaes[0].key, "4781400");
  assert.equal(result.topCnaes[0].count, 2);
  assert.match(result.topCnaes[0].label, /^4781-4\/00/);
  assert.equal(result.cnaeUnknown, 1);
  assert.deepEqual(
    result.bySize.map((item) => [item.label, item.count]),
    [
      ["ME", 2],
      ["EPP", 1]
    ]
  );
  assert.equal(result.sizeUnknown, 1);
  assert.equal(stats.percentOf(1, 0), null, "sem denominador não há percentual");
  assert.equal(stats.percentOf(2, 3), 67);

  const empty = stats.summarizeCompanies([]);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.topCnaes, []);
});

test("regiões: agregação por município (IBGE) com empresas não identificadas à parte", () => {
  const summaries = [
    summary({ id: "a", cnpj: "1", cityIbge: "3509502", cityName: "Campinas" }),
    summary({ id: "b", cnpj: "2", cityName: "CAMPINAS", stateCode: "SP" }),
    summary({ id: "c", cnpj: "3", cityName: "São Paulo", stateCode: "SP" }),
    summary({ id: "d", cnpj: "4", cityName: "Cidade Que Não Existe", stateCode: "SP" })
  ];
  const companies = buildMapCompanies(summaries, new Set(), new Map());
  const seats = buildRegionSeats(summaries);
  assert.equal(municipalityKey({ cityIbge: "3509502" }), "3509502");
  assert.equal(municipalityKey({ cityName: "CAMPINAS", stateCode: "sp" }), "3509502", "nome + UF resolve para o mesmo IBGE");
  assert.equal(municipalityKey({ cityName: "Cidade Que Não Existe", stateCode: "SP" }), null);
  assert.equal(seats.length, 2, "Campinas (por IBGE e por nome) vira uma única região");
  const aggregate = stats.aggregateByMunicipality(companies, seats);
  const total = aggregate.regions.reduce((sum, region) => sum + region.count, 0);
  assert.equal(total + aggregate.unmatched, companies.length);
  assert.equal(aggregate.unmatched, 1);
  assert.deepEqual(
    aggregate.regions.map((region) => [region.seat.name, region.count]),
    [
      ["Campinas", 2],
      ["São Paulo", 1]
    ]
  );
  for (const region of aggregate.regions) {
    const seat = seats.find((item) => item.key === region.seat.key);
    assert.ok(seat && geo.isWithinBrazil(seat.latitude, seat.longitude));
  }
});

/* ------------------------------------------------------------ H3 */

test("H3: cada empresa entra em uma célula pela coordenada real (não pela posição espalhada)", () => {
  const data = buildSyntheticMapData(3_000, 11);
  const located = data.companies.filter((company) => company.location);
  const cells = h3grid.aggregateCompaniesByH3(data.companies, 6);
  assert.equal(
    cells.reduce((sum, cell) => sum + cell.count, 0),
    located.length,
    "nenhuma empresa perdida ou duplicada"
  );
  // Empresas do mesmo município (precisão city) caem na MESMA célula, mesmo espalhadas no desenho.
  const campinas = located.filter((company) => company.location!.precision === "city" && company.regionKey === located.find((c) => c.location!.precision === "city")!.regionKey);
  const cellIds = new Set(campinas.map((company) => cells.find((cell) => cell.companyIds.includes(company.id))!.id));
  assert.equal(cellIds.size, 1);
  for (const cell of cells.slice(0, 20)) {
    assert.equal(cell.resolution, 6);
    assert.ok(cell.polygon.length >= 7, "hexágono fechado (GeoJSON)");
    assert.deepEqual(cell.polygon[0], cell.polygon[cell.polygon.length - 1]);
    assert.ok(cell.areaKm2 > 20 && cell.areaKm2 < 60);
    assert.ok(cell.approximate <= cell.count);
  }
});

test("H3: resolução acompanha o zoom e é limitada pela precisão dos dados", () => {
  let previous = 0;
  for (let zoom = 2; zoom <= 18; zoom += 0.5) {
    const resolution = h3grid.resolutionForZoom(zoom);
    assert.ok(resolution >= previous);
    previous = resolution;
  }
  assert.equal(h3grid.resolutionForZoom(3), 3);
  assert.equal(h3grid.resolutionForZoom(16), 9);
  assert.equal(h3grid.maxResolutionForPrecision({ exact: 0, address: 5, postal_code: 5, city: 90, approximate: 0 }), 6);
  assert.equal(h3grid.maxResolutionForPrecision({ exact: 0, address: 10, postal_code: 80, city: 10, approximate: 0 }), 8);
  assert.equal(h3grid.maxResolutionForPrecision({ exact: 50, address: 45, postal_code: 5, city: 0, approximate: 0 }), 9);
  assert.equal(h3grid.maxResolutionForPrecision({ exact: 0, address: 0, postal_code: 0, city: 0, approximate: 0 }), 6);
});

test("escala de cores por quantis: classes contíguas cobrindo do mínimo ao máximo", () => {
  const ramp = colorScale.sequentialRamp([255, 255, 255, 255], [10, 92, 230, 255], 6);
  assert.equal(ramp.length, 6);
  const values = [1, 1, 1, 2, 2, 3, 5, 8, 13, 400];
  const bins = colorScale.buildColorBins(values, ramp);
  assert.ok(bins.length >= 2 && bins.length <= 6);
  assert.equal(bins[0].min, 1);
  assert.equal(bins[bins.length - 1].max, 400);
  for (let index = 1; index < bins.length; index += 1) assert.equal(bins[index].min, bins[index - 1].max + 1);
  assert.deepEqual(colorScale.colorForValue(400, bins), bins[bins.length - 1].color);
  assert.deepEqual(colorScale.buildColorBins([], ramp), []);
  assert.deepEqual(colorScale.buildColorBins([7, 7, 7], ramp).map((bin) => [bin.min, bin.max]), [[7, 7]]);
});

/* ------------------------------------------------------------ viewport */

test("viewport: enquadramento dos dados e contagem visível", () => {
  const data = buildSyntheticMapData(1_000, 5);
  const bounds = viewModel.computeDataBounds(data.companies)!;
  assert.ok(bounds.west < bounds.east && bounds.south < bounds.north);
  const all = viewModel.visibleCompanies(data.companies, bounds);
  assert.equal(all.count, data.companies.filter((company) => company.location).length);
  assert.equal(all.ids.length, viewModel.ACCESSIBLE_LIST_LIMIT);
  const saoPaulo = viewModel.visibleCompanies(data.companies, { west: -46.9, east: -46.3, south: -23.8, north: -23.3 });
  assert.ok(saoPaulo.count > 0 && saoPaulo.count < all.count);
  assert.equal(viewModel.computeDataBounds([]), null);
  const padded = viewModel.padBounds({ west: -50, east: -40, south: -20, north: -10 }, 0.1);
  assert.deepEqual(padded, { west: -51, east: -39, south: -21, north: -9 });
});

/* ------------------------------------------------------------ mapa base */

test("mapa base 2D: catálogo sem chave, estilo próprio opcional e fallback local", () => {
  const base = { ...config.DEFAULT_PUBLIC_MAP_CONFIG };
  assert.equal(styles.resolveBasemap(base, "light").id, "osm");
  assert.equal(styles.resolveBasemap({ ...base, basemap: "ion" }, "light").id, "osm", "Cesium ion é só 3D");
  const carto = styles.resolveBasemap({ ...base, basemap: "carto-light" }, "dark");
  assert.match(JSON.stringify(carto.style), /dark_all/, "CARTO acompanha o tema");
  const custom = styles.resolveBasemap({ ...base, styleUrl: "https://tiles.example.com/style.json" }, "light");
  assert.equal(custom.id, "custom");
  assert.equal(custom.style, "https://tiles.example.com/style.json");
  const offline = styles.fallbackBasemap("light");
  assert.equal(JSON.stringify(offline.style).includes("http"), false, "fallback sem rede");
  assert.equal(config.sanitizeStyleUrl("javascript:alert(1)"), "");
  assert.equal(config.sanitizeStyleUrl("//evil.example/style.json"), "");
  assert.equal(config.sanitizeStyleUrl("/estilos/mapa.json"), "/estilos/mapa.json");
});

/* ------------------------------------------------------------ volume */

test("volume: 100, 1.000, 10.000 e 50.000 empresas (pipeline do servidor + índices do navegador)", () => {
  const rows: string[] = [];
  for (const size of [100, 1_000, 10_000, 50_000]) {
    const t0 = performance.now();
    const { summaries, postal } = buildSyntheticSummaries(size, 99);
    const companies: MapCompany[] = buildMapCompanies(summaries, new Set(), postal);
    const t1 = performance.now();
    const index = createCompanyClusterIndex(companies);
    const t2 = performance.now();
    for (let zoom = 3; zoom <= 16; zoom += 1) index.query(geo.BRAZIL_BOUNDS, zoom);
    const t3 = performance.now();
    const cells = h3grid.aggregateCompaniesByH3(companies, 6);
    const t4 = performance.now();
    const summaryStats = stats.summarizeCompanies(companies);
    const regions = stats.aggregateByMunicipality(companies, buildRegionSeats(summaries));
    const t5 = performance.now();
    const filtered = filterMapCompanies(companies, { ...tableModel.DEFAULT_COMPANY_TABLE_FILTERS, status: "active", query: "empresa" });
    const t6 = performance.now();

    assert.equal(summaryStats.total, size);
    assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), companies.filter((company) => company.location).length);
    assert.ok(regions.regions.length > 0);
    assert.ok(filtered.length > 0 && filtered.length < size);
    // Orçamentos generosos (CI lento); os tempos reais ficam no log.
    const budget = Math.max(1, size / 1_000);
    assert.ok(t2 - t1 < 400 * budget, `índice ${size}: ${(t2 - t1).toFixed(0)}ms`);
    assert.ok(t4 - t3 < 400 * budget, `H3 ${size}: ${(t4 - t3).toFixed(0)}ms`);
    assert.ok(t6 - t5 < 400 * budget, `filtros ${size}: ${(t6 - t5).toFixed(0)}ms`);
    rows.push(
      `${String(size).padStart(6)} empresas | modelo ${(t1 - t0).toFixed(0)}ms | índice ${(t2 - t1).toFixed(0)}ms | 14 consultas ${(t3 - t2).toFixed(0)}ms | H3 ${(t4 - t3).toFixed(0)}ms (${cells.length} células) | indicadores ${(t5 - t4).toFixed(0)}ms | filtros ${(t6 - t5).toFixed(0)}ms`
    );
  }
  console.log(`# desempenho do mapa\n# ${rows.join("\n# ")}`);
});

test("resposta do mapa: gzip quando o navegador aceita (JSON de 10.000 empresas cai para ~10%)", async () => {
  const { mapJsonResponse } = await import("../lib/map/json-response.ts");
  const { gunzipSync } = await import("node:zlib");
  const data = buildSyntheticMapData(10_000, 1);
  const raw = JSON.stringify(data);
  const gzipped = await mapJsonResponse(new Request("http://x/", { headers: { "Accept-Encoding": "gzip, br" } }), data);
  assert.equal(gzipped.headers.get("content-encoding"), "gzip");
  const body = Buffer.from(await gzipped.arrayBuffer());
  assert.ok(body.length < raw.length * 0.2, `${body.length} de ${raw.length} bytes`);
  assert.equal(gunzipSync(body).toString(), raw);
  const plain = await mapJsonResponse(new Request("http://x/"), data, { headers: { "Cache-Control": "private, no-store" } });
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal(plain.headers.get("cache-control"), "private, no-store");
  const small = await mapJsonResponse(new Request("http://x/", { headers: { "Accept-Encoding": "gzip" } }), { ok: true });
  assert.equal(small.headers.get("content-encoding"), null, "respostas pequenas não são comprimidas");
});

test("nenhum teste do mapa acessou a rede", () => {
  assert.deepEqual(externalRequests, []);
});

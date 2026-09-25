import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";
process.env.CASA_DOS_DADOS_API_KEY = "test-key-secret";

const externalRequests: string[] = [];
(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  externalRequests.push(String(url));
  throw new Error("rede desabilitada nos testes");
};

const geo = await import("../lib/map/geo.ts");
const { resolveCompanyLocation, spreadSharedLocations, extractProviderCoordinates, normalizeCep } = await import("../lib/geo/company-location.ts");
const { findMunicipality, municipalitiesInBounds, findStateCentroid } = await import("../lib/geo/municipalities.ts");
const { createCompanyClusterIndex, formatClusterCount } = await import("../lib/map/clustering.ts");
const { planAreaSearch, describeAreaSearchPlan } = await import("../lib/map/area-search.ts");
const { resolvePostalCodes, __resetPostalCodeMemoryCache } = await import("../lib/geo/postal-code-geocoder.ts");
const { buildMapCompanies, summarizeMapCompanies, getSearchMapData, MapSearchNotFoundError } = await import("../lib/map/service.ts");
const { ResultsViewToggle } = await import("../components/map/results-view-toggle.tsx");
const types = await import("../lib/map/types.ts");

type MapCompany = import("../lib/map/types.ts").MapCompany;
type CompanySummary = import("../lib/company-model.ts").CompanySummary;

function summary(overrides: Partial<CompanySummary> = {}): CompanySummary {
  return {
    id: overrides.id ?? `id-${Math.random()}`,
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

/** Gera empresas espalhadas pelo Brasil com localização exata sintética. */
function syntheticCompanies(count: number): MapCompany[] {
  const companies: MapCompany[] = [];
  for (let index = 0; index < count; index += 1) {
    const latitude = -30 + ((index * 7919) % 2500) / 100;
    const longitude = -70 + ((index * 104729) % 3000) / 100;
    companies.push({
      id: `c${index}`,
      cnpj: String(10_000_000_000_000 + index),
      displayName: `Empresa ${index}`,
      legalName: `Empresa ${index}`,
      tradeName: null,
      status: "ATIVA",
      primaryCnaeCode: "4781400",
      primaryCnaeDescription: null,
      cityName: null,
      stateCode: null,
      capitalSocial: null,
      openedAt: null,
      companySize: null,
      saved: false,
      location: {
        cnpj: String(index),
        latitude,
        longitude,
        precision: "address",
        source: "provider",
        displayLatitude: latitude,
        displayLongitude: longitude
      }
    });
  }
  return companies;
}

/* ---------------------------------------------------------------- localização */

test("coordenadas da Casa dos Dados em endereco.ibge são tratadas como município (nunca como exatas)", () => {
  const payload = {
    casadosdados_pesquisa: { endereco: { municipio: "CAMPINAS", uf: "SP", ibge: { codigo_municipio: 3509502, latitude: -22.9053, longitude: -47.0659 } } }
  };
  const location = resolveCompanyLocation({ cnpj: "1", cityName: "Campinas", stateCode: "SP", payload });
  assert.ok(location);
  assert.equal(location!.precision, "city");
  assert.equal(location!.source, "provider_municipality");
  assert.equal(types.isPreciseLocation(location!.precision), false);
});

test("coordenadas do próprio endereço, quando existirem, têm prioridade", () => {
  const coords = extractProviderCoordinates({ endereco: { latitude: "-23.561", longitude: "-46.656", ibge: { latitude: -23.55, longitude: -46.63 } } });
  assert.deepEqual(coords.address, { latitude: -23.561, longitude: -46.656 });
  const location = resolveCompanyLocation({ cnpj: "1", payload: { endereco: { latitude: -23.561, longitude: -46.656 } } });
  assert.equal(location?.precision, "address");
});

test("coordenadas inválidas ou fora do Brasil são ignoradas", () => {
  const coords = extractProviderCoordinates({ endereco: { latitude: 0, longitude: 0, ibge: { latitude: 48.8, longitude: 2.35 } } });
  assert.equal(coords.address, null);
  assert.equal(coords.municipality, null);
});

test("fallbacks: cache de CEP → município (IBGE ou nome+UF) → UF → sem localização", () => {
  const byCep = resolveCompanyLocation({ cnpj: "1", cep: "13015-904", cityName: "Campinas", stateCode: "SP" }, (cep) =>
    cep === "13015904" ? { latitude: -22.9, longitude: -47.06 } : null
  );
  assert.equal(byCep?.precision, "postal_code");

  const byName = resolveCompanyLocation({ cnpj: "1", cityName: "SÃO PAULO", stateCode: "sp" });
  assert.equal(byName?.precision, "city");
  assert.equal(byName?.source, "municipality_centroid");

  const byIbge = resolveCompanyLocation({ cnpj: "1", cityIbge: "3509502" });
  assert.equal(byIbge?.source, "municipality_centroid");
  assert.equal(findMunicipality({ ibge: "3509502" })?.name, "Campinas");

  const byState = resolveCompanyLocation({ cnpj: "1", cityName: "Cidade Inexistente", stateCode: "MG" });
  assert.equal(byState?.precision, "approximate");
  assert.ok(findStateCentroid("MG"));

  assert.equal(resolveCompanyLocation({ cnpj: "1" }), null);
  assert.equal(normalizeCep("00000-000"), null);
});

test("empresas no mesmo ponto aproximado são distribuídas sem perder a coordenada original", () => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    location: {
      cnpj: String(index).padStart(14, "0"),
      latitude: -22.9053,
      longitude: -47.0659,
      precision: "city" as const,
      source: "municipality_centroid" as const,
      displayLatitude: -22.9053,
      displayLongitude: -47.0659
    }
  }));
  spreadSharedLocations(items);
  const displayed = new Set(items.map((item) => `${item.location.displayLatitude.toFixed(6)},${item.location.displayLongitude.toFixed(6)}`));
  assert.equal(displayed.size, 40, "cada empresa ganha um ponto de desenho próprio");
  for (const item of items) {
    assert.equal(item.location.latitude, -22.9053);
    const dLat = Math.abs(item.location.displayLatitude - item.location.latitude) * 111_320;
    assert.ok(dLat <= geo.SPREAD_RADIUS_METERS.city + 1, "distribuição limitada ao raio da precisão");
  }
  // Determinístico: mesmo resultado a cada chamada.
  const again = items.map((item) => ({ location: { ...item.location, displayLatitude: -22.9053, displayLongitude: -47.0659 } }));
  spreadSharedLocations(again);
  assert.equal(again[7].location.displayLatitude, items[7].location.displayLatitude);
});

test("marcadores e estatísticas: empresas sem localização continuam contadas", () => {
  const companies = buildMapCompanies(
    [
      summary({ id: "a", cnpj: "1", cityName: "Campinas", stateCode: "SP" }),
      summary({ id: "b", cnpj: "2", cityName: null, stateCode: null }),
      summary({ id: "c", cnpj: "3", postalCode: "01310100", cityName: "São Paulo", stateCode: "SP" })
    ],
    new Set(["a"]),
    new Map([["01310100", { latitude: -23.561, longitude: -46.656 }]])
  );
  const stats = summarizeMapCompanies(companies);
  assert.equal(stats.loaded, 3);
  assert.equal(stats.withLocation, 2);
  assert.equal(stats.withoutLocation, 1);
  assert.equal(stats.byPrecision.city, 1);
  assert.equal(stats.byPrecision.postal_code, 1);
  assert.equal(companies.find((item) => item.id === "a")?.saved, true);
});

test("resultado vazio gera estatísticas zeradas e sem limites violados", () => {
  const stats = summarizeMapCompanies(buildMapCompanies([], new Set(), new Map()));
  assert.deepEqual(stats, { loaded: 0, withLocation: 0, withoutLocation: 0, byPrecision: { exact: 0, address: 0, postal_code: 0, city: 0, approximate: 0 } });
  assert.equal(geo.boundsFromPoints([]), null);
});

/* ---------------------------------------------------------------- clustering */

test("clustering: zoom distante agrupa, zoom próximo mostra empresas individuais", () => {
  const companies = syntheticCompanies(1284);
  const index = createCompanyClusterIndex(companies);
  const brazil = geo.BRAZIL_BOUNDS;

  const far = index.query(brazil, 3);
  const farTotal = far.reduce((sum, item) => sum + (item.kind === "cluster" ? item.count : 1), 0);
  assert.equal(farTotal, 1284, "nenhuma empresa é perdida no agrupamento");
  assert.ok(far.length < 80, `poucos elementos na visão nacional (${far.length})`);

  const cluster = far.find((item) => item.kind === "cluster");
  assert.ok(cluster && cluster.kind === "cluster");
  const expansion = index.expansionZoom(cluster.clusterId);
  assert.ok(expansion > 3);
  assert.ok(index.leaves(cluster.clusterId, 5).length > 0);

  const target = companies[10].location!;
  const street = index.query(
    { west: target.longitude - 0.01, east: target.longitude + 0.01, south: target.latitude - 0.01, north: target.latitude + 0.01 },
    17
  );
  assert.ok(street.some((item) => item.kind === "company" && item.companyId === "c10"));
  assert.ok(street.every((item) => item.kind === "company"));
});

test("clustering ignora empresas sem coordenada e lida com índice vazio", () => {
  const withoutLocation = syntheticCompanies(3).map((company) => ({ ...company, location: null }));
  const index = createCompanyClusterIndex(withoutLocation);
  assert.equal(index.size, 0);
  assert.deepEqual(index.query(geo.BRAZIL_BOUNDS, 4), []);
  assert.equal(formatClusterCount(1284), "1.284");
  assert.equal(formatClusterCount(12400), "12,4 mil");
});

test("grandes volumes: 20.000 empresas indexadas e consultadas rapidamente", () => {
  const companies = syntheticCompanies(20_000);
  const started = performance.now();
  const index = createCompanyClusterIndex(companies);
  const built = performance.now() - started;
  const queryStarted = performance.now();
  for (let zoom = 3; zoom <= 12; zoom += 1) index.query(geo.BRAZIL_BOUNDS, zoom);
  const queried = performance.now() - queryStarted;
  assert.ok(built < 2000, `índice em ${built.toFixed(0)}ms`);
  assert.ok(queried < 2000, `consultas em ${queried.toFixed(0)}ms`);
  assert.ok(index.query(geo.BRAZIL_BOUNDS, 3).length < 200);
});

/* ---------------------------------------------------------------- geo / câmera */

test("altura da câmera → zoom e escala de visão são monotônicos", () => {
  assert.ok(geo.heightToZoom(10_000_000) < geo.heightToZoom(100_000));
  assert.ok(geo.heightToZoom(100_000) < geo.heightToZoom(1_000));
  assert.equal(geo.viewScaleForHeight(8_000_000), "pais");
  assert.equal(geo.viewScaleForHeight(600_000), "estadual");
  assert.equal(geo.viewScaleForHeight(60_000), "municipal");
  assert.equal(geo.viewScaleForHeight(5_000), "detalhada");
  assert.ok(geo.boundsContain({ west: 170, east: -170, south: -10, north: 10 }, 0, 179), "cruza o antimeridiano");
});

/* ---------------------------------------------------------------- buscar nesta área */

test("buscar nesta área: converte a área visível em municípios suportados pela Casa dos Dados", () => {
  const plan = planAreaSearch({ west: -47.2, east: -46.9, south: -23.0, north: -22.8 }, municipalitiesInBounds, 12);
  assert.equal(plan.kind, "cities");
  if (plan.kind === "cities") {
    assert.ok(plan.cities.some((city) => city.cityName === "Campinas" && city.stateCode === "SP"));
    assert.deepEqual(plan.stateCodes, ["SP"]);
  }
});

test("buscar nesta área: área grande ou com muitos municípios pede aproximação; oceano não busca", () => {
  const huge = planAreaSearch(geo.BRAZIL_BOUNDS, municipalitiesInBounds, 12);
  assert.equal(huge.kind, "too_large");
  assert.match(describeAreaSearchPlan(huge), /Aproxime o mapa/);

  const many = planAreaSearch({ west: -47.5, east: -46.0, south: -24.0, north: -22.5 }, municipalitiesInBounds, 5);
  assert.equal(many.kind, "too_large");

  const ocean = planAreaSearch({ west: -30.5, east: -30.0, south: -20.5, north: -20.0 }, municipalitiesInBounds, 12);
  assert.equal(ocean.kind, "empty");

  assert.equal(planAreaSearch({ west: Number.NaN, east: 0, south: 0, north: 1 }, municipalitiesInBounds, 12).kind, "invalid");
});

/* ---------------------------------------------------------------- geocodificação controlada */

test("geocodificação de CEP: respeita o limite por requisição e usa cache", async () => {
  __resetPostalCodeMemoryCache();
  let calls = 0;
  const geocoder = {
    id: "fake",
    async geocode() {
      calls += 1;
      return { latitude: -23.5, longitude: -46.6 };
    }
  };
  const ceps = Array.from({ length: 50 }, (_, index) => String(10_000_000 + index));
  const written: unknown[] = [];
  const first = await resolvePostalCodes(ceps, {
    geocoder,
    maxLookups: 10,
    readCache: async () => new Map(),
    writeCache: async (rows) => {
      written.push(...rows);
    }
  });
  assert.equal(calls, 10, "no máximo 10 consultas novas");
  assert.equal(first.points.size, 10);
  assert.equal(first.pending, 40);
  assert.equal(written.length, 10);

  const second = await resolvePostalCodes(ceps.slice(0, 10), { geocoder, maxLookups: 10, readCache: async () => new Map(), writeCache: async () => {} });
  assert.equal(calls, 10, "CEPs já resolvidos não são consultados de novo");
  assert.equal(second.points.size, 10);
});

test("geocodificação de CEP: desligada por padrão e interrompida em 429", async () => {
  __resetPostalCodeMemoryCache();
  const disabled = await resolvePostalCodes(["01310100"], { readCache: async () => new Map(), writeCache: async () => {} });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.points.size, 0);
  assert.equal(externalRequests.length, 0, "nenhuma requisição externa sem provider configurado");

  let calls = 0;
  const limited = await resolvePostalCodes(
    Array.from({ length: 20 }, (_, index) => String(20_000_000 + index)),
    {
      geocoder: {
        id: "fake",
        async geocode() {
          calls += 1;
          throw new Error("geocoder_http_429");
        }
      },
      maxLookups: 20,
      concurrency: 1,
      readCache: async () => new Map(),
      writeCache: async () => {}
    }
  );
  assert.equal(calls, 1, "circuit breaker após 429");
  assert.equal(limited.points.size, 0);
});

/* ---------------------------------------------------------------- serviço / UI */

test("busca inexistente ou id inválido não chega ao banco", async () => {
  await assert.rejects(() => getSearchMapData("nao-e-uuid", "user"), (error: unknown) => error instanceof MapSearchNotFoundError);
});

test("troca Empresas/Mapa/Inteligência aponta para a mesma busca salva, preservando filtros", () => {
  const anchors = (html: string) =>
    Array.from(html.matchAll(/<a([^>]*)>([^<]*)<\/a>/g)).map((match) => ({
      label: match[2],
      href: /href="([^"]*)"/.exec(match[1])?.[1]?.replace(/&amp;/g, "&"),
      current: /aria-current="page"/.test(match[1])
    }));
  const list = anchors(renderToStaticMarkup(createElement(ResultsViewToggle, { searchId: "abc", view: "lista" })));
  assert.deepEqual(list, [
    { label: "Empresas", href: "/dashboard/search/abc", current: true },
    { label: "Mapa", href: "/dashboard/search/abc?view=mapa", current: false },
    { label: "Inteligência", href: "/dashboard/search/abc?view=inteligencia", current: false }
  ]);
  const map = anchors(
    renderToStaticMarkup(createElement(ResultsViewToggle, { searchId: "abc", view: "mapa", filterQuery: "situacao=active&uf=SP&municipio=3509502" }))
  );
  assert.equal(map.find((item) => item.current)?.label, "Mapa");
  assert.deepEqual(
    map.map((item) => item.href),
    [
      "/dashboard/search/abc?situacao=active&uf=SP&municipio=3509502",
      "/dashboard/search/abc?situacao=active&uf=SP&municipio=3509502&view=mapa",
      "/dashboard/search/abc?situacao=active&uf=SP&municipio=3509502&view=inteligencia"
    ]
  );
});

test("rótulos de precisão nunca chamam localização aproximada de exata", () => {
  for (const precision of ["postal_code", "city", "approximate"] as const) {
    assert.equal(types.isPreciseLocation(precision), false);
    assert.doesNotMatch(types.PRECISION_LABELS[precision], /exata/i);
  }
});

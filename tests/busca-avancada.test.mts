import { describe, test } from "node:test";
import assert from "node:assert/strict";

/**
 * Fase 7 — Busca Empresarial Avançada (unidade, sem rede e sem banco).
 *
 * Cobre: typos, acentos, CNPJ, razão social, nome fantasia, CNAE, cidade, UF, filtros,
 * facetas, documento do índice (lista branca, CPF de MEI, validade), cliente do mecanismo
 * (erros, timeout, disjuntor) e fallback (índice fora do ar → banco → erro tratável).
 * A integração com banco (gatilhos/fila) está em busca-avancada-sync.test.mts.
 */
process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";
(globalThis as { fetch: unknown }).fetch = async () => {
  throw new Error("rede desabilitada nos testes");
};

const text = await import("../lib/search/text.ts");
const { interpretQuery, rankCnaesForTerms, primaryCnaeGroup } = await import("../lib/search/query-understanding.ts");
const { planCompanyQuery } = await import("../lib/search/company-query-plan.ts");
const { toCompanySearchDocument, FORBIDDEN_DOCUMENT_FIELDS } = await import("../lib/search/company-documents.ts");
const index = await import("../lib/search/company-index.ts");
const { createMeiliClient, resetSearchEngineCircuitBreakers, SearchEngineError, isSearchEngineError } = await import(
  "../lib/search/meilisearch.ts"
);
const { searchCompanies, buildDiscoverySuggestion, CompanySearchUnavailableError } = await import("../lib/search/company-search.ts");
const { parseCompanySearchParams, isAuthorizedSyncRequest } = await import("../lib/search/http.ts");
const { fuzzyFilterByName, fuzzyCnaeOptions } = await import("../lib/search/fuzzy-options.ts");
const { getSearchFilterDefaultsFromQuickSearch } = await import("../lib/search-filter-defaults.ts");
const { getSearchEngineConfig, isCompanySearchEngineEnabled } = await import("../lib/search/config.ts");

const NOW = Math.floor(Date.UTC(2026, 8, 26) / 1000);

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------
describe("texto", () => {
  test("acentos, caixa e pontuação viram a mesma chave", () => {
    assert.equal(text.foldSearchText("  SÃO JOSÉ dos Pinhais/PR "), "sao jose dos pinhais pr");
    assert.equal(text.foldSearchText("Conceição & Araújo LTDA."), "conceicao araujo ltda");
  });

  test("CPF de MEI é removido da razão social (LGPD)", () => {
    assert.equal(text.stripPersonalIdentifiers("JOAO DA SILVA 12345678901"), "JOAO DA SILVA");
    assert.equal(text.stripPersonalIdentifiers("MARIA SOUZA 123.456.789-01"), "MARIA SOUZA");
    // CNPJ (14 dígitos) e números curtos não são afetados.
    assert.equal(text.stripPersonalIdentifiers("LOJA 24 HORAS"), "LOJA 24 HORAS");
  });

  test("distância de edição com transposição e poda", () => {
    assert.equal(text.boundedEditDistance("branco", "brnaco", 2), 1);
    assert.equal(text.boundedEditDistance("curitiba", "curitba", 2), 1);
    assert.equal(text.boundedEditDistance("abc", "xyz12345", 2), 3);
  });

  test("CNPJ: máscara, dígitos, raiz, prefixo e alfanumérico", () => {
    assert.deepEqual(text.detectCnpjQuery("12.345.678/0001-95"), { kind: "full", value: "12345678000195" });
    assert.deepEqual(text.detectCnpjQuery("12345678000195"), { kind: "full", value: "12345678000195" });
    assert.deepEqual(text.detectCnpjQuery("12.345.678"), { kind: "root", value: "12345678" });
    assert.deepEqual(text.detectCnpjQuery("123456"), { kind: "prefix", value: "123456" });
    assert.deepEqual(text.detectCnpjQuery("12.ABC.345/01DE-35"), { kind: "full", value: "12ABC34501DE35" });
    assert.equal(text.detectCnpjQuery("padaria 24 horas"), null);
  });
});

// ---------------------------------------------------------------------------
// Intérprete (typos, acentos, cidade, UF, CNAE)
// ---------------------------------------------------------------------------
describe("intérprete de consultas", () => {
  test("exemplo do enunciado: 'transportadoras pato brnaco'", () => {
    const result = interpretQuery("transportadoras pato brnaco");
    assert.equal(result.municipality?.name, "Pato Branco");
    assert.equal(result.municipality?.stateCode, "PR");
    assert.equal(result.municipality?.confidence, "high");
    assert.equal(result.municipality?.distance, 1);
    const group = primaryCnaeGroup(result.cnaes).map((candidate) => candidate.code);
    assert.ok(group.includes("4930202"), `grupo: ${group.join(",")}`);
    assert.ok(group.every((code) => code.startsWith("4930")));
    assert.equal(result.residualText, "transportadoras");
  });

  test("typos em cidade e atividade", () => {
    assert.equal(interpretQuery("padarias curitba").municipality?.name, "Curitiba");
    assert.equal(interpretQuery("construtora joinvile").municipality?.name, "Joinville");
    assert.equal(interpretQuery("hotel gramado").cnaes[0]?.code, "5510801");
    assert.ok(interpretQuery("oficina mecanica londrina").cnaes[0]?.code.startsWith("4520"));
  });

  test("acentos: com e sem acento dão o mesmo resultado", () => {
    const withAccent = interpretQuery("restaurante São Paulo");
    const without = interpretQuery("restaurante sao paulo");
    assert.equal(withAccent.municipality?.ibge, without.municipality?.ibge);
    assert.equal(withAccent.municipality?.name, "São Paulo");
    assert.equal(withAccent.cnaes[0]?.code, without.cnaes[0]?.code);
  });

  test("UF: sigla no fim, nome por extenso e cidade homônima em outro estado", () => {
    const sigla = interpretQuery("farmacia maringa pr");
    assert.equal(sigla.stateCode, "PR");
    assert.equal(sigla.stateSource, "sigla");
    assert.equal(sigla.municipality?.name, "Maringá");
    const nome = interpretQuery("academia em santa catarina");
    assert.equal(nome.stateCode, "SC");
    assert.equal(nome.stateSource, "nome");
    // "Bom Jesus" existe em vários estados: sem UF, não escolhe sozinho.
    const ambiguous = interpretQuery("bom jesus");
    assert.equal(ambiguous.municipality?.confidence, "low");
    assert.ok(ambiguous.municipalityAlternatives.length >= 1);
    assert.equal(interpretQuery("bom jesus rs").municipality?.stateCode, "RS");
  });

  test("CNAE digitado e CNPJ digitado", () => {
    assert.equal(interpretQuery("4930-2/02").cnaes[0]?.code, "4930202");
    assert.equal(interpretQuery("4930202").cnaes[0]?.code, "4930202");
    assert.deepEqual(interpretQuery("12.345.678/0001-95").cnpj, { kind: "full", value: "12345678000195" });
  });

  test("sinônimos de negócio levam ao CNAE oficial", () => {
    assert.equal(rankCnaesForTerms(["dentista"])[0]?.code, "8630504");
    assert.ok(rankCnaesForTerms(["farmacia"])[0]?.code.startsWith("4771"));
    assert.ok(rankCnaesForTerms(["trasnportadora"])[0]?.code.startsWith("4930"));
  });

  test("é rápido (sem rede): < 20 ms por consulta após aquecimento", () => {
    interpretQuery("aquecimento");
    const start = performance.now();
    for (let index = 0; index < 50; index += 1) interpretQuery(`transportadoras pato brnaco ${index % 3 ? "pr" : ""}`);
    assert.ok((performance.now() - start) / 50 < 20);
  });

  test("entrada hostil não quebra nem vaza para filtros", () => {
    const result = interpretQuery(`"; DROP TABLE establishments; -- ${"a".repeat(500)}`);
    assert.ok(result.query.length <= 200);
    const plan = planCompanyQuery(`x" OR profileIds EXISTS OR "`);
    assert.equal(plan.filters.cnpj, undefined);
  });
});

// ---------------------------------------------------------------------------
// Plano de consulta: só o inequívoco vira filtro
// ---------------------------------------------------------------------------
describe("plano de consulta", () => {
  test("CNPJ completo e raiz viram filtro exato", () => {
    assert.equal(planCompanyQuery("12.345.678/0001-95").filters.cnpj, "12345678000195");
    assert.equal(planCompanyQuery("12345678").filters.cnpjRoot, "12345678");
    assert.equal(planCompanyQuery("12345678").q, "");
  });

  test("CNAE digitado vira filtro de CNAE principal", () => {
    const plan = planCompanyQuery("4930-2/02");
    assert.deepEqual(plan.filters.primaryCnaes, ["4930202"]);
    assert.equal(plan.q, "");
  });

  test("sigla de UF no fim vira filtro e sai do texto", () => {
    const plan = planCompanyQuery("farmacia maringa pr");
    assert.deepEqual(plan.filters.stateCodes, ["PR"]);
    assert.equal(plan.q, "farmacia maringa");
  });

  test("cidade reconhecida NÃO filtra silenciosamente (sobrenomes são nomes de cidade)", () => {
    for (const query of ["pousada teixeira", "logistica nova era", "sistemas conceicao", "transportadoras pato brnaco"]) {
      const plan = planCompanyQuery(query);
      assert.equal(plan.filters.cityIbges, undefined, query);
      assert.equal(plan.filters.cities, undefined, query);
    }
    assert.equal(planCompanyQuery("transportadoras pato brnaco").q, "transportadoras pato brnaco");
  });

  test("filtros do usuário prevalecem sobre os inferidos", () => {
    const plan = planCompanyQuery("farmacia maringa pr", { stateCodes: ["SC"] });
    assert.deepEqual(plan.filters.stateCodes, ["SC"]);
  });

  test("palavras de preenchimento saem do texto", () => {
    assert.equal(planCompanyQuery("empresas de transporte").q, "de transporte");
  });
});

// ---------------------------------------------------------------------------
// Documento do índice
// ---------------------------------------------------------------------------
const baseRow = {
  id: "11111111-1111-4111-8111-111111111111",
  cnpj: "12345678000195",
  company_name: "JOAO DA SILVA 12345678901",
  trade_name: "Transportes Silva",
  registration_status: "Ativa",
  opened_at: "2019-05-02",
  primary_cnae_code: "4930-2/02",
  primary_cnae_description: "Transporte rodoviário de carga, exceto produtos perigosos e mudanças, intermunicipal",
  secondary_cnaes: JSON.stringify([{ codigo: "5211701", descricao: "Armazéns gerais" }, { codigo: "4930202", descricao: "dup" }]),
  company_size: "ME",
  city_name: "Pato Branco",
  city_ibge: "4118501",
  state_code: "pr",
  email: "joao@example.com",
  phone: "(46) 99999-0000",
  website: "https://example.com",
  address_line: "Rua X",
  cep: "85501000",
  neighborhood: "Centro",
  capital_social: 10000,
  provider_payload: { casadosdados_detalhe_em: "2026-09-20T10:00:00.000Z", socios: [{ nome: "JOAO" }] }
};

describe("documento do índice", () => {
  test("lista branca: nada de contato, endereço, capital, sócios ou payload", () => {
    const document = toCompanySearchDocument(baseRow, { profileIds: ["p1"], workspaceIds: [] }, { nowEpoch: NOW, ttlDays: 90 });
    assert.ok(document);
    for (const field of FORBIDDEN_DOCUMENT_FIELDS) assert.equal(field in document!, false, field);
    const serialized = JSON.stringify(document);
    for (const secret of ["joao@example.com", "99999", "Rua X", "85501000", "socios", "12345678901"]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
  });

  test("normaliza UF, CNAE, situação, ano, matriz e CNAEs secundários", () => {
    const document = toCompanySearchDocument(baseRow, { profileIds: ["p1", "p1"], workspaceIds: ["w1"] }, { nowEpoch: NOW, ttlDays: 90 })!;
    assert.equal(document.legalName, "JOAO DA SILVA");
    assert.equal(document.stateCode, "PR");
    assert.equal(document.primaryCnae, "4930202");
    assert.equal(document.cnaeClass, "49302");
    assert.deepEqual(document.secondaryCnaes, ["5211701"]);
    assert.equal(document.registrationStatus, "ATIVA");
    assert.equal(document.openedYear, 2019);
    assert.equal(document.headquarters, "matriz");
    assert.deepEqual(document.profileIds, ["p1"]);
    assert.equal(document.source, "casadosdados");
  });

  test("validade: conta a partir da data em que o dado veio da fonte", () => {
    const document = toCompanySearchDocument(baseRow, { profileIds: ["p1"], workspaceIds: [] }, { nowEpoch: NOW, ttlDays: 30 })!;
    assert.equal(document.sourceFetchedAt, Math.floor(Date.parse("2026-09-20T10:00:00.000Z") / 1000));
    assert.equal(document.expiresAt, document.sourceFetchedAt + 30 * 86_400);
    assert.equal(document.indexedAt, NOW);
  });

  test("sem ninguém com acesso ou sem CNPJ válido → não indexa", () => {
    assert.equal(toCompanySearchDocument(baseRow, { profileIds: [], workspaceIds: [] }, { nowEpoch: NOW, ttlDays: 90 }), null);
    assert.equal(toCompanySearchDocument({ ...baseRow, cnpj: "123" }, { profileIds: ["p"], workspaceIds: [] }, { nowEpoch: NOW, ttlDays: 90 }), null);
  });

  test("configuração do índice não expõe permissões e desliga typo em CNPJ", () => {
    const settings = index.COMPANY_INDEX_SETTINGS;
    assert.equal((settings.displayedAttributes as readonly string[]).includes("profileIds"), false);
    assert.equal((settings.displayedAttributes as readonly string[]).includes("workspaceIds"), false);
    assert.ok((settings.typoTolerance.disableOnAttributes as readonly string[]).includes("cnpj"));
    assert.equal(settings.typoTolerance.disableOnNumbers, true);
    for (const facet of index.COMPANY_FACETS) assert.ok((settings.filterableAttributes as readonly string[]).includes(facet), facet);
  });
});

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------
describe("filtros do índice", () => {
  test("visibilidade e validade sempre presentes", () => {
    const filter = index.buildCompanyFilter({ profileId: "p1", workspaceIds: ["w1", "w2"] }, {}, NOW);
    assert.equal(filter, `(profileIds = "p1" OR workspaceIds IN ["w1", "w2"]) AND expiresAt > ${NOW}`);
  });

  test("combina UF, cidade, CNAE, situação, porte, matriz e CNPJ", () => {
    const filter = index.buildCompanyFilter(
      { profileId: "p1", workspaceIds: [] },
      {
        stateCodes: ["pr", "sc"],
        cityIbges: ["4118501"],
        primaryCnaes: ["4930202"],
        registrationStatuses: ["ativa"],
        companySizes: ["ME"],
        headquarters: "matriz",
        cnpjRoot: "12345678"
      },
      NOW
    );
    assert.match(filter, /stateCode IN \["PR", "SC"\]/);
    assert.match(filter, /cityIbge = "4118501"/);
    assert.match(filter, /primaryCnae = "4930202"/);
    assert.match(filter, /registrationStatus = "ATIVA"/);
    assert.match(filter, /headquarters = "matriz"/);
    assert.match(filter, /cnpjRoot = "12345678"/);
  });

  test("valor do usuário não vira sintaxe de filtro (aspas escapadas)", () => {
    const filter = index.buildCompanyFilter({ profileId: "p1", workspaceIds: [] }, { cities: [`X" OR profileIds EXISTS OR "`] }, NOW);
    assert.match(filter, /city = "X\\" OR profileIds EXISTS OR \\""/);
    assert.throws(() => index.buildCompanyFilter({ profileId: "", workspaceIds: [] }, {}, NOW));
  });

  test("URL: filtros inválidos são descartados", () => {
    const parsed = parseCompanySearchParams(
      new URLSearchParams("q=padaria&uf=pr,XX,sc&cityIbge=4118501,abc&cnae=4930-2/02,999&hq=matriz&page=2&limit=500&facets=1")
    );
    assert.deepEqual(parsed.filters.stateCodes, ["PR", "SC"]);
    assert.deepEqual(parsed.filters.cityIbges, ["4118501"]);
    assert.deepEqual(parsed.filters.primaryCnaes, ["4930202"]);
    assert.equal(parsed.filters.headquarters, "matriz");
    assert.equal(parsed.limit, 50);
    assert.equal(parsed.offset, 50);
    assert.equal(parsed.facets, true);
  });

  test("facetas e acertos são mapeados da resposta do mecanismo", async () => {
    const client = createMeiliClient({
      url: "http://meili.test",
      apiKey: "k",
      fetchImpl: (async () =>
        Response.json({
          hits: [{ id: "12345678000195", cnpj: "12345678000195", legalName: "Transportes Silva", city: "Pato Branco", stateCode: "PR", sourceFetchedAt: NOW }],
          estimatedTotalHits: 1,
          facetDistribution: { stateCode: { PR: 1 }, city: { "Pato Branco": 1 } },
          processingTimeMs: 1
        })) as typeof fetch
    });
    const response = await index.searchCompanyIndex(client, "idx", { q: "transportes", scope: { profileId: "p1", workspaceIds: [] }, facets: true, nowEpoch: NOW });
    assert.equal(response.hits[0].legalName, "Transportes Silva");
    assert.equal(response.hits[0].sourceFetchedAt, new Date(NOW * 1000).toISOString());
    assert.deepEqual(response.facets.stateCode, { PR: 1 });
    assert.equal(response.engine, "meilisearch");
  });
});

// ---------------------------------------------------------------------------
// Cliente do mecanismo e fallback
// ---------------------------------------------------------------------------
describe("cliente e fallback", () => {
  test("erros HTTP são classificados", async () => {
    resetSearchEngineCircuitBreakers();
    const make = (status: number) =>
      createMeiliClient({
        url: `http://meili-${status}.test`,
        apiKey: "k",
        fetchImpl: (async () => Response.json({ message: "x", code: "c" }, { status })) as typeof fetch
      });
    await assert.rejects(make(401).request("/x"), (error: unknown) => isSearchEngineError(error) && error.kind === "auth");
    await assert.rejects(make(404).request("/x"), (error: unknown) => isSearchEngineError(error) && error.kind === "not_found");
    await assert.rejects(make(400).request("/x"), (error: unknown) => isSearchEngineError(error) && error.kind === "invalid_request");
    await assert.rejects(make(503).request("/x"), (error: unknown) => isSearchEngineError(error) && error.kind === "unavailable");
  });

  test("timeout vira erro tipado", async () => {
    resetSearchEngineCircuitBreakers();
    const client = createMeiliClient({
      url: "http://slow.test",
      apiKey: "k",
      timeoutMs: 30,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch
    });
    await assert.rejects(client.request("/x"), (error: unknown) => isSearchEngineError(error) && error.kind === "timeout");
  });

  test("disjuntor: após 3 falhas não chama mais a rede por 30 s", async () => {
    resetSearchEngineCircuitBreakers();
    let calls = 0;
    let clock = 1_000_000;
    const client = createMeiliClient({
      url: "http://down.test",
      apiKey: "k",
      now: () => clock,
      fetchImpl: (async () => {
        calls += 1;
        throw new TypeError("ECONNREFUSED");
      }) as typeof fetch
    });
    for (let attempt = 0; attempt < 3; attempt += 1) await assert.rejects(client.request("/x"));
    await assert.rejects(client.request("/x"), (error: unknown) => isSearchEngineError(error) && error.kind === "circuit_open");
    assert.equal(calls, 3);
    clock += 31_000;
    await assert.rejects(client.request("/x"), (error: unknown) => isSearchEngineError(error) && error.kind === "unavailable");
    assert.equal(calls, 4);
  });

  const fallbackResponse = {
    engine: "database" as const,
    degraded: true,
    hits: [],
    totalHits: 0,
    totalIsEstimate: false,
    facets: {},
    processingTimeMs: 1,
    query: "",
    appliedFilter: null
  };

  test("mecanismo fora do ar → fallback no banco, sem derrubar a busca", async () => {
    resetSearchEngineCircuitBreakers();
    const failing = createMeiliClient({
      url: "http://fail.test",
      apiKey: "k",
      fetchImpl: (async () => {
        throw new TypeError("ECONNREFUSED");
      }) as typeof fetch
    });
    let fallbackQuery = "";
    const result = await searchCompanies(
      { profileId: "p1", q: "transportadoras pato brnaco" },
      {
        client: failing,
        engineEnabled: true,
        loadWorkspaces: async () => [],
        fallback: async (input) => {
          fallbackQuery = input.q;
          return fallbackResponse;
        }
      }
    );
    assert.equal(result.engine, "database");
    assert.equal(result.fallbackReason, "unavailable");
    assert.equal(fallbackQuery, "transportadoras pato brnaco");
    // A sugestão de busca nova (Casa dos Dados) continua disponível.
    assert.ok(result.discovery?.href.includes("uf=PR"));
    assert.ok(result.discovery?.href.includes("cnae=4930"));
  });

  test("mecanismo desligado → banco direto", async () => {
    const result = await searchCompanies(
      { profileId: "p1", q: "padaria" },
      { engineEnabled: false, loadWorkspaces: async () => [], fallback: async () => fallbackResponse }
    );
    assert.equal(result.fallbackReason, "not_configured");
  });

  test("índice E banco fora do ar → erro tratável com mensagem sobre a Casa dos Dados", async () => {
    await assert.rejects(
      searchCompanies(
        { profileId: "p1", q: "padaria" },
        {
          engineEnabled: false,
          loadWorkspaces: async () => {
            throw new Error("db down");
          },
          fallback: async () => {
            throw new Error("db down");
          }
        }
      ),
      (error: unknown) => error instanceof CompanySearchUnavailableError && /Casa dos Dados/.test(error.message)
    );
  });

  test("erro inesperado (não do mecanismo) não é mascarado", async () => {
    await assert.rejects(
      searchCompanies(
        { profileId: "p1", q: "padaria" },
        {
          engineEnabled: true,
          client: { request: async () => { throw new RangeError("bug"); } } as unknown as ReturnType<typeof createMeiliClient>,
          loadWorkspaces: async () => [],
          fallback: async () => fallbackResponse
        }
      ),
      RangeError
    );
  });

  test("SearchEngineError reconhecido estruturalmente", () => {
    const error = new SearchEngineError("timeout", "x");
    assert.equal(isSearchEngineError(error), true);
    const foreign = Object.assign(new Error("x"), { name: "SearchEngineError", kind: "timeout" });
    assert.equal(isSearchEngineError(foreign), true);
    assert.equal(isSearchEngineError(new Error("x")), false);
  });
});

// ---------------------------------------------------------------------------
// Sugestões, seletores e configuração
// ---------------------------------------------------------------------------
describe("sugestões e seletores", () => {
  test("sugestão de busca nova abre o formulário preenchido", () => {
    const suggestion = buildDiscoverySuggestion(interpretQuery("transportadoras pato brnaco"))!;
    assert.match(suggestion.label, /Pato Branco\/PR/);
    const url = new URL(suggestion.href, "http://x");
    assert.equal(url.pathname, "/dashboard/search");
    assert.equal(url.searchParams.get("uf"), "PR");
    assert.equal(url.searchParams.get("city"), "Pato Branco");
    const defaults = getSearchFilterDefaultsFromQuickSearch(Object.fromEntries(url.searchParams));
    assert.ok(defaults);
    assert.deepEqual(defaults!.defaultStateCodes, ["PR"]);
    assert.deepEqual(defaults!.defaultCitySelections, [{ cityName: "Pato Branco", stateCode: "PR" }]);
    assert.ok(defaults!.defaultCnaes.every((code) => code.startsWith("4930")));
  });

  test("sem atividade reconhecida, não sugere busca nova", () => {
    assert.equal(buildDiscoverySuggestion(interpretQuery("joao zanella")), null);
  });

  test("pré-preenchimento ignora valores inválidos", () => {
    assert.equal(getSearchFilterDefaultsFromQuickSearch({ cnae: "abc", uf: "PRR" }), null);
  });

  test("seletor de cidades aceita erro de digitação só quando a busca exata falha", () => {
    const cities = [{ cityName: "Pato Branco" }, { cityName: "Palmas" }, { cityName: "Curitiba" }];
    assert.deepEqual(fuzzyFilterByName(cities, "pato brnaco", 5), [{ cityName: "Pato Branco" }]);
    assert.deepEqual(fuzzyFilterByName(cities, "curitba", 5), [{ cityName: "Curitiba" }]);
    assert.deepEqual(fuzzyFilterByName(cities, "xy", 5), []);
  });

  test("seletor de CNAE: 'trasnportadora' encontra transporte com rótulo oficial", async () => {
    const options = await fuzzyCnaeOptions("trasnportadora", 5);
    assert.ok(options.length > 0);
    assert.ok(options[0].value.startsWith("4930"));
    assert.match(options[0].label, /^4930-2\/0\d · /);
  });

  test("índice de empresas só liga com URL, chave e flag explícita", () => {
    const saved = { ...process.env };
    process.env.MEILISEARCH_URL = "http://localhost:7700/";
    process.env.MEILISEARCH_ADMIN_KEY = "admin";
    delete process.env.MEILISEARCH_SEARCH_KEY;
    delete process.env.SEARCH_COMPANY_INDEX_ENABLED;
    assert.equal(isCompanySearchEngineEnabled(), false);
    process.env.SEARCH_COMPANY_INDEX_ENABLED = "true";
    assert.equal(isCompanySearchEngineEnabled(), true);
    const config = getSearchEngineConfig();
    assert.equal(config.url, "http://localhost:7700");
    assert.equal(config.searchKey, "admin");
    assert.equal(config.ttlDays, 90);
    process.env = saved;
  });

  test("rota de sincronização exige segredo forte e exato", () => {
    const secret = "s".repeat(32);
    const request = (value?: string) => new Request("http://x/api/search/sync", { headers: value ? { authorization: value } : {} });
    assert.equal(isAuthorizedSyncRequest(request(`Bearer ${secret}`), secret), true);
    assert.equal(isAuthorizedSyncRequest(request(`Bearer ${secret}x`), secret), false);
    assert.equal(isAuthorizedSyncRequest(request(), secret), false);
    assert.equal(isAuthorizedSyncRequest(request("Bearer short"), "short"), false);
  });
});

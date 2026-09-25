import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.CASA_DOS_DADOS_API_KEY = "test-key-secret";
process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";
process.env.CASA_DOS_DADOS_TIMEOUT_MS = "1000";
process.env.DISCOVERY_PAGE_SIZE = "50";
delete process.env.DISCOVERY_MAX_RESULTS;

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
const allUrls: string[] = [];
type Handler = (call: Call, index: number) => Promise<Response> | Response;
let handler: Handler = () => json({ total: 0, cnpjs: [] });

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const call: Call = { url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} };
  calls.push(call);
  allUrls.push(call.url);
  const index = calls.length - 1;
  if (init.signal) {
    return await new Promise<Response>((resolve, reject) => {
      init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
      Promise.resolve(handler(call, index)).then(resolve, reject);
    });
  }
  return handler(call, index);
};

const mod = await import("../lib/discovery/providers/casadosdados.ts");
const { searchWithCasaDosDados, fetchCasaDosDadosCompanyByCnpj, buildCasaDosDadosSearchBody, resolveCasaDosDadosPaging, isCasaDosDadosError } = mod;
const svc = await import("../lib/discovery/service.ts");

const base = { profileId: "p", cnae: "4781-4/00", stateCode: "", cityName: "" };
let cnpjSeq = 10000000000100;
function row(extra: Record<string, unknown> = {}) {
  cnpjSeq += 1;
  return { cnpj: String(cnpjSeq), razao_social: "EMPRESA " + cnpjSeq, endereco: { uf: "SP", municipio: "SAO PAULO" }, ...extra };
}
const detailOk = (call: Call) => json({ cnpj: call.url.split("/").pop(), contato_email: [{ email: "a@b.com" }], contato_telefonico: [{ completo: "11987654321" }] });

beforeEach(() => { calls = []; process.env.DISCOVERY_PAGE_SIZE = "50"; delete process.env.DISCOVERY_MAX_RESULTS; });

test("1. somente CNAE: corpo com CNAE normalizado e sem filtros vazios", () => {
  const body = buildCasaDosDadosSearchBody(base);
  assert.deepEqual(body, { codigo_atividade_principal: ["4781400"], incluir_atividade_secundaria: false, situacao_cadastral: ["ATIVA"] });
});

test("2/3. CNAE + UF + município: uf minúscula, município sem acento", () => {
  const body = buildCasaDosDadosSearchBody({ ...base, stateCode: " SP ", cityName: "  São   Paulo " });
  assert.deepEqual(body.uf, ["sp"]);
  assert.deepEqual(body.municipio, ["sao paulo"]);
});

test("CNAE inválido não é enviado", () => {
  assert.throws(() => buildCasaDosDadosSearchBody({ ...base, cnae: "123" }), (e: any) => isCasaDosDadosError(e) && e.kind === "invalid_request");
});

test("6. vários filtros simultâneos + porte inválido descartado", () => {
  const body = buildCasaDosDadosSearchBody({ ...base, stateCode: "RJ", requireEmail: true, mobileOnly: true, companySizes: ["Microempresa", "Pequeno porte", "xyz"], simplesOnly: true, capitalSocialMin: 1000, capitalSocialMax: null, activityStartYear: 2020, activityStartYearExact: true });
  assert.deepEqual(body.mais_filtros, { com_email: true, com_telefone: true, somente_celular: true });
  assert.deepEqual(body.porte_empresa, { codigos: ["01", "03"] });
  assert.deepEqual(body.simples, { optante: true });
  assert.deepEqual(body.capital_social, { minimo: 1000 });
  assert.deepEqual(body.data_abertura, { inicio: "2020-01-01", fim: "2020-12-31" });
});

test("4. consulta por CNPJ formatado vai à Casa dos Dados com CNPJ limpo, chave só no header", async () => {
  handler = detailOk;
  const d = await fetchCasaDosDadosCompanyByCnpj("12.345.678/0001-90");
  assert.equal(calls[0].url, "https://api.casadosdados.com.br/v4/cnpj/12345678000190");
  assert.equal(calls[0].headers["api-key"], "test-key-secret");
  assert.ok(!calls[0].url.includes("test-key"));
  assert.equal(d.normalized?.email, "a@b.com");
});

test("7. busca sem resultados: 1 chamada, sem consultas detalhadas", async () => {
  handler = () => json({ total: 0, cnpjs: [] });
  const out = await searchWithCasaDosDados(base);
  assert.equal(out.normalized.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(out.providerTotalResults, 0);
});

test("8. paginação: pagina 1..3, limite fixo, sem duplicidade entre páginas", async () => {
  const pages = [Array.from({ length: 50 }, () => row()), Array.from({ length: 50 }, () => row()), Array.from({ length: 20 }, () => row())];
  pages[1][0] = { ...pages[0][0] }; // duplicado entre páginas
  handler = (call) => call.method === "POST" ? json({ total: 120, cnpjs: pages[call.body.pagina - 1] ?? [] }) : detailOk(call);
  const out = await searchWithCasaDosDados({ ...base, stateCode: "SP" });
  const posts = calls.filter((c) => c.method === "POST");
  // o duplicado deixa 119 únicos < total 120: a API é consultada até retornar página vazia (4)
  assert.deepEqual(posts.map((c) => c.body.pagina), [1, 2, 3, 4]);
  assert.ok(posts.every((c) => c.body.limite === 50));
  assert.equal(new Set(out.normalized.map((r) => r.cnpj)).size, out.normalized.length);
  assert.equal(out.normalized.length, 119);
  assert.equal(out.hitFetchLimit, false);
});

test("teto de resultados: DISCOVERY_MAX_RESULTS=30 reduz limite e sinaliza hitFetchLimit", async () => {
  process.env.DISCOVERY_MAX_RESULTS = "30";
  handler = (call) => call.method === "POST" ? json({ total: 500, cnpjs: Array.from({ length: call.body.limite }, () => row()) }) : detailOk(call);
  const out = await searchWithCasaDosDados(base);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(calls[0].body.limite, 30);
  assert.equal(out.normalized.length, 30);
  assert.equal(out.hitFetchLimit, true);
});

test("sem DISCOVERY_MAX_RESULTS aplica teto de segurança (não carrega a base inteira)", () => {
  const p = resolveCasaDosDadosPaging();
  assert.equal(p.maxResults, 1000);
  assert.equal(p.maxPages, 20);
});

test("página repetida pela API encerra a paginação (sem loop infinito)", async () => {
  const same = Array.from({ length: 50 }, () => row());
  handler = (call) => call.method === "POST" ? json({ cnpjs: same }) : detailOk(call);
  await searchWithCasaDosDados(base);
  assert.equal(calls.filter((c) => c.method === "POST").length, 2);
});

test("9. troca de filtros gera chave de cache diferente; mesma busca gera a mesma", () => {
  const a = svc.buildProviderCacheKey({ ...base, stateCode: "SP", cityName: "Campinas" });
  const a2 = svc.buildProviderCacheKey({ ...base, stateCode: "sp", cityName: "campinas", companySizes: [] });
  const b = svc.buildProviderCacheKey({ ...base, stateCode: "SP", cityName: "Santos" });
  const c = svc.buildProviderCacheKey({ ...base, stateCode: "SP", cityName: "Campinas", requireEmail: true });
  assert.equal(a, a2);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("10. API indisponível (503): 2 retries e erro 'unavailable'", async () => {
  handler = () => new Response("boom interno", { status: 503 });
  await assert.rejects(searchWithCasaDosDados(base), (e: any) => e.kind === "unavailable" && !String(e.message).includes("boom"));
  assert.equal(calls.length, 3);
});

test("401: sem retry, erro 'auth'", async () => {
  handler = () => new Response("", { status: 401 });
  await assert.rejects(searchWithCasaDosDados(base), (e: any) => e.kind === "auth");
  assert.equal(calls.length, 1);
});

test("11. timeout: aborta e faz no máximo 1 nova tentativa", async () => {
  handler = () => new Promise<Response>(() => {});
  await assert.rejects(searchWithCasaDosDados(base), (e: any) => e.kind === "timeout");
  assert.equal(calls.length, 2);
});

test("12a. 429 sem Retry-After: falha imediata sem retry", async () => {
  handler = () => new Response("", { status: 429 });
  await assert.rejects(searchWithCasaDosDados(base), (e: any) => e.kind === "rate_limit");
  assert.equal(calls.length, 1);
});

test("12b. 429 com Retry-After curto: uma única nova tentativa", async () => {
  handler = (_c, i) => i === 0 ? new Response("", { status: 429, headers: { "retry-after": "0" } }) : json({ total: 0, cnpjs: [] });
  const out = await searchWithCasaDosDados(base);
  assert.equal(calls.length, 2);
  assert.equal(out.normalized.length, 0);
});

test("12c. 429 na consulta detalhada interrompe as demais (circuit breaker) sem derrubar a busca", async () => {
  const rows = Array.from({ length: 20 }, () => row());
  handler = (call) => call.method === "POST" ? json({ total: 20, cnpjs: rows }) : new Response("", { status: 429 });
  const out = await searchWithCasaDosDados(base);
  const gets = calls.filter((c) => c.method === "GET").length;
  assert.equal(out.normalized.length, 20);
  assert.ok(gets <= 4, `detalhes chamados: ${gets}`);
  assert.equal(out.detailIncomplete, true);
});

test("13. resposta inválida/vazia vira 'invalid_response'", async () => {
  handler = () => new Response("<html>", { status: 200 });
  await assert.rejects(searchWithCasaDosDados(base), (e: any) => e.kind === "invalid_response");
  calls = [];
  handler = () => new Response("", { status: 200 });
  await assert.rejects(searchWithCasaDosDados(base), (e: any) => e.kind === "invalid_response");
});

test("14. campos opcionais ausentes não quebram a normalização", async () => {
  handler = (call) => call.method === "POST" ? json({ total: 1, cnpjs: [{ cnpj: "11222333000181" }, { razao_social: "sem cnpj" }] }) : json({ cnpj: "11222333000181" });
  const out = await searchWithCasaDosDados(base);
  assert.equal(out.normalized.length, 1);
  assert.equal(out.normalized[0].companyName, "Sem razão social");
  assert.equal(out.normalized[0].email ?? null, null);
});

test("15. consultas detalhadas idênticas: cache em memória + dedupe de concorrentes", async () => {
  handler = detailOk;
  await Promise.all([fetchCasaDosDadosCompanyByCnpj("99888777000166"), fetchCasaDosDadosCompanyByCnpj("99.888.777/0001-66")]);
  await fetchCasaDosDadosCompanyByCnpj("99888777000166");
  assert.equal(calls.length, 1);
});

test("contatos vêm da consulta detalhada da Casa dos Dados", async () => {
  handler = (call) => call.method === "POST" ? json({ total: 1, cnpjs: [row()] }) : detailOk(call);
  const out = await searchWithCasaDosDados(base);
  assert.equal(out.normalized[0].email, "a@b.com");
  assert.ok(out.normalized[0].phone);
  const payload = out.normalized[0].providerPayload as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ["casadosdados_detalhe", "casadosdados_detalhe_em", "casadosdados_pesquisa"]);
  assert.ok(!Number.isNaN(Date.parse(String(payload.casadosdados_detalhe_em))), "instante da consulta detalhada registrado");
});

test("detalhe já salvo e recente é reaproveitado: nenhuma chamada GET /v4/cnpj", async () => {
  const searchRow = row();
  const storedAt = new Date(Date.now() - 60_000).toISOString();
  handler = (call) => call.method === "POST" ? json({ total: 1, cnpjs: [searchRow] }) : detailOk(call);
  const lookedUp: string[][] = [];
  const out = await searchWithCasaDosDados(base, {
    storedDetails: async (cnpjs) => {
      lookedUp.push(cnpjs);
      return new Map([[String(searchRow.cnpj), { raw: { cnpj: searchRow.cnpj, contato_email: [{ email: "salvo@x.com" }] }, fetchedAt: storedAt }]]);
    }
  });
  assert.equal(calls.filter((c) => c.method === "GET").length, 0, "não deve consultar o detalhe de novo");
  assert.deepEqual(lookedUp, [[String(searchRow.cnpj)]]);
  assert.equal(out.normalized[0].email, "salvo@x.com");
  assert.equal(out.detailReused, 1);
  assert.equal(out.detailRequests, 0);
  const payload = out.normalized[0].providerPayload as Record<string, unknown>;
  assert.equal(payload.casadosdados_detalhe_em, storedAt, "preserva o instante original (não renova o prazo)");
});

test("falha no reuso do banco não derruba a pesquisa: cai para a consulta detalhada", async () => {
  handler = (call) => call.method === "POST" ? json({ total: 1, cnpjs: [row()] }) : detailOk(call);
  const out = await searchWithCasaDosDados(base, { storedDetails: async () => { throw new Error("db down"); } });
  assert.equal(calls.filter((c) => c.method === "GET").length, 1);
  assert.equal(out.normalized[0].email, "a@b.com");
  assert.equal(out.detailReused, 0);
});

test("18. nenhuma chamada fora da Casa dos Dados em todos os cenários", () => {
  assert.ok(allUrls.length > 50);
  assert.ok(allUrls.every((u) => u.startsWith("https://api.casadosdados.com.br/")), "URL inesperada");
  assert.ok(!allUrls.some((u) => /cnpj\.ws/i.test(u)));
});

process.on("exit", () => {
  // noop
});

const isAborted = (error: unknown) => (error as { kind?: string })?.kind === "aborted";

test("cancelamento: sinal já abortado não dispara nenhuma chamada", async () => {
  const controller = new AbortController();
  controller.abort();
  handler = () => json({ total: 1, cnpjs: [row()] });
  await assert.rejects(searchWithCasaDosDados(base, { signal: controller.signal }), isAborted);
  assert.equal(calls.length, 0);
});

test("cancelamento: requisição em andamento é abortada e não é repetida", async () => {
  const controller = new AbortController();
  handler = () => {
    setTimeout(() => controller.abort(), 5);
    return new Promise<Response>(() => {});
  };
  const started = Date.now();
  await assert.rejects(searchWithCasaDosDados(base, { signal: controller.signal }), isAborted);
  assert.equal(calls.length, 1);
  assert.ok(Date.now() - started < 900, "não pode esperar o timeout");
});

test("cancelamento: interrompe o backoff de retry (503) sem nova tentativa", async () => {
  const controller = new AbortController();
  handler = () => {
    setTimeout(() => controller.abort(), 5);
    return new Response("", { status: 503 });
  };
  await assert.rejects(searchWithCasaDosDados(base, { signal: controller.signal }), isAborted);
  assert.equal(calls.length, 1);
});

test("cancelamento: para a paginação e as consultas detalhadas", async () => {
  process.env.DISCOVERY_PAGE_SIZE = "2";
  const controller = new AbortController();
  handler = (call) => {
    if (call.method === "POST") {
      controller.abort();
      return json({ total: 10, cnpjs: [row(), row()] });
    }
    return detailOk(call);
  };
  await assert.rejects(searchWithCasaDosDados(base, { signal: controller.signal }), isAborted);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(calls.filter((c) => c.method === "GET").length, 0);
});

test("normalização central: telefone, CEP, UF, município e CNAE chegam limpos da Casa dos Dados", async () => {
  handler = (call) => call.method === "POST"
    ? json({ total: 1, cnpjs: [{
        cnpj: "33.000.167/0001-01",
        razao_social: "  “PADARIA  SAO JOAO LTDA” ​",
        nome_fantasia: "-",
        codigo_atividade_principal: 111301,
        endereco: { uf: "sp", municipio: "SANTA BARBARA D'OESTE", cep: 1001000, numero: "SN", bairro: "CENTRO ," }
      }] })
    : json({ cnpj: "33000167000101", contato_telefonico: [{ completo: "+55 (11) 98765-4321" }], contato_email: [{ email: " CONTATO@PADARIA.COM.BR " }] });
  const out = await searchWithCasaDosDados(base);
  const item = out.normalized[0];
  assert.equal(item.cnpj, "33000167000101");
  assert.equal(item.companyName, "PADARIA SAO JOAO LTDA");
  assert.equal(item.tradeName, null);
  assert.equal(item.primaryCnaeCode, "0111301");
  assert.equal(item.stateCode, "SP");
  assert.equal(item.cityName, "Santa Barbara d'Oeste");
  assert.equal(item.cep, "01001000");
  assert.equal(item.addressNumber, "S/N");
  assert.equal(item.neighborhood, "CENTRO");
  assert.equal(item.phone, "(11) 98765-4321");
  assert.equal(item.email, "contato@padaria.com.br");
});

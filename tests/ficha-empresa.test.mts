import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Ficha da empresa sem CNPJ.ws: somente Casa dos Dados, payload legado higienizado,
 * nenhuma requisição fora da Casa dos Dados ao abrir a ficha.
 */
process.env.CASA_DOS_DADOS_API_KEY = "test-key-secret";
process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";
process.env.CASA_DOS_DADOS_TIMEOUT_MS = "1000";

type Handler = (url: string) => Response | Promise<Response>;
let requested: string[] = [];
let handler: Handler = () => new Response("{}", { status: 404 });

(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  requested.push(String(url));
  return handler(String(url));
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const { sanitizeProviderPayload, hasLegacyProviderData, withSanitizedProviderPayload } = await import("../lib/provider-payload.ts");
const { buildDisplayEstablishment, getEstablishmentPayload } = await import("../lib/establishment-presenter.ts");
const { buildEstablishmentDetailSections } = await import("../lib/establishment-detail-sections.ts");
const { resolveCompanyProfile, needsDetailedRefresh } = await import("../lib/company-profile.ts");
const { fetchCasaDosDadosCompanyByCnpj } = await import("../lib/discovery/providers/casadosdados.ts");
const { companySummaryFromSearchRow } = await import("../lib/company-model.ts");

const LEGACY_MESSAGE =
  "A busca principal na Casa dos Dados foi concluída. O enriquecimento complementar da CNPJ.ws não pôde ser concluído.";

function legacyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "est-1",
    cnpj: "11222333000181",
    company_name: "EMPRESA LEGADA LTDA",
    trade_name: null,
    registration_status: "ATIVA",
    opened_at: "2015-03-10",
    primary_cnae_code: "4781400",
    primary_cnae_description: "Comércio varejista de artigos do vestuário",
    state_code: "SP",
    city_name: "São Paulo",
    cep: "01310100",
    address_line: "Avenida Paulista",
    email: "antigo@legado.example",
    phone: "(11) 3333-4444",
    legal_nature_description: "Sociedade Empresária Limitada",
    simples_opt_in: true,
    provider_payload: {
      casadosdados_pesquisa: { cnpj: "11222333000181", razao_social: "EMPRESA LEGADA LTDA" },
      casadosdados_detalhe: null,
      cnpjws_consulta: {
        estabelecimento: { email: "antigo@legado.example", telefone1: "33334444", atividade_secundaria: [{ id: "9999999" }] },
        simples: { simples: "Sim", mei: "Não" }
      },
      erro_enriquecimento_cnpjws: LEGACY_MESSAGE,
      erro_enriquecimento_casadosdados: null
    },
    ...overrides
  };
}

beforeEach(() => {
  requested = [];
  handler = () => new Response("{}", { status: 404 });
});

test("higienização remove blocos legados (inclusive aninhados) sem alterar o original", () => {
  const original = {
    casadosdados_pesquisa: { cnpjws_consulta: { a: 1 }, razao_social: "X" },
    cnpjws_consulta: { estabelecimento: {} },
    erro_enriquecimento_cnpjws: LEGACY_MESSAGE,
    lista: [{ erro_enriquecimento_casadosdados: "x", ok: true }]
  };
  const clean = sanitizeProviderPayload(original);
  assert.deepEqual(clean, { casadosdados_pesquisa: { razao_social: "X" }, lista: [{ ok: true }] });
  assert.ok("cnpjws_consulta" in original, "não pode mutar o valor original");
  assert.equal(hasLegacyProviderData(original), true);
  assert.equal(hasLegacyProviderData(clean), false);
  assert.equal(withSanitizedProviderPayload(null), null);
});

test("presenter não lê mais caminhos da CNPJ.ws (campos só existentes nela ficam vazios)", () => {
  const display = buildDisplayEstablishment({
    cnpj: "11222333000181",
    company_name: "X",
    provider_payload: {
      cnpjws_consulta: { estabelecimento: { email: "so-no-legado@x.com", atividade_secundaria: [{ id: "1" }] }, simples: { mei: "Sim" } }
    }
  });
  assert.equal(display.email, null);
  assert.equal(display.secondary_cnaes, null);
  assert.equal(display.mei_opt_in, null);
  assert.equal(JSON.stringify(display.provider_payload).includes("cnpjws"), false);
  assert.equal(JSON.stringify(getEstablishmentPayload(display) ?? {}).includes("cnpjws"), false);
});

test("ficha não exibe mensagem nem campos do enriquecimento CNPJ.ws", () => {
  const display = buildDisplayEstablishment(legacyRow());
  const payload = getEstablishmentPayload(display);
  const { primaryFields } = buildEstablishmentDetailSections(display, payload);
  const serialized = JSON.stringify(primaryFields);
  assert.equal(serialized.includes("CNPJ.ws"), false);
  assert.equal(/cnpjws/i.test(serialized), false);
  assert.equal(serialized.includes("enriquecimento complementar"), false);
  assert.equal(JSON.stringify(payload).includes("cnpjws"), false);
});

test("abrir ficha legada revalida só na Casa dos Dados e substitui campos que vinham da fonte removida", async () => {
  handler = (url) =>
    json({
      cnpj: url.split("/").pop(),
      razao_social: "EMPRESA LEGADA LTDA",
      situacao_cadastral: { situacao_atual: "ATIVA" },
      endereco: { uf: "SP", municipio: "SAO PAULO", cep: "01310100", logradouro: "PAULISTA", ibge: { latitude: -23.55, longitude: -46.63 } },
      contato_telefonico: [{ completo: "11987654321" }]
    });

  const result = await resolveCompanyProfile(legacyRow() as never, fetchCasaDosDadosCompanyByCnpj);

  assert.equal(result.refreshed, true);
  assert.equal(result.pendingRevalidation, false);
  assert.equal(requested.length, 1);
  assert.ok(requested.every((url) => url.startsWith("https://api.casadosdados.com.br/")));
  assert.ok(!requested.some((url) => /cnpj\.ws/i.test(url)));
  // E-mail antigo (só existia na CNPJ.ws) não é mantido; telefone passa a ser o da Casa dos Dados.
  assert.equal(result.company.email, null);
  // Telefone canônico (lib/data-quality): DDD + máscara brasileira.
  assert.equal(result.company.phone, "(11) 98765-4321");
  assert.equal(result.company.simples_opt_in, null);
  // Campos da pesquisa da Casa dos Dados são preservados quando o detalhe não os traz.
  assert.equal(result.company.primary_cnae_code, "4781400");
  assert.ok(result.updatePayload);
  assert.equal(hasLegacyProviderData(result.updatePayload!.provider_payload), false);
});

test("falha na Casa dos Dados: ficha segue com dados salvos, sem conteúdo legado e sem outra fonte", async () => {
  handler = () => new Response("", { status: 401 });
  const errors: unknown[] = [];
  const result = await resolveCompanyProfile(legacyRow({ cnpj: "99888777000166" }) as never, fetchCasaDosDadosCompanyByCnpj, (error) =>
    errors.push(error)
  );
  assert.equal(result.refreshed, false);
  assert.equal(result.pendingRevalidation, true);
  assert.equal(result.updatePayload, null);
  assert.equal(errors.length, 1);
  assert.equal(hasLegacyProviderData(result.company.provider_payload), false);
  assert.ok(requested.every((url) => url.startsWith("https://api.casadosdados.com.br/")));
});

test("ficha completa sem legado não faz nenhuma requisição externa", async () => {
  const row = legacyRow({ provider_payload: { casadosdados_detalhe: { cnpj: "1" } } });
  assert.equal(needsDetailedRefresh(row as never), false);
  const result = await resolveCompanyProfile(row as never, fetchCasaDosDadosCompanyByCnpj);
  assert.equal(requested.length, 0);
  assert.equal(result.updatePayload, null);
});

test("modelo normalizado (lista/mapa) usa nome fantasia quando existe e payload higienizado", () => {
  const summary = companySummaryFromSearchRow({
    establishments: { ...legacyRow(), trade_name: "Loja Legal" },
    provider_payload: { cnpjws_consulta: { x: 1 } }
  });
  assert.ok(summary);
  assert.equal(summary!.displayName, "Loja Legal");
  assert.equal(summary!.legalName, "EMPRESA LEGADA LTDA");
  assert.equal(summary!.stateCode, "SP");
  assert.equal(JSON.stringify(summary!.payload).includes("cnpjws"), false);
  assert.equal(companySummaryFromSearchRow({ establishments: null }), null);
});

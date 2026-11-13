/**
 * Fase 8 — prospects manuais, WhatsApp e mensagens (unidade, sem rede e sem banco).
 * Imports dinâmicos: no Node 24 os imports estáticos de .ts a partir de .mts não
 * expõem os nomes exportados (ver docs/CRM.md › Testes).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { normalizeWhatsappNumber, buildWhatsappUrl, firstWhatsappNumber } = await import("../lib/whatsapp.ts");
const { renderTemplate, findUnresolvedVariables, findInvalidBraces, validateTemplate, DEFAULT_TEMPLATES } = await import("../lib/crm/templates.ts");
const { isValidCpf, maskCpf, parseDocument, parseProspectInput, parseDealFields, duplicateKeys, parseTags } = await import("../lib/crm/prospects.ts");
const { describeActivity } = await import("../lib/crm/timeline.ts");
const { summarizePipeline } = await import("../lib/crm/metrics.ts");
const { isKnownCrmDetail } = await import("../lib/crm/messages.ts");

const form = (values: Record<string, string>) => (key: string) => values[key] ?? null;

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

describe("normalização de telefone para WhatsApp", () => {
  test("celular brasileiro com máscara ganha o DDI 55", () => {
    const number = normalizeWhatsappNumber("(41) 99999-8888");
    assert.equal(number.ok, true);
    assert.equal(number.ok && number.digits, "5541999998888");
    assert.equal(number.ok && number.isMobile, true);
    assert.equal(buildWhatsappUrl("(41) 99999-8888"), "https://wa.me/5541999998888");
  });

  test("variações do mesmo número brasileiro geram o mesmo link", () => {
    const variants = ["+55 41 99999-8888", "55 (41) 99999 8888", "041 99999-8888", "0 15 41 99999-8888", "+55 (41) 9.9999-8888"];
    for (const value of variants) assert.equal(buildWhatsappUrl(value), "https://wa.me/5541999998888", value);
  });

  test("fixo brasileiro válido (WhatsApp Business) é aceito e marcado como fixo", () => {
    const number = normalizeWhatsappNumber("(11) 3333-4444");
    assert.equal(number.ok && number.digits, "551133334444");
    assert.equal(number.ok && number.isMobile, false);
  });

  test("internacional com + é aceito sem acrescentar 55", () => {
    assert.equal(buildWhatsappUrl("+1 (415) 555-2671"), "https://wa.me/14155552671");
    assert.equal(buildWhatsappUrl("+351 912 345 678"), "https://wa.me/351912345678");
    assert.equal(buildWhatsappUrl("00351 912 345 678"), "https://wa.me/351912345678");
  });

  test("nunca chuta o DDI 55 para números que não são brasileiros", () => {
    const portugalSemMais = normalizeWhatsappNumber("351912345678");
    assert.equal(portugalSemMais.ok, false);
    assert.equal(!portugalSemMais.ok && portugalSemMais.reason, "needs_country_code");
    assert.equal(buildWhatsappUrl("351912345678"), null);
  });

  test("bloqueia números inválidos, 0800, DDD inexistente, celular sem 9 e texto", () => {
    for (const value of ["", "   ", "123", "(20) 99999-8888", "(41) 89999-8888", "0800 123 4567", "+0 12345678", "+12", "ligar 41 99999-8888", "41 99999-8888 ramal 2", "+55 41 9999", "1111111111"]) {
      assert.equal(buildWhatsappUrl(value), null, `deveria bloquear: ${value}`);
    }
    assert.equal(buildWhatsappUrl(null), null);
    assert.equal(buildWhatsappUrl(undefined), null);
  });

  test("mensagem é codificada na URL e vazia abre sem texto", () => {
    const url = buildWhatsappUrl("41999998888", "Olá, Ana! Tudo bem?\nProposta & valores: 100% #1");
    assert.equal(url, `https://wa.me/5541999998888?text=${encodeURIComponent("Olá, Ana! Tudo bem?\nProposta & valores: 100% #1")}`);
    assert.ok(!url!.includes(" "));
    assert.equal(buildWhatsappUrl("41999998888", "   "), "https://wa.me/5541999998888");
    assert.equal(buildWhatsappUrl("41999998888", null), "https://wa.me/5541999998888");
  });

  test("não altera o valor original (normalização só na leitura)", () => {
    const original = "(41) 99999-8888";
    normalizeWhatsappNumber(original);
    assert.equal(original, "(41) 99999-8888");
  });

  test("campos com vários telefones: escolhe o celular válido", () => {
    assert.equal(firstWhatsappNumber("(11) 3333-4444 / (11) 98888-7777")?.number.ok && firstWhatsappNumber("(11) 3333-4444 / (11) 98888-7777")?.raw, "(11) 98888-7777");
    assert.equal(firstWhatsappNumber("(11) 3333-4444; inválido")?.raw, "(11) 3333-4444");
    assert.equal(firstWhatsappNumber(null, "", "abc"), null);
    assert.equal(firstWhatsappNumber(null, "41 99999-8888")?.raw, "41 99999-8888");
  });
});

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

describe("modelos de mensagem", () => {
  test("substitui variáveis pelos dados reais", () => {
    const [first] = DEFAULT_TEMPLATES;
    const { text, missing } = renderTemplate(first.body, { nome_contato: "Ana", nome_usuario: "Tiago", nome_empresa: "Padaria Sol" });
    assert.equal(text, "Olá, Ana! Tudo bem?\nMeu nome é Tiago. Gostaria de apresentar uma solução que pode ajudar a Padaria Sol.\nPodemos conversar?");
    assert.deepEqual(missing, []);
  });

  test("sem dado, nunca deixa placeholder e ajusta a pontuação", () => {
    for (const template of DEFAULT_TEMPLATES) {
      const { text, missing } = renderTemplate(template.body, {});
      assert.deepEqual(findUnresolvedVariables(text), [], template.name);
      assert.ok(!/[{}]/.test(text), template.name);
      assert.ok(!/ ,|,!|, !|\s{2}/.test(text), `${template.name}: ${text}`);
      assert.ok(missing.length > 0);
    }
    assert.equal(renderTemplate("Olá, {nome_contato}! Tudo bem?", {}).text, "Olá! Tudo bem?");
    assert.equal(renderTemplate("Proposta para {nome_empresa}.", {}).text, "Proposta para sua empresa.");
  });

  test("valores com chaves ou quebras não reintroduzem variáveis", () => {
    const { text } = renderTemplate("Olá, {nome_contato}!", { nome_contato: "{nome_empresa}\nX" });
    assert.equal(text, "Olá, nome_empresa X!");
    assert.deepEqual(findUnresolvedVariables(text), []);
  });

  test("variável desconhecida é preservada e recusada ao salvar o modelo", () => {
    assert.equal(renderTemplate("Oi {apelido}", {}).text, "Oi {apelido}");
    const invalid = validateTemplate({ name: "Teste", body: "Oi {apelido}" });
    assert.equal(invalid.ok, false);
    assert.ok(!invalid.ok && isKnownCrmDetail(invalid.error));
    assert.equal(validateTemplate({ name: " ", body: "x" }).ok, false);
    assert.equal(validateTemplate({ name: "Ok", body: "Olá, {nome_contato}" }).ok, true);
  });

  test("placeholders malformados (maiúsculas, espaços, hífen, chave solta) são recusados e bloqueiam o envio", () => {
    for (const body of ["Oi {NomeContato}", "Oi {nome contato}", "Oi {apelido-extra}", "Oi {}", "Oi {nome_contato", "Oi nome_contato}"]) {
      assert.equal(validateTemplate({ name: "x", body }).ok, false, body);
      assert.ok(findInvalidBraces(body).length > 0, body);
    }
    assert.deepEqual(findInvalidBraces("Olá, { nome_contato }! Tudo bem?"), []);
    assert.deepEqual(findInvalidBraces("Olá, Ana! Sem variáveis."), []);
  });
});

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

describe("cadastro manual de prospect", () => {
  test("CPF: valida dígitos e mascara para listas", () => {
    assert.equal(isValidCpf("529.982.247-25"), true);
    assert.equal(isValidCpf("529.982.247-24"), false);
    assert.equal(isValidCpf("111.111.111-11"), false);
    assert.equal(maskCpf("52998224725"), "***.982.247-**");
  });

  test("documento é opcional; quando informado precisa ser válido para o tipo", () => {
    assert.deepEqual(parseDocument("company", ""), { ok: true, type: null, value: null });
    assert.deepEqual(parseDocument("company", "11.222.333/0001-81"), { ok: true, type: "cnpj", value: "11222333000181" });
    assert.equal(parseDocument("company", "11.222.333/0001-80").ok, false);
    assert.deepEqual(parseDocument("person", "529.982.247-25"), { ok: true, type: "cpf", value: "52998224725" });
    assert.equal(parseDocument("person", "11.222.333/0001-81").ok, false);
  });

  test("prospect sem CNPJ: só o nome é obrigatório", () => {
    const parsed = parseProspectInput(form({ kind: "company", name: "  Oficina do Zé  " }));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.prospect.name, "Oficina do Zé");
    assert.equal(parsed.prospect.document, null);
    assert.equal(parsed.prospect.origin, "manual");
    assert.deepEqual(parsed.prospect.tags, []);
  });

  test("pessoa física descarta campos de empresa e valida CPF", () => {
    const parsed = parseProspectInput(form({ kind: "person", name: "Maria Souza", tradeName: "ignorado", document: "52998224725", origin: "referral" }));
    assert.equal(parsed.ok && parsed.prospect.tradeName, null);
    assert.equal(parsed.ok && parsed.prospect.documentType, "cpf");
    assert.equal(parsed.ok && parsed.prospect.origin, "referral");
  });

  test("rejeita entradas inválidas com mensagens conhecidas", () => {
    const cases: Array<Record<string, string>> = [
      { kind: "company", name: "" },
      { kind: "company", name: "X", document: "123" },
      { kind: "company", name: "X", origin: "hack" },
      { kind: "company", name: "X", stateCode: "ZZ" },
      { kind: "company", name: "X", phone: "ligue já" },
      { kind: "company", name: "X", whatsapp: "351912345678" },
      { kind: "company", name: "X", email: "nao-e-email" },
      { kind: "company", name: "X", website: "não é site" }
    ];
    for (const values of cases) {
      const parsed = parseProspectInput(form(values));
      assert.equal(parsed.ok, false, JSON.stringify(values));
      assert.ok(!parsed.ok && isKnownCrmDetail(parsed.error), !parsed.ok ? parsed.error : "");
    }
  });

  test("telefones guardados como digitados; tags sem duplicatas", () => {
    const parsed = parseProspectInput(form({ kind: "company", name: "X", whatsapp: "(41) 99999-8888", phone: "+1 415 555 2671", tags: "sul, Sul , sul, evento" }));
    assert.equal(parsed.ok && parsed.prospect.whatsapp, "(41) 99999-8888");
    assert.equal(parsed.ok && parsed.prospect.phone, "+1 415 555 2671");
    assert.deepEqual(parseTags("sul, Sul , sul, evento"), ["sul", "Sul", "evento"]);
  });

  test("gestão comercial: valor, datas e prioridade", () => {
    const ok = parseDealFields(form({ amount: "12.500,90", expectedCloseDate: "2026-12-20", nextContactAt: "2026-11-20T10:00", priority: "high" }));
    assert.equal(ok.ok && ok.deal.amountCents, 1250090);
    assert.equal(ok.ok && ok.deal.nextContactAt, "2026-11-20T13:00:00.000Z");
    assert.equal(ok.ok && ok.deal.priority, "high");
    assert.equal(parseDealFields(form({ amount: "abc" })).ok, false);
    assert.equal(parseDealFields(form({ nextContactAt: "amanhã" })).ok, false);
    const fallback = parseDealFields(form({ priority: "urgentíssima" }));
    assert.equal(fallback.ok && fallback.deal.priority, "normal");
  });

  test("chaves de duplicidade: telefones equivalentes colidem, e-mail em minúsculas", () => {
    const a = duplicateKeys({ phones: ["(41) 99999-8888"], email: "Ana@Empresa.com" });
    const b = duplicateKeys({ phones: ["+55 41 99999 8888", "inválido"] });
    assert.deepEqual(a.phones, b.phones);
    assert.equal(a.email, "ana@empresa.com");
  });
});

// ---------------------------------------------------------------------------
// Histórico e indicadores
// ---------------------------------------------------------------------------

describe("histórico comercial e indicadores", () => {
  test("descreve interações registradas pelo usuário, sem afirmar entrega", () => {
    const text = describeActivity({ type: "interaction.logged", payload: { channel: "whatsapp", outcome: "done", occurredAt: "2026-11-13T15:00:00.000Z", summary: "Enviei a proposta" } });
    assert.match(text, /^Registrou contato: WhatsApp \(realizado\) · 13\/11\/2026, 12:00 — Enviei a proposta$/);
    assert.ok(!/entregue|lida|respondid/i.test(text));
    assert.equal(describeActivity({ type: "next_contact.scheduled", payload: { at: null } }), "Removeu o próximo contato agendado");
    // Troca de responsável: novo em "Responsável", anterior em "antes" (verificação do achado M7 da revisão).
    assert.equal(
      describeActivity({ type: "owner.changed", payload: { fromProfileId: "a", toProfileId: "b", from: "Ana", to: "Bruno" } }),
      "Responsável: Bruno (antes: Ana)"
    );
    assert.match(describeActivity({ type: "prospect.created", payload: { origin: "event", originDetail: "Feira X" } }), /origem: Evento \(Feira X\)/);
    assert.equal(describeActivity({ type: "prospect.updated", payload: { fields: ["phone", "tags"] } }), "Editou o cadastro: telefone, tags");
    assert.equal(describeActivity({ type: "deal.deleted", payload: { kind: "prospect" } }), "Negócio e cadastro manual do prospect removidos do CRM");
  });

  test("indicadores do pipeline", () => {
    const stages = [
      { id: "s1", name: "Novo", kind: "open" as const, position: 0 },
      { id: "s2", name: "Ganho", kind: "won" as const, position: 1 },
      { id: "s3", name: "Perdido", kind: "lost" as const, position: 2 }
    ];
    const now = Date.parse("2026-11-13T12:00:00Z");
    const summary = summarizePipeline(
      [
        { stageId: "s1", amountCents: 1000, nextContactAt: "2026-11-12T12:00:00Z", prospectId: "p1" },
        { stageId: "s1", amountCents: null, nextContactAt: "2026-11-14T12:00:00Z", prospectId: null },
        { stageId: "s2", amountCents: 5000, nextContactAt: null, prospectId: "p2" },
        { stageId: "s3", amountCents: 700, nextContactAt: "2026-11-01T12:00:00Z", prospectId: null }
      ],
      stages,
      now
    );
    assert.deepEqual(summary, { total: 4, open: 2, openValueCents: 1000, won: 1, wonValueCents: 5000, lost: 1, manual: 2, overdueContacts: 1, scheduledContacts: 1, winRate: 50 });
  });
});

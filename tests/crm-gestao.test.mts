/**
 * Fase 9 — regras puras: indicadores do resumo, "sem acompanhamento", ação rápida de
 * WhatsApp e retorno seguro após ações (filtros/paginação preservados).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const metrics = await import("../lib/crm/metrics.ts");
const { whatsappQuickAction } = await import("../lib/crm/quick-actions.ts");
const { safeReturnTo, withParams } = await import("../lib/crm/navigation.ts");

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-13T12:00:00Z");
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

const stages = [
  { id: "s-novo", name: "Novo", kind: "open" as const, position: 0 },
  { id: "s-contato", name: "Contato realizado", kind: "open" as const, position: 1 },
  { id: "s-proposta", name: "Proposta", kind: "open" as const, position: 2 },
  { id: "s-ganho", name: "Ganho", kind: "won" as const, position: 3 },
  { id: "s-perdido", name: "Perdido", kind: "lost" as const, position: 4 }
];

const deal = (stageId: string, extra: Partial<{ amountCents: number | null; nextContactAt: string | null; createdAt: string; lastInteractionAt: string | null; prospectId: string | null }> = {}) => ({
  stageId,
  amountCents: null,
  nextContactAt: null,
  prospectId: null,
  createdAt: iso(-1),
  lastInteractionAt: null,
  ...extra
});

describe("Fase 9 — indicadores do resumo comercial", () => {
  test("regras de cálculo documentadas", () => {
    const summary = metrics.summarizePipeline(
      [
        deal("s-novo", { amountCents: 1000, createdAt: iso(-2) }),
        deal("s-contato", { amountCents: 2000, createdAt: iso(-40) }),
        deal("s-proposta", { amountCents: 3000 }),
        deal("s-ganho", { amountCents: 9000 }),
        deal("s-ganho"),
        deal("s-perdido", { prospectId: "p1" })
      ],
      stages,
      NOW,
      { periodStart: NOW - 30 * DAY }
    );
    assert.equal(summary.open, 3);
    assert.equal(summary.newInPeriod, 5, "o negócio de 40 dias atrás fica fora do período");
    assert.equal(summary.inNegotiation, 1, "saiu da etapa de entrada e não é proposta");
    assert.equal(summary.proposalsPending, 1);
    assert.equal(summary.won, 2);
    assert.equal(summary.lost, 1);
    assert.equal(summary.openValueCents, 6000, "valor potencial = só abertos");
    assert.equal(summary.conversionRate, 67);
    assert.equal(summary.manual, 1);
  });

  test("sem fechamentos a conversão é nula (não inventa número)", () => {
    const summary = metrics.summarizePipeline([deal("s-novo")], stages, NOW);
    assert.equal(summary.conversionRate, null);
    assert.equal(metrics.summarizePipeline([], stages, NOW).open, 0);
  });

  test("etapa de proposta reconhecida por nome, inclusive renomeada e sem acento", () => {
    assert.equal(metrics.isProposalStage({ name: "Proposta enviada", kind: "open" }), true);
    assert.equal(metrics.isProposalStage({ name: "PROPOSTA", kind: "open" }), true);
    assert.equal(metrics.isProposalStage({ name: "Proposta", kind: "won" }), false);
    assert.equal(metrics.isProposalStage({ name: "Negociação", kind: "open" }), false);
    assert.equal(metrics.entryStageId([...stages].reverse()), "s-novo");
  });

  test("sem acompanhamento: sem interação recente e sem próximo contato futuro", () => {
    assert.equal(metrics.isStale(deal("s-novo", { createdAt: iso(-20) }), NOW), true);
    assert.equal(metrics.isStale(deal("s-novo", { createdAt: iso(-20), lastInteractionAt: iso(-3) }), NOW), false);
    assert.equal(metrics.isStale(deal("s-novo", { createdAt: iso(-20), nextContactAt: iso(2) }), NOW), false);
    assert.equal(metrics.isStale(deal("s-novo", { createdAt: iso(-20), nextContactAt: iso(-2) }), NOW), true, "próximo contato vencido não conta como acompanhamento");
    assert.equal(metrics.isStale(deal("s-novo", { createdAt: iso(-5) }), NOW), false);
    assert.equal(metrics.daysSinceTouch(deal("s-novo", { createdAt: iso(-20), lastInteractionAt: iso(-15) }), NOW), 15);
    const summary = metrics.summarizePipeline([deal("s-novo", { createdAt: iso(-30) }), deal("s-ganho", { createdAt: iso(-30) })], stages, NOW);
    assert.equal(summary.stale, 1, "fechados não contam como sem acompanhamento");
  });
});

describe("Fase 9 — ação rápida de WhatsApp", () => {
  test("usa o primeiro número válido no formato internacional", () => {
    const action = whatsappQuickAction("(41) 3333-4444 / (41) 98888-7777");
    assert.equal(action.url, "https://wa.me/5541988887777");
    assert.ok(action.display?.startsWith("+55"));
    assert.equal(action.problem, null);
    assert.equal(whatsappQuickAction(null, "+1 415 555 0100").url, "https://wa.me/14155550100");
    assert.equal(whatsappQuickAction("", "41 98888-7777").url, "https://wa.me/5541988887777", "pula vazio e usa o próximo");
  });

  test("ausente ou inválido não gera link e explica o motivo", () => {
    assert.deepEqual(whatsappQuickAction(null, undefined), { url: null, display: null, problem: "Sem telefone cadastrado" });
    const tollFree = whatsappQuickAction("0800 123 4567");
    assert.equal(tollFree.url, null);
    assert.match(String(tollFree.problem), /0800/);
    assert.equal(whatsappQuickAction("123").url, null);
    assert.equal(whatsappQuickAction("ligar depois 41999990000").url, null);
  });
});

describe("Fase 9 — retorno após ações preserva filtros e página", () => {
  test("aceita só caminhos internos do dashboard", () => {
    const back = "/dashboard/crm?view=tabela&q=padaria+centro&etapa=7b0c&pagina=3&de=2026-01-01";
    assert.equal(safeReturnTo(back, "/dashboard/crm"), back);
    assert.equal(safeReturnTo("https://evil.test/dashboard", "/dashboard/crm"), "/dashboard/crm");
    assert.equal(safeReturnTo("//evil.test", "/dashboard/crm"), "/dashboard/crm");
    assert.equal(safeReturnTo("/dashboard//crm", "/dashboard/crm"), "/dashboard/crm");
    assert.equal(safeReturnTo("/login", "/dashboard/crm"), "/dashboard/crm");
  });

  test("status substitui feedback anterior e mantém o resto da query", () => {
    const next = withParams("/dashboard/crm?view=tabela&pagina=2&status=velho&error=x", { status: "interacao-registrada" });
    const url = new URL(next, "https://local.test");
    assert.equal(url.searchParams.get("pagina"), "2");
    assert.equal(url.searchParams.get("view"), "tabela");
    assert.equal(url.searchParams.get("status"), "interacao-registrada");
    assert.equal(url.searchParams.get("error"), null);
  });
});

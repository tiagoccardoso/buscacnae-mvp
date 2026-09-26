import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyMove, computeDropPosition, evenlySpaced, groupByStage, positionBetween, sumAmounts } from "../lib/crm/board.ts";
import { DEFAULT_PIPELINE, entryStage, moveStage, planStageRemoval, stageTransition, validatePipeline } from "../lib/crm/pipeline.ts";
import {
  canAssignDeal,
  canChangeMember,
  canConfigurePipeline,
  canDeleteDeal,
  canEditDeal,
  canManageMembers,
  canMoveDeal,
  canUpdateTask
} from "../lib/crm/permissions.ts";
import { buildTimeline, dealChangeActivities, dealCreatedActivity, describeActivity } from "../lib/crm/timeline.ts";
import { cleanEmail, parseAmountToCents, parseDateOnly, parseLocalDateTime, planImport, uuidList } from "../lib/crm/input.ts";
import { isKnownCrmDetail, readCrmFeedback } from "../lib/crm/messages.ts";
import type { CrmActivity, PipelineStage } from "../lib/crm/types.ts";

const stages: PipelineStage[] = DEFAULT_PIPELINE.map((stage, index) => ({ id: `s${index}`, name: stage.name, kind: stage.kind, position: index }));

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

test("pipeline padrão segue o fluxo Novo → … → Ganho/Perdido e é válido", () => {
  assert.deepEqual(DEFAULT_PIPELINE.map((stage) => stage.name), ["Novo", "Contato realizado", "Interessado", "Reunião", "Proposta", "Ganho", "Perdido"]);
  assert.deepEqual(validatePipeline([...DEFAULT_PIPELINE]), []);
  assert.equal(entryStage(stages)?.name, "Novo");
});

test("pipeline configurável rejeita configurações quebradas", () => {
  assert.match(validatePipeline([])[0], /pelo menos uma etapa/);
  assert.ok(validatePipeline([{ name: "Ganho", kind: "won" }]).some((error) => /em andamento/.test(error)));
  assert.ok(validatePipeline([{ name: "Novo", kind: "open" }, { name: " novo ", kind: "open" }]).some((error) => /duplicada/.test(error)));
  assert.ok(validatePipeline([{ name: "A", kind: "open" }, { name: "G1", kind: "won" }, { name: "G2", kind: "won" }]).some((error) => /uma etapa de ganho/.test(error)));
  assert.ok(validatePipeline([{ name: "   ", kind: "open" }]).some((error) => /nome/.test(error)));
});

test("reordenar etapas mantém posições densas e respeita os limites", () => {
  const up = moveStage(stages, "s2", "up");
  assert.deepEqual(up.map((stage) => stage.id).slice(0, 3), ["s0", "s2", "s1"]);
  assert.deepEqual(up.map((stage) => stage.position), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(moveStage(stages, "s0", "up").map((stage) => stage.id), stages.map((stage) => stage.id));
});

test("excluir etapa exige destino para os negócios e mantém pipeline válido", () => {
  assert.deepEqual(planStageRemoval(stages, "s1", 0), { ok: true, moveDealsTo: null });
  assert.equal(planStageRemoval(stages, "s1", 3).ok, false);
  assert.deepEqual(planStageRemoval(stages, "s1", 3, "s2"), { ok: true, moveDealsTo: "s2" });
  const onlyOpen = [stages[0], stages[5]];
  assert.equal(planStageRemoval(onlyOpen, "s0", 0).ok, false, "não pode remover a última etapa em andamento");
});

test("fechar/reabrir negócio define closed_at e limpa motivo da perda", () => {
  const now = "2026-09-25T12:00:00.000Z";
  assert.equal(stageTransition({ kind: "open" }, { kind: "won" }, now).closedAt, now);
  assert.equal(stageTransition({ kind: "won" }, { kind: "won" }, now).closedAt, undefined, "mesma situação mantém a data");
  assert.equal(stageTransition({ kind: "lost" }, { kind: "open" }, now).closedAt, null);
  assert.equal(stageTransition({ kind: "open" }, { kind: "lost" }, now).clearLostReason, false);
});

// ---------------------------------------------------------------------------
// Drag & drop
// ---------------------------------------------------------------------------

const cards = [
  { id: "a", stageId: "s0", position: 1024 },
  { id: "b", stageId: "s0", position: 2048 },
  { id: "c", stageId: "s0", position: 3072 },
  { id: "d", stageId: "s1", position: 1024 }
];

const order = (list: typeof cards, stageId: string) => list.filter((card) => card.stageId === stageId).sort((x, y) => x.position - y.position).map((card) => card.id);

test("drag/drop: posição fracionária entre vizinhos", () => {
  assert.deepEqual(positionBetween(null, null), { position: 1024, needsRebalance: false });
  assert.equal(positionBetween(1024, 2048).position, 1536);
  assert.equal(positionBetween(null, 1024).position, 0);
  assert.equal(positionBetween(2048, null).position, 3072);
  assert.equal(positionBetween(1, 1 + 1e-9).needsRebalance, true);
});

test("drag/drop: reordena dentro da coluna gravando uma única linha", () => {
  const result = applyMove(cards, "c", "s0", 0);
  assert.deepEqual(order(result.cards, "s0"), ["c", "a", "b"]);
  assert.equal(result.changed.length, 1);
  assert.equal(result.fromStageId, "s0");
});

test("drag/drop: move entre colunas na posição solta", () => {
  const result = applyMove(cards, "a", "s1", 1);
  assert.deepEqual(order(result.cards, "s0"), ["b", "c"]);
  assert.deepEqual(order(result.cards, "s1"), ["d", "a"]);
  const toTop = applyMove(cards, "b", "s1", 0);
  assert.deepEqual(order(toTop.cards, "s1"), ["b", "d"]);
  const clamped = applyMove(cards, "a", "s1", 99);
  assert.deepEqual(order(clamped.cards, "s1"), ["d", "a"]);
});

test("drag/drop: renumera a coluna quando o intervalo se esgota", () => {
  const tight = [
    { id: "x", stageId: "s0", position: 1 },
    { id: "y", stageId: "s0", position: 1 + 1e-7 },
    { id: "z", stageId: "s1", position: 5 }
  ];
  const result = applyMove(tight, "z", "s0", 1);
  assert.deepEqual(order(result.cards, "s0"), ["x", "z", "y"]);
  assert.deepEqual(result.changed.map((card) => card.position), [1024, 2048, 3072]);
  assert.deepEqual(evenlySpaced(tight).map((card) => card.position), [1024, 2048, 3072]);
});

test("drag/drop: índice ignora o próprio card e card inexistente não altera o quadro", () => {
  const drop = computeDropPosition(cards, "a", "s0", 1);
  assert.equal(drop.beforeId, "b");
  assert.equal(drop.afterId, "c");
  assert.deepEqual(applyMove(cards, "nope", "s1", 0).changed, []);
});

test("quadro agrupa por etapa na ordem configurada e não some com etapa desconhecida", () => {
  const grouped = groupByStage(stages, [...cards, { id: "o", stageId: "fantasma", position: 1 }]);
  assert.equal(grouped[0].stage.name, "Novo");
  assert.deepEqual(grouped[0].cards.map((card) => card.id), ["a", "b", "c"]);
  assert.equal(grouped.at(-1)?.stage.id, "__orphan__");
  assert.equal(sumAmounts([{ amountCents: 1000 }, { amountCents: null }, { amountCents: 50 }]), 1050);
});

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------

const owner = { profileId: "u-owner", role: "owner" as const };
const admin = { profileId: "u-admin", role: "admin" as const };
const member = { profileId: "u-member", role: "member" as const };
const members = new Set(["u-owner", "u-admin", "u-member", "u-other"]);

test("permissões: membro edita/move os seus e os sem responsável, não os de outros", () => {
  assert.equal(canEditDeal(member, { ownerProfileId: "u-member" }), true);
  assert.equal(canEditDeal(member, { ownerProfileId: null }), true);
  assert.equal(canEditDeal(member, { ownerProfileId: "u-other" }), false);
  assert.equal(canMoveDeal(member, { ownerProfileId: "u-other" }), false);
  assert.equal(canMoveDeal(admin, { ownerProfileId: "u-other" }), true);
  assert.equal(canEditDeal(owner, { ownerProfileId: "u-other" }), true);
});

test("permissões: responsável só é alguém do workspace e membro só assume o que está livre", () => {
  assert.equal(canAssignDeal(member, { ownerProfileId: null }, "u-member", members), true);
  assert.equal(canAssignDeal(member, { ownerProfileId: null }, "u-other", members), false);
  assert.equal(canAssignDeal(member, { ownerProfileId: "u-other" }, "u-member", members), false);
  assert.equal(canAssignDeal(member, { ownerProfileId: "u-member" }, null, members), true);
  assert.equal(canAssignDeal(admin, { ownerProfileId: "u-other" }, "u-member", members), true);
  assert.equal(canAssignDeal(owner, { ownerProfileId: null }, "u-de-outra-org", members), false, "nunca atribui a quem não é membro");
});

test("permissões: exclusão, tarefas, pipeline e equipe", () => {
  assert.equal(canDeleteDeal(member, { ownerProfileId: "u-member", createdBy: "u-member" }), true);
  assert.equal(canDeleteDeal(member, { ownerProfileId: "u-member", createdBy: "u-owner" }), false);
  assert.equal(canUpdateTask(member, { assigneeProfileId: "u-member", createdBy: "u-owner" }, { ownerProfileId: "u-other" }), true);
  assert.equal(canUpdateTask(member, { assigneeProfileId: "u-other", createdBy: "u-other" }, { ownerProfileId: "u-other" }), false);
  assert.equal(canConfigurePipeline(member), false);
  assert.equal(canConfigurePipeline(admin), true);
  assert.equal(canManageMembers(member), false);
  assert.equal(canChangeMember(admin, { profileId: "u-owner", role: "owner" }, "remove"), false, "ninguém remove o proprietário");
  assert.equal(canChangeMember(admin, { profileId: "u-member", role: "member" }, "owner"), false);
  assert.equal(canChangeMember(admin, { profileId: "u-member", role: "member" }, "remove"), true);
  assert.equal(canChangeMember(member, { profileId: "u-member", role: "member" }, "remove"), true, "membro pode sair");
  assert.equal(canChangeMember(member, { profileId: "u-other", role: "member" }, "remove"), false);
});

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

test("histórico: mudança de etapa, responsável e campos geram eventos distintos com valores", () => {
  const drafts = dealChangeActivities(
    { dealId: "d1", establishmentId: "e1", actorProfileId: "u-owner" },
    { stageId: "s0", ownerProfileId: null, amountCents: null, title: "A" },
    { stageId: "s3", ownerProfileId: "u-member", amountCents: 150000, title: "A" },
    { stages: new Map(stages.map((stage) => [stage.id, stage.name])), members: new Map([["u-member", "Maria"]]) }
  );
  assert.deepEqual(drafts.map((draft) => draft.type), ["stage.changed", "owner.changed", "deal.updated"]);
  assert.equal(drafts[0].payload.from, "Novo");
  assert.equal(drafts[0].payload.to, "Reunião");
  assert.deepEqual((drafts[2].payload.diff as Record<string, unknown>).amountCents, { from: null, to: 150000 });
  assert.ok(!("title" in (drafts[2].payload.diff as Record<string, unknown>)), "campo inalterado não gera ruído");
  assert.equal(describeActivity(drafts[0]), "Etapa: Novo → Reunião");
  assert.equal(describeActivity(drafts[1]), "Responsável: Maria");
});

test("histórico: origem do lead fica registrada na criação", () => {
  const draft = dealCreatedActivity({ dealId: "d1", establishmentId: "e1", actorProfileId: "u" }, { stageName: "Novo", source: "list", sourceRef: "l1", sourceLabel: "Indústrias PR" });
  assert.equal(draft.payload.source, "list");
  assert.equal(describeActivity(draft), "Entrou no CRM em “Novo” · origem: Lista de prospecção (Indústrias PR)");
});

test("timeline mescla eventos e notas, sem duplicar a nota, agrupada por mês", () => {
  const activities: CrmActivity[] = [
    { id: "a1", dealId: "d", establishmentId: "e", actorProfileId: "u", actorName: "Ana", type: "deal.created", payload: { stage: "Novo", source: "search" }, happenedAt: "2026-08-10T12:00:00Z" },
    { id: "a2", dealId: "d", establishmentId: "e", actorProfileId: "u", actorName: "Ana", type: "note.created", payload: { noteId: "n1" }, happenedAt: "2026-09-02T12:00:00Z" },
    { id: "a3", dealId: "d", establishmentId: "e", actorProfileId: "u", actorName: "Ana", type: "stage.changed", payload: { from: "Novo", to: "Interessado" }, happenedAt: "2026-09-03T12:00:00Z" }
  ];
  const groups = buildTimeline(activities, [{ id: "n1", body: "Ligou de volta", createdAt: "2026-09-02T12:00:00Z", authorName: "Ana" }]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "Setembro de 2026");
  assert.deepEqual(groups[0].entries.map((entry) => entry.kind), ["activity", "note"]);
  assert.equal(groups.flatMap((group) => group.entries).length, 3);
});

// ---------------------------------------------------------------------------
// Entradas e listas → CRM
// ---------------------------------------------------------------------------

test("listas → CRM: deduplica, ignora ids inválidos e não recria negócios existentes", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  const plan = planImport([a, a.toUpperCase(), "nao-uuid", b], [b]);
  assert.deepEqual(plan, { toCreate: [a], alreadyInCrm: 1, requested: 2 });
  assert.equal(uuidList(Array.from({ length: 1200 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)).length, 1000);
});

test("entradas: valor em reais, datas e e-mail", () => {
  assert.equal(parseAmountToCents("R$ 12.500,90"), 1250090);
  assert.equal(parseAmountToCents("1.234"), 123400);
  assert.equal(parseAmountToCents("99.5"), 9950);
  assert.equal(parseAmountToCents(""), null);
  assert.equal(parseAmountToCents("abc"), undefined);
  assert.equal(parseDateOnly("2026-02-30"), null);
  assert.equal(parseDateOnly("2026-12-01"), "2026-12-01");
  assert.equal(parseLocalDateTime("2026-09-30T14:00"), "2026-09-30T17:00:00.000Z");
  assert.equal(cleanEmail("Ana@Empresa.com.br "), "ana@empresa.com.br");
  assert.equal(cleanEmail("ana@"), undefined);
});

test("feedback da URL só exibe mensagens conhecidas", () => {
  assert.equal(isKnownCrmDetail("Etapa duplicada: Novo."), true);
  assert.equal(isKnownCrmDetail("Clique aqui e informe sua senha"), false);
  assert.equal(readCrmFeedback({ error: "forbidden", detail: "Texto forjado" }).error, "Você não tem permissão para esta ação neste workspace.");
  assert.equal(readCrmFeedback({ status: "deal-criado" }).status, "Empresa adicionada ao CRM.");
});

// ---------------------------------------------------------------------------
// Modelo: empresa como entidade central + isolamento em toda consulta
// ---------------------------------------------------------------------------

test("schema do CRM referencia a empresa e não copia dados cadastrais", () => {
  const schema = readFileSync(new URL("../sql/neon_crm.sql", import.meta.url), "utf8");
  const crmTables = schema.split(/CREATE TABLE IF NOT EXISTS /).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf(";")));
  assert.ok(crmTables.length >= 8);
  for (const table of crmTables) {
    assert.doesNotMatch(table, /\b(company_name|razao_social|cnpj|trade_name|city_name|state_code|primary_cnae_code)\b/, `sem cópia cadastral em ${table.split(" ")[0]}`);
  }
  assert.match(schema, /establishment_id UUID NOT NULL REFERENCES establishments\(id\)/);
  assert.match(schema, /UNIQUE \(workspace_id, establishment_id\)/);
  assert.match(schema, /FOREIGN KEY \(workspace_id, stage_id\) REFERENCES crm_pipeline_stages \(workspace_id, id\)/);
  assert.match(schema, /FOREIGN KEY \(workspace_id, deal_id\) REFERENCES crm_deals \(workspace_id, id\)/);
});

test("toda consulta do repositório sobre tabelas crm_ filtra por workspace", () => {
  const source = readFileSync(new URL("../lib/crm/repository.ts", import.meta.url), "utf8");
  const statements = Array.from(source.matchAll(/`([^`]*\b(?:FROM|UPDATE|INTO|JOIN)\s+crm_(?:deals|notes|tasks|contacts|activities|pipeline_stages)\b[^`]*)`/g)).map((match) => match[1]);
  assert.ok(statements.length > 20, `esperava muitas consultas, achou ${statements.length}`);
  for (const statement of statements) {
    // Consultas com WHERE dinâmico partem de `where = ["x.workspace_id = $1"]` (checado abaixo).
    if (statement.includes("${where.join")) continue;
    assert.match(statement, /workspace_id/, `consulta sem escopo de workspace:\n${statement.slice(0, 200)}`);
  }
  const dynamicWheres = Array.from(source.matchAll(/const where = \[([^\]]*)\]/g)).map((match) => match[1]);
  assert.ok(dynamicWheres.length >= 3);
  for (const initial of dynamicWheres) assert.match(initial, /^"\w+\.workspace_id = \$1"$/);
});

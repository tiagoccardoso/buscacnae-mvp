/**
 * Integração do CRM contra um PostgreSQL real em memória (PGlite): executa a
 * migração sql/neon_crm.sql e o repositório de verdade (mesmas consultas de produção).
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { setQueryExecutorForTests } from "@/lib/db";
import {
  CrmError,
  addContact,
  addMemberByEmail,
  addNote,
  addStage,
  addTask,
  changeMember,
  createDeals,
  createTeamWorkspace,
  deleteDeal,
  getDeal,
  getDealByEstablishment,
  listActivities,
  listDeals,
  listMembers,
  listStages,
  listTasks,
  moveDeal,
  removeStage,
  resolveCrmContext,
  setTaskStatus,
  updateDeal
} from "../lib/crm/repository.ts";
import type { CrmContext } from "../lib/crm/types.ts";

const BASE_SCHEMA = `
  CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT NOT NULL DEFAULT 'x', is_active BOOLEAN DEFAULT TRUE);
  CREATE TABLE profiles (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), email TEXT, full_name TEXT);
  CREATE TABLE establishments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cnpj TEXT UNIQUE, company_name TEXT, trade_name TEXT, city_name TEXT, state_code TEXT
  );
`;

const ANA = "aaaaaaaa-0000-4000-8000-000000000001";
const BRUNO = "bbbbbbbb-0000-4000-8000-000000000002";
const CARLA = "cccccccc-0000-4000-8000-000000000003";
const users = {
  ana: { id: ANA, email: "ana@acme.com.br", name: "Ana" },
  bruno: { id: BRUNO, email: "bruno@acme.com.br", name: "Bruno" },
  carla: { id: CARLA, email: "carla@outra.com.br", name: "Carla" }
};

let db: PGlite;
const companies: string[] = [];

async function expectCrmError(promise: Promise<unknown>, code: CrmError["code"]) {
  await assert.rejects(promise, (error: unknown) => error instanceof CrmError && error.code === code);
}

async function asUser(user: { id: string; email: string; name: string }, workspaceId?: string) {
  return (await resolveCrmContext(user, workspaceId ?? null)).ctx;
}

describe("CRM no banco (PGlite)", () => {
  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(BASE_SCHEMA);
    await db.exec(readFileSync(new URL("../sql/neon_crm.sql", import.meta.url), "utf8"));
    for (const user of Object.values(users)) {
      await db.query(`INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`, [user.id, user.name, user.email]);
      await db.query(`INSERT INTO profiles (id, user_id, email, full_name) VALUES ($1, $1, $2, $3)`, [user.id, user.email, user.name]);
    }
    for (let index = 0; index < 6; index += 1) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO establishments (cnpj, company_name, trade_name, city_name, state_code) VALUES ($1, $2, $3, 'Curitiba', 'PR') RETURNING id`,
        [`1234567800019${index}`, `Empresa ${index} LTDA`, `Fantasia ${index}`]
      );
      companies.push(rows[0].id);
    }
    setQueryExecutorForTests({
      async query(text, params) {
        return (await db.query<Record<string, unknown>>(text, params as unknown[])).rows;
      },
      async transaction(queries) {
        return db.transaction(async (tx) => {
          const results: Record<string, unknown>[][] = [];
          for (const query of queries) results.push((await tx.query<Record<string, unknown>>(query.text, query.params as unknown[])).rows);
          return results;
        });
      }
    });
  });

  after(async () => {
    setQueryExecutorForTests(null);
    await db.close();
  });

  let ana: CrmContext;

  test("primeiro acesso cria workspace pessoal com pipeline padrão (idempotente)", async () => {
    ana = await asUser(users.ana);
    const again = await asUser(users.ana);
    assert.equal(again.workspace.id, ana.workspace.id);
    assert.equal(ana.role, "owner");
    assert.equal(ana.workspace.isPersonal, true);
    const stages = await listStages(ana);
    assert.deepEqual(stages.map((stage) => stage.name), ["Novo", "Contato realizado", "Interessado", "Reunião", "Proposta", "Ganho", "Perdido"]);
    const { rows } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM crm_workspaces WHERE owner_profile_id = $1 AND is_personal`, [ANA]);
    assert.equal(rows[0].count, 1);
  });

  test("lista → CRM: cria negócios referenciando a empresa, sem duplicar e com origem no histórico", async () => {
    const listId = "dddddddd-0000-4000-8000-000000000009";
    const first = await createDeals(ana, companies.slice(0, 3), { source: "list", sourceRef: listId, sourceLabel: "Indústrias PR", ownerProfileId: ANA });
    assert.equal(first.created, 3);
    const second = await createDeals(ana, companies.slice(0, 4), { source: "list", sourceRef: listId, ownerProfileId: ANA });
    assert.deepEqual([second.created, second.alreadyInCrm], [1, 3]);

    const deals = await listDeals(ana);
    assert.equal(deals.length, 4);
    assert.ok(deals.every((deal) => deal.stageId === deals[0].stageId), "todos entram na etapa inicial");
    assert.equal(deals.find((deal) => deal.establishmentId === companies[0])?.company.companyName, "Empresa 0 LTDA", "dados vêm de establishments por JOIN");

    const activities = await listActivities(ana, { establishmentId: companies[0] });
    assert.equal(activities[0].type, "deal.created");
    assert.equal(activities[0].payload.source, "list");
    assert.equal(activities[0].payload.sourceLabel, "Indústrias PR");
    assert.equal(activities[0].actorProfileId, ANA);

    const invalid = await createDeals(ana, ["eeeeeeee-0000-4000-8000-00000000dead"], { source: "search" });
    assert.equal(invalid.created, 0, "empresa inexistente não vira negócio");
  });

  test("lead → empresa: o negócio é encontrado pela empresa e não copia cadastro", async () => {
    const deal = await getDealByEstablishment(ana, companies[1]);
    assert.ok(deal);
    await db.query(`UPDATE establishments SET company_name = 'Nova Razão SA' WHERE id = $1`, [companies[1]]);
    assert.equal((await getDeal(ana, deal.id))?.company.companyName, "Nova Razão SA", "fonte única: a atualização aparece no CRM");
  });

  test("pipeline + drag/drop: move entre etapas, reordena, fecha e registra histórico", async () => {
    const stages = await listStages(ana);
    const [novo, contato, , , , ganho] = stages;
    const [a, b] = (await listDeals(ana, { stageId: novo.id }));

    await moveDeal(ana, b.id, contato.id, 0);
    await moveDeal(ana, a.id, contato.id, 1);
    const column = await listDeals(ana, { stageId: contato.id });
    assert.deepEqual(column.map((deal) => deal.id), [b.id, a.id]);

    await moveDeal(ana, a.id, contato.id, 0);
    assert.deepEqual((await listDeals(ana, { stageId: contato.id })).map((deal) => deal.id), [a.id, b.id], "reordenar na mesma coluna");

    await moveDeal(ana, a.id, ganho.id, 0);
    const won = await getDeal(ana, a.id);
    assert.ok(won?.closedAt, "etapa de ganho registra fechamento");
    await updateDeal(ana, a.id, { stageId: contato.id });
    assert.equal((await getDeal(ana, a.id))?.closedAt, null, "reabrir limpa o fechamento");

    const history = (await listActivities(ana, { dealId: a.id })).filter((activity) => activity.type === "stage.changed");
    assert.deepEqual(history.map((activity) => `${activity.payload.from}→${activity.payload.to}`).reverse(), ["Novo→Contato realizado", "Contato realizado→Ganho", "Ganho→Contato realizado"]);
    await expectCrmError(moveDeal(ana, a.id, "ffffffff-0000-4000-8000-000000000000", 0), "invalid");
  });

  test("histórico: notas, tarefas, contatos, responsável e valor com autor e data", async () => {
    const [deal] = await listDeals(ana);
    await addNote(ana, deal.id, "Pediu proposta até sexta.");
    await addTask(ana, deal.id, { title: "Enviar proposta", dueAt: "2026-10-02T15:00:00.000Z", assigneeProfileId: null });
    const [task] = await listTasks(ana, { dealId: deal.id });
    assert.equal(task.assigneeProfileId, ANA, "sem responsável explícito, a tarefa é de quem criou");
    await setTaskStatus(ana, task.id, true);
    await addContact(ana, deal.id, { name: "João Compras", jobTitle: "Comprador", email: "joao@empresa.com.br", phone: null, makePrimary: true });
    await updateDeal(ana, deal.id, { amountCents: 1250000, expectedCloseDate: "2026-11-30" });

    const updated = await getDeal(ana, deal.id);
    assert.equal(updated?.amountCents, 1250000);
    assert.equal(updated?.expectedCloseDate, "2026-11-30");
    assert.ok(updated?.primaryContactId);

    const types = (await listActivities(ana, { dealId: deal.id })).map((activity) => activity.type);
    for (const type of ["note.created", "task.created", "task.completed", "contact.created", "deal.updated"]) assert.ok(types.includes(type as never), `falta ${type}`);
    const activities = await listActivities(ana, { dealId: deal.id });
    assert.ok(activities.every((activity) => activity.actorName === "Ana" && activity.happenedAt));
  });

  test("permissões em equipe: owner, admin, membro e responsável", async () => {
    const teamId = await createTeamWorkspace(ANA, "Comercial Sul");
    const anaTeam = await asUser(users.ana, teamId);
    assert.equal(anaTeam.workspace.id, teamId);
    assert.deepEqual((await addMemberByEmail(anaTeam, "BRUNO@acme.com.br", "member")), { added: true });
    assert.deepEqual((await addMemberByEmail(anaTeam, "ninguem@x.com", "member")), { added: false });
    await expectCrmError(addMemberByEmail(ana, "bruno@acme.com.br", "member"), "invalid");

    const bruno = await asUser(users.bruno, teamId);
    assert.equal(bruno.role, "member");
    await expectCrmError(addMemberByEmail(bruno, "carla@outra.com.br", "member"), "forbidden");
    await expectCrmError(addStage(bruno, { name: "Negociação", kind: "open" }), "forbidden");

    await createDeals(anaTeam, [companies[4]], { source: "search", ownerProfileId: ANA });
    await createDeals(anaTeam, [companies[5]], { source: "search" });
    const anasDeal = (await getDealByEstablishment(bruno, companies[4]))!;
    const freeDeal = (await getDealByEstablishment(bruno, companies[5]))!;
    const stages = await listStages(bruno);

    assert.equal((await listDeals(bruno)).length, 2, "membro vê os negócios da equipe");
    await expectCrmError(moveDeal(bruno, anasDeal.id, stages[1].id, 0), "forbidden");
    await expectCrmError(updateDeal(bruno, anasDeal.id, { ownerProfileId: BRUNO }), "forbidden");
    await addNote(bruno, anasDeal.id, "Membro pode comentar.");

    await updateDeal(bruno, freeDeal.id, { ownerProfileId: BRUNO });
    await moveDeal(bruno, freeDeal.id, stages[2].id, 0);
    assert.equal((await getDeal(bruno, freeDeal.id))?.ownerName, "Bruno");
    await expectCrmError(updateDeal(anaTeam, freeDeal.id, { ownerProfileId: CARLA }), "forbidden");

    await changeMember(anaTeam, BRUNO, "remove");
    assert.equal((await getDeal(anaTeam, freeDeal.id))?.ownerProfileId, null, "negócios de quem sai ficam sem responsável");
    assert.equal((await asUser(users.bruno, teamId)).workspace.isPersonal, true, "ex-membro volta ao próprio workspace");
    await expectCrmError(changeMember(anaTeam, ANA, "remove"), "forbidden");
    assert.deepEqual((await listMembers(anaTeam)).map((member) => member.name), ["Ana"]);
  });

  test("isolamento: outra organização não lê nem altera leads, nem por id direto", async () => {
    const carla = await asUser(users.carla);
    const [anasDeal] = await listDeals(ana);
    assert.equal((await listDeals(carla)).length, 0);
    assert.equal(await getDeal(carla, anasDeal.id), null);
    assert.equal(await getDealByEstablishment(carla, anasDeal.establishmentId), null);
    await expectCrmError(moveDeal(carla, anasDeal.id, (await listStages(carla))[1].id, 0), "not_found");
    await expectCrmError(addNote(carla, anasDeal.id, "invasão"), "not_found");
    await expectCrmError(deleteDeal(carla, anasDeal.id), "not_found");
    assert.equal((await listActivities(carla, { dealId: anasDeal.id })).length, 0);

    // Workspace preferido forjado (cookie) sem associação → cai no pessoal.
    const forged = await asUser(users.carla, ana.workspace.id);
    assert.notEqual(forged.workspace.id, ana.workspace.id);

    // A mesma empresa pode estar no CRM de duas organizações, de forma independente.
    await createDeals(carla, [anasDeal.establishmentId], { source: "company" });
    assert.equal((await listDeals(carla)).length, 1);
    assert.notEqual((await getDealByEstablishment(carla, anasDeal.establishmentId))?.id, anasDeal.id);

    // Defesa no banco: negócio não pode apontar para etapa de outro workspace.
    const [carlaStage] = await listStages(carla);
    await assert.rejects(db.query(`UPDATE crm_deals SET stage_id = $1 WHERE id = $2`, [carlaStage.id, anasDeal.id]));
  });

  test("configuração do pipeline: etapa nova e exclusão movendo negócios", async () => {
    await addStage(ana, { name: "Negociação", kind: "open" });
    let stages = await listStages(ana);
    assert.deepEqual(stages.map((stage) => stage.name).slice(-3), ["Negociação", "Ganho", "Perdido"], "abertas antes do fechamento");
    const contato = stages.find((stage) => stage.name === "Contato realizado")!;
    const interessado = stages.find((stage) => stage.name === "Interessado")!;
    const moving = await listDeals(ana, { stageId: contato.id });
    assert.ok(moving.length > 0);
    await expectCrmError(removeStage(ana, contato.id, null), "invalid");
    await removeStage(ana, contato.id, interessado.id);
    stages = await listStages(ana);
    assert.ok(!stages.some((stage) => stage.id === contato.id));
    assert.deepEqual(stages.map((stage) => stage.position), stages.map((_, index) => index));
    for (const deal of moving) assert.equal((await getDeal(ana, deal.id))?.stageId, interessado.id);
  });

  test("remover do CRM mantém a empresa e o registro de auditoria", async () => {
    const [deal] = await listDeals(ana);
    await deleteDeal(ana, deal.id);
    assert.equal(await getDeal(ana, deal.id), null);
    const { rows } = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM establishments WHERE id = $1`, [deal.establishmentId]);
    assert.equal(rows[0].count, 1);
    const trail = await listActivities(ana, { establishmentId: deal.establishmentId });
    assert.equal(trail[0].type, "deal.deleted");
  });
});

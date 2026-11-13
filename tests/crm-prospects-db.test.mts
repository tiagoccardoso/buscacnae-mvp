/**
 * Fase 8 — integração contra PostgreSQL em memória (PGlite): migração real
 * (sql/neon_crm.sql + sql/neon_crm_prospects.sql) e o repositório de produção.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { ProspectFields, DealFields } from "../lib/crm/prospects.ts";

const { setQueryExecutorForTests } = await import("@/lib/db");
const repo = await import("../lib/crm/repository.ts");
const { parseProspectInput } = await import("../lib/crm/prospects.ts");
const { CrmError } = repo;

const sqlFile = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), "utf8");

const BASE_SCHEMA = `
  CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT NOT NULL DEFAULT 'x', is_active BOOLEAN DEFAULT TRUE);
  CREATE TABLE profiles (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), email TEXT, full_name TEXT);
  CREATE TABLE establishments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cnpj TEXT UNIQUE, company_name TEXT, trade_name TEXT, city_name TEXT, state_code TEXT, phone TEXT
  );
  CREATE TABLE saved_establishments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), profile_id UUID, establishment_id UUID REFERENCES establishments(id));
`;

const ANA = "aaaaaaaa-0000-4000-8000-0000000000a1";
const BRUNO = "bbbbbbbb-0000-4000-8000-0000000000b2";
const CARLA = "cccccccc-0000-4000-8000-0000000000c3";
const users = {
  ana: { id: ANA, email: "ana@acme.com.br", name: "Ana" },
  bruno: { id: BRUNO, email: "bruno@acme.com.br", name: "Bruno" },
  carla: { id: CARLA, email: "carla@outra.com.br", name: "Carla" }
};
const OFFICIAL_CNPJ = "11222333000181";

let db: PGlite;
let officialId = "";
let legacyDealId = "";

async function expectCrmError(promise: Promise<unknown>, code: InstanceType<typeof CrmError>["code"]) {
  await assert.rejects(promise, (error: unknown) => error instanceof CrmError && error.code === code);
}

async function asUser(user: { id: string; email: string; name: string }, workspaceId?: string) {
  return (await repo.resolveCrmContext(user, workspaceId ?? null)).ctx;
}

function prospect(values: Record<string, string>): ProspectFields {
  const parsed = parseProspectInput((key) => values[key] ?? null);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.prospect;
}

const deal = (overrides: Partial<DealFields> = {}): DealFields => ({
  stageId: null, ownerProfileId: null, amountCents: null, expectedCloseDate: null, priority: "normal", nextContactAt: null, notes: null, ...overrides
});

async function count(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

describe("Fase 8 — prospects manuais no banco (PGlite)", () => {
  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(BASE_SCHEMA);
    await db.exec(sqlFile("neon_crm.sql"));
    for (const user of Object.values(users)) {
      await db.query(`INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`, [user.id, user.name, user.email]);
      await db.query(`INSERT INTO profiles (id, user_id, email, full_name) VALUES ($1, $1, $2, $3)`, [user.id, user.email, user.name]);
    }
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO establishments (cnpj, company_name, trade_name, city_name, state_code, phone) VALUES ($1, 'Oficial Comércio LTDA', 'Oficial', 'Curitiba', 'PR', '(41) 3333-4444 / (41) 98888-7777') RETURNING id`,
      [OFFICIAL_CNPJ]
    );
    officialId = rows[0].id;
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

    // Estado "produção": já existe um negócio da Fase 6 ANTES da migração da Fase 8.
    const ana = await asUser(users.ana);
    // Inserção direta (o repositório atual já usa colunas da Fase 9): mesmo formato do createDeals da Fase 6.
    const stage = (await db.query<{ id: string }>(`SELECT id FROM crm_pipeline_stages WHERE workspace_id = $1 ORDER BY position LIMIT 1`, [ana.workspace.id])).rows[0];
    const created = await db.query<{ id: string }>(
      `INSERT INTO crm_deals (workspace_id, establishment_id, stage_id, position, owner_profile_id, source, created_by) VALUES ($1, $2, $3, 0, $4, 'search', $4) RETURNING id`,
      [ana.workspace.id, officialId, stage.id, ANA]
    );
    legacyDealId = created.rows[0].id;
    await db.query(`INSERT INTO crm_activities (workspace_id, deal_id, establishment_id, actor_profile_id, type, payload) VALUES ($1, $2, $3, $4, 'deal.created', '{"source":"search"}')`, [ana.workspace.id, legacyDealId, officialId, ANA]);

    // Migração aplicada sobre dados existentes, duas vezes (idempotente).
    await db.exec(sqlFile("neon_crm_prospects.sql"));
    await db.exec(sqlFile("neon_crm_prospects.sql"));
    await db.exec(sqlFile("neon_crm_gestao.sql"));
  });

  after(async () => {
    setQueryExecutorForTests(null);
    await db.close();
  });

  test("migração preserva o negócio da busca (lead existente continua igual)", async () => {
    const ana = await asUser(users.ana);
    const legacy = await repo.getDeal(ana, legacyDealId);
    assert.ok(legacy);
    assert.equal(legacy.company.kind, "establishment");
    assert.equal(legacy.establishmentId, officialId);
    assert.equal(legacy.prospectId, null);
    assert.equal(legacy.priority, "normal");
    assert.equal(legacy.company.cnpj, OFFICIAL_CNPJ);
    // Telefone oficial com dois números: o celular é escolhido para o WhatsApp.
    assert.equal(legacy.company.whatsappPhone, "(41) 98888-7777");
  });

  test("1. prospect manual sem CNPJ entra no pipeline (Kanban) com histórico e nota", async () => {
    const ana = await asUser(users.ana);
    const result = await repo.createManualDeal(
      ana,
      prospect({ kind: "company", name: "Oficina do Zé", origin: "referral", originDetail: "Cliente Padaria", whatsapp: "(41) 99999-1111", email: "ze@oficina.com", tags: "sul, indicação" }),
      deal({ amountCents: 150000, priority: "high", nextContactAt: "2026-11-20T13:00:00.000Z", notes: "Quer orçamento para 3 carros" })
    );
    assert.equal(result.linked, false);
    const created = await repo.getDeal(ana, result.dealId);
    assert.ok(created);
    assert.equal(created.company.kind, "prospect");
    assert.equal(created.establishmentId, null);
    assert.equal(created.company.companyName, "Oficina do Zé");
    assert.equal(created.company.whatsappPhone, "(41) 99999-1111");
    assert.equal(created.priority, "high");
    assert.equal(created.ownerProfileId, ANA);
    assert.equal(created.source, "manual");
    const stages = await repo.listStages(ana);
    assert.equal(created.stageId, stages[0].id, "entra na etapa inicial");
    const board = await repo.listDeals(ana);
    assert.ok(board.some((item) => item.id === result.dealId));
    const types = (await repo.listActivities(ana, { dealId: result.dealId })).map((activity) => activity.type).sort();
    assert.deepEqual(types, ["deal.created", "next_contact.scheduled", "note.created", "prospect.created"]);
    assert.equal((await repo.listNotes(ana, result.dealId))[0].body, "Quer orçamento para 3 carros");
    assert.equal(await count(`SELECT count(*)::int AS n FROM establishments`), 1, "nada é gravado na base oficial");
  });

  test("2. empresa com CNPJ válido fora da base vira prospect com documento", async () => {
    const ana = await asUser(users.ana);
    const report = await repo.findDuplicates(ana, { documentType: "cnpj", document: "45723174000110", phones: [], email: null });
    assert.equal(report.establishment, null);
    const result = await repo.createManualDeal(ana, prospect({ kind: "company", name: "Nova Empresa ME", document: "45.723.174/0001-10" }), deal());
    const record = await repo.getProspect(ana, (await repo.getDeal(ana, result.dealId))!.prospectId);
    assert.equal(record?.document, "45723174000110");
    assert.equal(record?.documentType, "cnpj");
    // 3b. mesmo CNPJ de novo no mesmo workspace → detectado e bloqueado.
    const again = await repo.findDuplicates(ana, { documentType: "cnpj", document: "45723174000110", phones: [], email: null });
    assert.deepEqual(again.matches.map((match) => match.reasons), [["document"]]);
    await expectCrmError(repo.createManualDeal(ana, prospect({ kind: "company", name: "Outra", document: "45723174000110" }), deal()), "conflict");
  });

  test("3a. CNPJ da base sem acesso liberado: não é revelado nem vinculado (nem com id forjado)", async () => {
    const bruno = await asUser(users.bruno);
    const hidden = await repo.findDuplicates(bruno, { documentType: "cnpj", document: OFFICIAL_CNPJ, phones: [], email: null });
    assert.equal(hidden.establishment, null, "sem busca paga, lead salvo ou negócio, a base não é revelada");
    await expectCrmError(
      repo.createManualDeal(bruno, prospect({ kind: "company", name: "Oficial", document: OFFICIAL_CNPJ }), deal(), { linkEstablishmentId: officialId }),
      "not_found"
    );
  });

  test("3. CNPJ já existente na base: oferece vínculo e cria negócio referenciando a ficha oficial", async () => {
    const bruno = await asUser(users.bruno);
    // Acesso legítimo: Bruno salvou esta empresa (carteira/listas).
    await db.query(`INSERT INTO saved_establishments (profile_id, establishment_id) VALUES ($1, $2)`, [BRUNO, officialId]);
    // Id forjado/desatualizado: o CNPJ do formulário precisa ser o da empresa vinculada.
    await expectCrmError(
      repo.createManualDeal(bruno, prospect({ kind: "company", name: "Outra", document: "45723174000110" }), deal(), { linkEstablishmentId: officialId }),
      "invalid"
    );
    const report = await repo.findDuplicates(bruno, { documentType: "cnpj", document: OFFICIAL_CNPJ, phones: [], email: null });
    assert.equal(report.establishment?.id, officialId);
    assert.equal(report.establishment?.dealId, null, "o negócio da Ana é de outro workspace");
    const result = await repo.createManualDeal(
      bruno,
      prospect({ kind: "company", name: "Oficial", document: OFFICIAL_CNPJ, contactName: "Rita", contactRole: "Compras", whatsapp: "41 97777-6666" }),
      deal(),
      { linkEstablishmentId: officialId }
    );
    assert.equal(result.linked, true);
    const linked = await repo.getDeal(bruno, result.dealId);
    assert.equal(linked?.establishmentId, officialId);
    assert.equal(linked?.prospectId, null);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_prospects WHERE workspace_id = $1`, [bruno.workspace.id]), 0, "não duplica dado oficial em crm_prospects");
    const contacts = await repo.listContacts(bruno, linked!);
    assert.deepEqual(contacts.map((contact) => [contact.name, contact.jobTitle, contact.whatsapp]), [["Rita", "Compras", "41 97777-6666"]]);
    assert.equal(linked?.primaryContactId, contacts[0].id);
    const types = (await repo.listActivities(bruno, { dealId: result.dealId })).map((activity) => activity.type).sort();
    assert.deepEqual(types, ["contact.created", "deal.created"], "vínculo oficial não gera 'prospect.created'");
    // De novo: já existe negócio para esta empresa no workspace.
    const after = await repo.findDuplicates(bruno, { documentType: "cnpj", document: OFFICIAL_CNPJ, phones: [], email: null });
    assert.equal(after.establishment?.dealId, result.dealId);
    await expectCrmError(repo.createManualDeal(bruno, prospect({ kind: "company", name: "x", document: OFFICIAL_CNPJ }), deal(), { linkEstablishmentId: officialId }), "conflict");
  });

  test("4. pessoa física com CPF; duplicidade por telefone em outro formato (sem mescla)", async () => {
    const ana = await asUser(users.ana);
    const result = await repo.createManualDeal(ana, prospect({ kind: "person", name: "Maria Souza", document: "529.982.247-25", phone: "+55 41 99999-1111" }), deal());
    const record = await repo.getProspect(ana, (await repo.getDeal(ana, result.dealId))!.prospectId);
    assert.equal(record?.kind, "person");
    assert.equal(record?.documentType, "cpf");
    assert.equal(record?.phone, "+55 41 99999-1111", "telefone guardado como digitado");
    const dup = await repo.findDuplicates(ana, { documentType: null, document: null, phones: ["(41) 99999-1111"], email: "ZE@oficina.com" });
    const names = dup.matches.map((match) => match.name).sort();
    assert.deepEqual(names, ["Maria Souza", "Oficina do Zé"]);
    assert.deepEqual(dup.matches.find((match) => match.name === "Oficina do Zé")?.reasons.sort(), ["email", "phone"]);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_prospects WHERE workspace_id = $1`, [ana.workspace.id]), 3, "nada foi mesclado");
  });

  test("5–8. editar, mover entre etapas, contato adicional e pesquisa por telefone/e-mail/documento", async () => {
    const ana = await asUser(users.ana);
    const [zé] = await repo.listDeals(ana, { q: "Oficina" });
    assert.ok(zé);
    await repo.updateProspect(ana, zé.id, prospect({ kind: "company", name: "Oficina do Zé LTDA", origin: "referral", originDetail: "Cliente Padaria", whatsapp: "(41) 99999-1111", email: "ze@oficina.com", tags: "sul, indicação", segment: "Mecânica" }));
    const updated = await repo.getDeal(ana, zé.id);
    assert.equal(updated?.company.companyName, "Oficina do Zé LTDA");
    const edit = (await repo.listActivities(ana, { dealId: zé.id })).find((activity) => activity.type === "prospect.updated");
    assert.deepEqual((edit?.payload.fields as string[]).sort(), ["name", "segment"]);
    assert.ok(!JSON.stringify(edit?.payload).includes("Mecânica"), "histórico registra campos, não valores");

    const stages = await repo.listStages(ana);
    const result = await repo.moveDeal(ana, zé.id, stages[2].id, 0);
    assert.equal(result.stageChanged, true);
    assert.equal((await repo.getDeal(ana, zé.id))?.stageId, stages[2].id);
    await repo.updateDeal(ana, zé.id, { priority: "low", stageId: stages[3].id });
    assert.equal((await repo.getDeal(ana, zé.id))?.priority, "low");

    await repo.addContact(ana, zé.id, { name: "Zé Filho", jobTitle: "Sócio", email: "filho@oficina.com", phone: null, whatsapp: "41 98888-0000", makePrimary: true });
    const contacts = await repo.listContacts(ana, updated!);
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].prospectId, updated?.prospectId);
    assert.equal((await repo.getDeal(ana, zé.id))?.primaryContactId, contacts[0].id);

    assert.deepEqual((await repo.listDeals(ana, { q: "99999-1111" })).map((item) => item.company.companyName).sort(), ["Maria Souza", "Oficina do Zé LTDA"]);
    assert.deepEqual((await repo.listDeals(ana, { q: "filho@oficina" })).map((item) => item.id), [zé.id]);
    assert.deepEqual((await repo.listDeals(ana, { q: "988880000" })).map((item) => item.id), [zé.id]);
    assert.equal((await repo.listDeals(ana, { q: "529.982" })).length, 1);
    assert.equal((await repo.listDeals(ana, { origin: "referral" })).length, 1);
    assert.equal((await repo.listDeals(ana, { target: "establishment" })).length, 1);
    assert.equal((await repo.listDeals(ana, { target: "prospect" })).length, 3);
  });

  test("14–15. registrar contato, concluir próximo contato e criar tarefa", async () => {
    const ana = await asUser(users.ana);
    const [zé] = await repo.listDeals(ana, { q: "Oficina" });
    assert.ok(zé.nextContactAt);
    await repo.logInteraction(ana, zé.id, { channel: "call", outcome: "done", occurredAt: "2026-11-13T14:00:00.000Z", summary: "Pediu proposta", completeNextContact: true });
    assert.equal((await repo.getDeal(ana, zé.id))?.nextContactAt, null, "contato agendado marcado como realizado");
    await repo.logInteraction(ana, zé.id, { channel: "whatsapp", outcome: "done", occurredAt: null, summary: null, completeNextContact: false, nextContactAt: "2026-11-25T13:00:00.000Z" });
    assert.equal((await repo.getDeal(ana, zé.id))?.nextContactAt, "2026-11-25T13:00:00.000Z");
    await repo.addTask(ana, zé.id, { title: "Enviar proposta", dueAt: "2026-11-21T13:00:00.000Z", assigneeProfileId: null });
    const activities = await repo.listActivities(ana, { dealId: zé.id });
    const interactions = activities.filter((activity) => activity.type === "interaction.logged");
    assert.equal(interactions.length, 2);
    assert.ok(interactions.every((activity) => activity.actorProfileId === ANA && activity.happenedAt && activity.prospectId === zé.prospectId));
    assert.ok(activities.some((activity) => activity.type === "task.created"));
    assert.equal((await repo.listTasks(ana, { dealId: zé.id })).length, 1);
  });

  test("16. isolamento entre usuários e workspaces (inclusive pelo banco)", async () => {
    const ana = await asUser(users.ana);
    const carla = await asUser(users.carla);
    const [zé] = await repo.listDeals(ana, { q: "Oficina" });
    assert.equal(await repo.getDeal(carla, zé.id), null);
    assert.equal(await repo.getProspect(carla, zé.prospectId), null);
    assert.equal((await repo.listDeals(carla)).length, 0);
    await expectCrmError(repo.updateProspect(carla, zé.id, prospect({ kind: "company", name: "invadido" })), "not_found");
    await expectCrmError(repo.logInteraction(carla, zé.id, { channel: "call", outcome: null, occurredAt: null, summary: null, completeNextContact: false }), "not_found");
    const dup = await repo.findDuplicates(carla, { documentType: "cpf", document: "52998224725", phones: ["41 99999-1111"], email: "ze@oficina.com" });
    assert.deepEqual(dup.matches, [], "duplicidade nunca revela dados de outro workspace");
    // Mesmo se o código errar, a FK composta impede negócio de um workspace apontar para prospect de outro.
    const stages = await repo.listStages(carla);
    await assert.rejects(db.query(`INSERT INTO crm_deals (workspace_id, prospect_id, stage_id) VALUES ($1, $2, $3)`, [carla.workspace.id, zé.prospectId, stages[0].id]));
    // Nem um evento do histórico de um workspace pode apontar para prospect de outro (FK composta).
    await assert.rejects(
      db.query(`INSERT INTO crm_activities (workspace_id, prospect_id, type) VALUES ($1, $2, 'interaction.logged')`, [carla.workspace.id, zé.prospectId])
    );
    // E um negócio não pode ter dois alvos nem nenhum.
    await assert.rejects(db.query(`INSERT INTO crm_deals (workspace_id, stage_id) VALUES ($1, $2)`, [carla.workspace.id, stages[0].id]));
  });

  test("permissões em equipe: membro não edita prospect alheio nem atribui a outra pessoa", async () => {
    const teamId = await repo.createTeamWorkspace(ANA, "Comercial");
    const anaTeam = await asUser(users.ana, teamId);
    await repo.addMemberByEmail(anaTeam, users.bruno.email, "member");
    const brunoTeam = await asUser(users.bruno, teamId);
    const owned = await repo.createManualDeal(anaTeam, prospect({ kind: "company", name: "Da Ana" }), deal({ ownerProfileId: ANA }));
    await expectCrmError(repo.updateProspect(brunoTeam, owned.dealId, prospect({ kind: "company", name: "Do Bruno" })), "forbidden");
    await expectCrmError(repo.scheduleNextContact(brunoTeam, owned.dealId, "2026-12-01T12:00:00.000Z"), "forbidden");
    await expectCrmError(repo.createManualDeal(brunoTeam, prospect({ kind: "company", name: "X" }), deal({ ownerProfileId: ANA })), "forbidden");
    // Membro pode registrar contato (atividade) no negócio que enxerga.
    await repo.logInteraction(brunoTeam, owned.dealId, { channel: "meeting", outcome: "done", occurredAt: null, summary: null, completeNextContact: false });
    const mine = await repo.createManualDeal(brunoTeam, prospect({ kind: "company", name: "Do Bruno" }), deal());
    assert.equal((await repo.getDeal(brunoTeam, mine.dealId))?.ownerProfileId, BRUNO);
  });

  test("modelos de mensagem: CRUD por workspace e permissões", async () => {
    const ana = await asUser(users.ana);
    const carla = await asUser(users.carla);
    await repo.saveTemplate(ana, null, { name: "Pós-reunião", body: "Olá, {nome_contato}! Obrigado." });
    const templates = await repo.listTemplates(ana);
    const custom = templates.find((template) => !template.isDefault);
    assert.ok(custom);
    assert.equal(templates.filter((template) => template.isDefault).length, 3);
    assert.equal((await repo.listTemplates(carla)).some((template) => template.id === custom.id), false);
    await expectCrmError(repo.deleteTemplate(carla, custom.id), "not_found");
    await repo.saveTemplate(ana, custom.id, { name: "Pós-reunião v2", body: "Oi" });
    assert.equal((await repo.listTemplates(ana)).find((template) => template.id === custom.id)?.name, "Pós-reunião v2");
    await repo.deleteTemplate(ana, custom.id);
    assert.equal((await repo.listTemplates(ana)).some((template) => template.id === custom.id), false);
  });

  test("excluir prospect remove cadastro, contatos e histórico pessoal; mantém auditoria", async () => {
    const ana = await asUser(users.ana);
    const [zé] = await repo.listDeals(ana, { q: "Oficina" });
    const removed = await repo.deleteDeal(ana, zé.id, { force: true }); // confirmação explícita (Fase 9)
    assert.equal(removed.kind, "prospect");
    assert.equal(await repo.getProspect(ana, zé.prospectId), null);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_contacts WHERE prospect_id = $1`, [zé.prospectId]), 0);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_activities WHERE deal_id = $1 OR prospect_id = $2`, [zé.id, zé.prospectId]), 0);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_activities WHERE workspace_id = $1 AND type = 'deal.deleted' AND payload->>'kind' = 'prospect'`, [ana.workspace.id]), 1);
    // A empresa oficial (lead da busca) segue intacta.
    assert.ok(await repo.getDeal(ana, legacyDealId));
  });

  test("reversão aborta sem apagar nada quando já existem prospects", async () => {
    const before = await count(`SELECT count(*)::int AS n FROM crm_prospects`);
    await assert.rejects(db.exec(sqlFile("neon_crm_prospects_rollback.sql")), /Reversão abortada/);
    await db.exec("ROLLBACK").catch(() => undefined);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_prospects`), before);
  });
});

describe("Fase 8 — reversão em banco sem dados novos", () => {
  test("rollback volta ao schema da Fase 6 e a migração pode ser reaplicada", async () => {
    const clean = new PGlite({ extensions: { pgcrypto } });
    await clean.exec(BASE_SCHEMA);
    await clean.exec(sqlFile("neon_crm.sql"));
    await clean.exec(sqlFile("neon_crm_prospects.sql"));
    await clean.exec(sqlFile("neon_crm_prospects_rollback.sql"));
    const { rows } = await clean.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('crm_prospects', 'crm_message_templates')`);
    assert.equal(Number(rows[0].n), 0);
    const nullable = await clean.query<{ is_nullable: string }>(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'crm_deals' AND column_name = 'establishment_id'`);
    assert.equal(nullable.rows[0].is_nullable, "NO");
    await clean.exec(sqlFile("neon_crm_prospects.sql"));
    await clean.close();
  });
});

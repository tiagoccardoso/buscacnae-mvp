/**
 * Fase 9 — gestão de prospects contra PostgreSQL em memória (PGlite): migrações reais
 * (neon_crm.sql + neon_crm_prospects.sql + neon_crm_gestao.sql) e o repositório de produção.
 * Somente dados fictícios.
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
const metrics = await import("../lib/crm/metrics.ts");
const { CrmError } = repo;

const sqlFile = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), "utf8");

// saved_establishments com a mesma unicidade usada pelas actions (onConflict profile_id,establishment_id).
const BASE_SCHEMA = `
  CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT NOT NULL DEFAULT 'x', is_active BOOLEAN DEFAULT TRUE);
  CREATE TABLE profiles (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), email TEXT, full_name TEXT);
  CREATE TABLE establishments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cnpj TEXT UNIQUE, company_name TEXT, trade_name TEXT, city_name TEXT, state_code TEXT, phone TEXT
  );
  CREATE TABLE saved_establishments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), profile_id UUID NOT NULL, establishment_id UUID NOT NULL REFERENCES establishments(id),
    notes TEXT, stage TEXT NOT NULL DEFAULT 'new', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, establishment_id)
  );
`;

const ANA = "aaaaaaaa-0000-4000-8000-0000000000a1";
const BRUNO = "bbbbbbbb-0000-4000-8000-0000000000b2";
const CARLA = "cccccccc-0000-4000-8000-0000000000c3";
const users = {
  ana: { id: ANA, email: "ana@exemplo.test", name: "Ana" },
  bruno: { id: BRUNO, email: "bruno@exemplo.test", name: "Bruno" },
  carla: { id: CARLA, email: "carla@outra.test", name: "Carla" }
};

let db: PGlite;
const companies: string[] = [];

async function asUser(user: { id: string; email: string; name: string }, workspaceId?: string) {
  return (await repo.resolveCrmContext(user, workspaceId ?? null)).ctx;
}

async function count(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

async function expectCrmError(promise: Promise<unknown>, code: InstanceType<typeof CrmError>["code"]) {
  await assert.rejects(promise, (error: unknown) => error instanceof CrmError && error.code === code);
}

function prospect(values: Record<string, string>): ProspectFields {
  const parsed = parseProspectInput((key) => values[key] ?? null);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.prospect;
}

const dealFields = (overrides: Partial<DealFields> = {}): DealFields => ({
  stageId: null, ownerProfileId: null, amountCents: null, expectedCloseDate: null, priority: "normal", nextContactAt: null, notes: null, ...overrides
});

const savedCount = (profileId: string, establishmentId: string) =>
  count(`SELECT count(*)::int AS n FROM saved_establishments WHERE profile_id = $1 AND establishment_id = $2`, [profileId, establishmentId]);

describe("Fase 9 — gestão de prospects (PGlite)", () => {
  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(BASE_SCHEMA);
    await db.exec(sqlFile("neon_crm.sql"));
    await db.exec(sqlFile("neon_crm_prospects.sql"));
    await db.exec(sqlFile("neon_crm_gestao.sql"));
    await db.exec(sqlFile("neon_crm_gestao.sql")); // idempotente
    for (const user of Object.values(users)) {
      await db.query(`INSERT INTO users (id, name, email) VALUES ($1, $2, $3)`, [user.id, user.name, user.email]);
      await db.query(`INSERT INTO profiles (id, user_id, email, full_name) VALUES ($1, $1, $2, $3)`, [user.id, user.email, user.name]);
    }
    for (let index = 0; index < 8; index += 1) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO establishments (cnpj, company_name, trade_name, city_name, state_code, phone) VALUES ($1, $2, $3, 'Curitiba', 'PR', $4) RETURNING id`,
        [`1122233300${String(index).padStart(2, "0")}81`, `Empresa Teste ${index} LTDA`, `Teste ${index}`, index % 2 ? "(41) 98888-77" + String(index).padStart(2, "0") : "0800 123 4567"]
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
    await db.close();
  });

  // 1
  test("enviar um lead novo ao CRM também o inclui nos leads salvos", async () => {
    const ana = await asUser(users.ana);
    const result = await repo.createDeals(ana, [companies[0]], { source: "search", ownerProfileId: ANA });
    assert.equal(result.created, 1);
    assert.equal(result.savedNew, 1);
    assert.equal(await savedCount(ANA, companies[0]), 1);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_deals WHERE workspace_id = $1 AND establishment_id = $2`, [ana.workspace.id, companies[0]]), 1);
  });

  // 2
  test("reenviar o mesmo lead não duplica negócio nem lead salvo (idempotente)", async () => {
    const ana = await asUser(users.ana);
    const again = await repo.createDeals(ana, [companies[0], companies[0]], { source: "map", ownerProfileId: ANA });
    assert.equal(again.created, 0);
    assert.equal(again.alreadyInCrm, 1);
    assert.equal(again.savedNew, 0);
    assert.equal(await savedCount(ANA, companies[0]), 1);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_deals WHERE workspace_id = $1 AND establishment_id = $2`, [ana.workspace.id, companies[0]]), 1);
    // Concorrência: dois envios simultâneos continuam gerando um único registro em cada tabela.
    await Promise.all([
      repo.createDeals(ana, [companies[1]], { source: "search", ownerProfileId: ANA }),
      repo.createDeals(ana, [companies[1]], { source: "search", ownerProfileId: ANA })
    ]);
    assert.equal(await savedCount(ANA, companies[1]), 1);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_deals WHERE workspace_id = $1 AND establishment_id = $2`, [ana.workspace.id, companies[1]]), 1);
  });

  // 3
  test("enviar ao CRM um lead já salvo reaproveita o registro e não sobrescreve dados manuais", async () => {
    await db.query(`INSERT INTO saved_establishments (profile_id, establishment_id, notes, stage) VALUES ($1, $2, 'Nota manual da Ana', 'qualified')`, [ANA, companies[2]]);
    const ana = await asUser(users.ana);
    const result = await repo.createDeals(ana, [companies[2]], { source: "prospecting", ownerProfileId: ANA });
    assert.equal(result.created, 1);
    assert.equal(result.savedNew, 0);
    const { rows } = await db.query<{ notes: string; stage: string; n: number }>(
      `SELECT notes, stage, (SELECT count(*)::int FROM saved_establishments WHERE profile_id = $1 AND establishment_id = $2) AS n FROM saved_establishments WHERE profile_id = $1 AND establishment_id = $2`,
      [ANA, companies[2]]
    );
    assert.equal(rows[0].n, 1);
    assert.equal(rows[0].notes, "Nota manual da Ana");
    assert.equal(rows[0].stage, "qualified");
  });

  // 4
  test("cadastro manual sem CNPJ usa identificador interno estável e não vai para leads salvos", async () => {
    const ana = await asUser(users.ana);
    const before = await count(`SELECT count(*)::int AS n FROM saved_establishments WHERE profile_id = $1`, [ANA]);
    const created = await repo.createManualDeal(ana, prospect({ kind: "company", name: "Padaria Fictícia", origin: "referral", whatsapp: "(41) 99999-0001" }), dealFields());
    const deal = await repo.getDeal(ana, created.dealId);
    assert.ok(deal?.prospectId);
    assert.equal(deal?.establishmentId, null);
    assert.equal(await count(`SELECT count(*)::int AS n FROM saved_establishments WHERE profile_id = $1`, [ANA]), before);
  });

  test("cadastro manual vinculado a empresa da base também garante o lead salvo", async () => {
    const ana = await asUser(users.ana);
    // Empresa só fica visível para vínculo depois de liberada (aqui: salva pelo usuário).
    await db.query(`INSERT INTO saved_establishments (profile_id, establishment_id) VALUES ($1, $2)`, [ANA, companies[3]]);
    // CNPJ fictício com dígitos verificadores válidos (o formulário valida o documento).
    await db.query(`UPDATE establishments SET cnpj = '98765432000198' WHERE id = $1`, [companies[3]]);
    const { rows } = await db.query<{ cnpj: string }>(`SELECT cnpj FROM establishments WHERE id = $1`, [companies[3]]);
    const created = await repo.createManualDeal(ana, prospect({ kind: "company", name: "Empresa Teste 3", document: rows[0].cnpj, origin: "buscacnae" }), dealFields(), { linkEstablishmentId: companies[3] });
    assert.equal(created.linked, true);
    assert.equal(await savedCount(ANA, companies[3]), 1);
  });

  // 5 e 8
  test("excluir da listagem um prospect sem histórico mantém o lead salvo", async () => {
    const ana = await asUser(users.ana);
    const deal = await repo.getDealByEstablishment(ana, companies[0]);
    assert.ok(deal);
    const result = await repo.deleteDeals(ana, [deal.id]);
    assert.deepEqual(result.done, [deal.id]);
    assert.equal(await repo.getDeal(ana, deal.id), null);
    assert.equal(await savedCount(ANA, companies[0]), 1, "o lead salvo permanece após remover o vínculo com o CRM");
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_activities WHERE workspace_id = $1 AND establishment_id = $2 AND type = 'deal.deleted'`, [ana.workspace.id, companies[0]]), 1);
  });

  // 6
  test("exclusão em lote remove vários prospects e relata ids inválidos sem falhar", async () => {
    const ana = await asUser(users.ana);
    const sent = await repo.createDeals(ana, [companies[4], companies[5]], { source: "search", ownerProfileId: ANA });
    const manual = await repo.createManualDeal(ana, prospect({ kind: "person", name: "Pessoa Fictícia", origin: "event" }), dealFields());
    const ids = [...sent.dealIds, manual.dealId, "00000000-0000-4000-8000-000000000000"];
    const result = await repo.deleteDeals(ana, ids);
    assert.equal(result.done.length, 3);
    assert.deepEqual(result.notFound, ["00000000-0000-4000-8000-000000000000"]);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_prospects WHERE workspace_id = $1 AND name = 'Pessoa Fictícia'`, [ana.workspace.id]), 0);
    assert.equal(await savedCount(ANA, companies[4]), 1);
    assert.equal(await savedCount(ANA, companies[5]), 1);
    await expectCrmError(repo.deleteDeals(ana, []), "invalid");
  });

  // 7
  test("prospect com histórico comercial: exclusão é recusada e o arquivamento preserva tudo", async () => {
    const ana = await asUser(users.ana);
    const created = await repo.createDeals(ana, [companies[6]], { source: "search", ownerProfileId: ANA });
    const dealId = created.dealIds[0];
    await repo.addNote(ana, dealId, "Cliente pediu proposta");
    await repo.logInteraction(ana, dealId, { channel: "call", outcome: "done", occurredAt: null, summary: "Ligação feita", completeNextContact: false });
    const historyBefore = await count(`SELECT count(*)::int AS n FROM crm_activities WHERE deal_id = $1`, [dealId]);

    const refused = await repo.deleteDeals(ana, [dealId]);
    assert.deepEqual(refused.hasHistory, [dealId]);
    assert.ok(await repo.getDeal(ana, dealId), "não excluiu");

    const archived = await repo.setDealsArchived(ana, [dealId], true);
    assert.deepEqual(archived.done, [dealId]);
    const active = await repo.listDeals(ana);
    assert.ok(!active.some((deal) => deal.id === dealId), "arquivado sai da listagem padrão");
    const onlyArchived = await repo.listDeals(ana, { archived: "archived" });
    assert.deepEqual(onlyArchived.map((deal) => deal.id), [dealId]);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_notes WHERE deal_id = $1`, [dealId]), 1);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_activities WHERE deal_id = $1`, [dealId]), historyBefore + 1);
    assert.equal(await savedCount(ANA, companies[6]), 1, "arquivar não remove dos leads salvos");

    // Reenviar ao CRM restaura o negócio arquivado em vez de duplicar.
    const resent = await repo.createDeals(ana, [companies[6]], { source: "map", ownerProfileId: ANA });
    assert.equal(resent.created, 0);
    assert.equal(resent.restored, 1);
    assert.equal((await repo.getDeal(ana, dealId))?.archivedAt, null);
    const last = await repo.getDeal(ana, dealId);
    assert.ok(last?.lastInteractionAt, "última interação visível na listagem");

    // Exclusão explícita (force) continua possível para quem tem permissão.
    const forced = await repo.deleteDeals(ana, [dealId], { force: true });
    assert.deepEqual(forced.done, [dealId]);
  });

  // 9
  test("isolamento entre contas: outro usuário não vê, não arquiva nem exclui; leads salvos são por usuário", async () => {
    const ana = await asUser(users.ana);
    const carla = await asUser(users.carla);
    const created = await repo.createDeals(ana, [companies[7]], { source: "search", ownerProfileId: ANA });
    const dealId = created.dealIds[0];
    assert.ok(!(await repo.listDeals(carla)).some((deal) => deal.id === dealId));
    const archive = await repo.setDealsArchived(carla, [dealId], true);
    assert.deepEqual(archive.notFound, [dealId]);
    const removal = await repo.deleteDeals(carla, [dealId], { force: true });
    assert.deepEqual(removal.notFound, [dealId]);
    assert.ok(await repo.getDeal(ana, dealId));
    // O envio da Carla cria o negócio NO workspace dela e o lead salvo DELA, sem tocar os da Ana.
    const own = await repo.createDeals(carla, [companies[7]], { source: "search", ownerProfileId: CARLA });
    assert.equal(own.created, 1);
    assert.equal(await savedCount(CARLA, companies[7]), 1);
    assert.equal(await savedCount(ANA, companies[7]), 1);
  });

  test("permissões em equipe: membro não exclui nem arquiva negócio de outro responsável", async () => {
    const teamId = await repo.createTeamWorkspace(ANA, "Equipe Teste");
    const anaTeam = await asUser(users.ana, teamId);
    await repo.addMemberByEmail(anaTeam, users.bruno.email, "member");
    const brunoTeam = await asUser(users.bruno, teamId);
    const created = await repo.createDeals(anaTeam, [companies[5]], { source: "search", ownerProfileId: ANA });
    const dealId = created.dealIds[0];
    assert.deepEqual((await repo.deleteDeals(brunoTeam, [dealId])).forbidden, [dealId]);
    assert.deepEqual((await repo.setDealsArchived(brunoTeam, [dealId], true)).forbidden, [dealId]);
    assert.deepEqual((await repo.moveDeals(brunoTeam, [dealId], (await repo.listStages(brunoTeam))[1].id)).forbidden, [dealId]);
    // O lead salvo de quem enviou é o da Ana, não o do Bruno.
    assert.equal(await savedCount(BRUNO, companies[5]), 0);
  });

  // 11
  test("filtros: etapa, período de entrada, busca por telefone/contato e situação", async () => {
    const ana = await asUser(users.ana);
    const stages = await repo.listStages(ana);
    const created = await repo.createManualDeal(
      ana,
      prospect({ kind: "company", name: "Oficina Exemplo", origin: "phone", contactName: "Joana Teste", phone: "(41) 3333-1234", email: "joana@exemplo.test" }),
      dealFields()
    );
    await repo.moveDeals(ana, [created.dealId], stages[1].id);
    assert.ok((await repo.listDeals(ana, { stageId: stages[1].id })).some((deal) => deal.id === created.dealId));
    assert.ok(!(await repo.listDeals(ana, { stageId: stages[0].id })).some((deal) => deal.id === created.dealId));
    assert.ok((await repo.listDeals(ana, { q: "3333-1234" })).some((deal) => deal.id === created.dealId), "telefone");
    assert.ok((await repo.listDeals(ana, { q: "Joana" })).some((deal) => deal.id === created.dealId), "nome do contato");
    assert.ok((await repo.listDeals(ana, { q: "joana@exemplo" })).some((deal) => deal.id === created.dealId), "e-mail");
    const cnpjDeal = await repo.getDealByEstablishment(ana, companies[2]);
    const { rows } = await db.query<{ cnpj: string }>(`SELECT cnpj FROM establishments WHERE id = $1`, [companies[2]]);
    assert.ok((await repo.listDeals(ana, { q: rows[0].cnpj })).some((deal) => deal.id === cnpjDeal?.id), "CNPJ");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    assert.ok((await repo.listDeals(ana, { createdFrom: today, createdTo: today })).some((deal) => deal.id === created.dealId));
    assert.equal((await repo.listDeals(ana, { createdTo: "2000-01-01" })).length, 0);
    const listed = (await repo.listDeals(ana)).find((deal) => deal.id === created.dealId);
    assert.equal(listed?.contactEmail, "joana@exemplo.test");
    assert.equal(listed?.contactName, "Joana Teste");
  });

  // 13
  test("indicadores do resumo refletem os dados reais do banco", async () => {
    const ana = await asUser(users.ana);
    const stages = await repo.listStages(ana);
    const won = stages.find((stage) => stage.kind === "won");
    const lost = stages.find((stage) => stage.kind === "lost");
    const proposal = stages.find((stage) => /propost/i.test(stage.name));
    assert.ok(won && lost && proposal);
    const a = await repo.createManualDeal(ana, prospect({ kind: "company", name: "Indicador A", origin: "manual" }), dealFields({ amountCents: 100_00 }));
    const b = await repo.createManualDeal(ana, prospect({ kind: "company", name: "Indicador B", origin: "manual" }), dealFields({ amountCents: 250_00 }));
    const c = await repo.createManualDeal(ana, prospect({ kind: "company", name: "Indicador C", origin: "manual" }), dealFields());
    await repo.moveDeals(ana, [a.dealId], proposal.id);
    await repo.moveDeals(ana, [b.dealId], won.id);
    await repo.moveDeals(ana, [c.dealId], lost.id);

    const deals = await repo.listDeals(ana);
    const summary = metrics.summarizePipeline(deals, stages, Date.now(), { periodStart: Date.now() - 86_400_000 });
    const kindOf = (deal: { stageId: string }) => stages.find((stage) => stage.id === deal.stageId)?.kind;
    assert.equal(summary.won, deals.filter((deal) => kindOf(deal) === "won").length);
    assert.equal(summary.lost, deals.filter((deal) => kindOf(deal) === "lost").length);
    assert.equal(summary.open, deals.filter((deal) => kindOf(deal) === "open").length);
    assert.equal(summary.proposalsPending, deals.filter((deal) => deal.stageId === proposal.id).length);
    assert.equal(summary.openValueCents, deals.filter((deal) => kindOf(deal) === "open").reduce((sum, deal) => sum + (deal.amountCents ?? 0), 0));
    assert.equal(summary.newInPeriod, deals.length, "todos entraram hoje");
    assert.equal(summary.conversionRate, Math.round((summary.won / (summary.won + summary.lost)) * 100));
    // Arquivados não entram nos indicadores (a consulta padrão os exclui).
    await repo.setDealsArchived(ana, [a.dealId], true);
    const after = metrics.summarizePipeline(await repo.listDeals(ana), stages, Date.now());
    assert.equal(after.proposalsPending, summary.proposalsPending - 1);
  });

  test("revisão Codex: UUID de empresa não liberada não entra no CRM nem nos leads salvos", async () => {
    const carla = await asUser(users.carla);
    const { rows } = await db.query<{ id: string }>(`INSERT INTO establishments (cnpj, company_name) VALUES ('55444333000122', 'Empresa Não Liberada') RETURNING id`);
    const hidden = rows[0].id;
    const result = await repo.createDeals(carla, [hidden], { source: "search", ownerProfileId: CARLA, requireVisible: true });
    assert.equal(result.requested, 0);
    assert.equal(await savedCount(CARLA, hidden), 0);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_deals WHERE establishment_id = $1`, [hidden]), 0);
    // Depois de salva pelo próprio usuário, a mesma empresa passa.
    await db.query(`INSERT INTO saved_establishments (profile_id, establishment_id) VALUES ($1, $2)`, [CARLA, hidden]);
    assert.equal((await repo.createDeals(carla, [hidden], { source: "search", ownerProfileId: CARLA, requireVisible: true })).created, 1);
  });

  test("revisão Codex: exclusão individual com histórico exige confirmação (checagem na transação)", async () => {
    const ana = await asUser(users.ana);
    const created = await repo.createManualDeal(ana, prospect({ kind: "company", name: "Com Histórico", origin: "manual" }), dealFields());
    await repo.addNote(ana, created.dealId, "Reunião marcada");
    await expectCrmError(repo.deleteDeal(ana, created.dealId), "conflict");
    assert.ok(await repo.getDeal(ana, created.dealId), "nada foi apagado (transação desfeita)");
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_notes WHERE deal_id = $1`, [created.dealId]), 1);
    await repo.deleteDeal(ana, created.dealId, { force: true });
    assert.equal(await repo.getDeal(ana, created.dealId), null);
  });

  test("revisão Codex: arquivar duas vezes não gera evento duplicado", async () => {
    const ana = await asUser(users.ana);
    const created = await repo.createManualDeal(ana, prospect({ kind: "company", name: "Arquivo Duplo", origin: "manual" }), dealFields());
    await Promise.all([repo.setDealsArchived(ana, [created.dealId], true), repo.setDealsArchived(ana, [created.dealId], true)]);
    assert.equal(await count(`SELECT count(*)::int AS n FROM crm_activities WHERE deal_id = $1 AND type = 'deal.archived'`, [created.dealId]), 1);
  });

  test("migração garante unicidade dos leads salvos sem apagar dados", async () => {
    const legacy = new PGlite({ extensions: { pgcrypto } });
    await legacy.exec(BASE_SCHEMA.replace("UNIQUE (profile_id, establishment_id)", "list_id UUID"));
    await legacy.exec(sqlFile("neon_crm.sql"));
    await legacy.exec(sqlFile("neon_crm_prospects.sql"));
    await legacy.exec(sqlFile("neon_crm_gestao.sql"));
    const { rows } = await legacy.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'saved_establishments_profile_establishment_uidx'`);
    assert.equal(Number(rows[0].n), 1);
    await legacy.close();

    const dirty = new PGlite({ extensions: { pgcrypto } });
    await dirty.exec(BASE_SCHEMA.replace("UNIQUE (profile_id, establishment_id)", "list_id UUID"));
    const { rows: est } = await dirty.query<{ id: string }>(`INSERT INTO establishments (cnpj) VALUES ('1') RETURNING id`);
    await dirty.query(`INSERT INTO saved_establishments (profile_id, establishment_id) VALUES ($1, $2), ($1, $2)`, [ANA, est[0].id]);
    await dirty.exec(sqlFile("neon_crm.sql"));
    await dirty.exec(sqlFile("neon_crm_prospects.sql"));
    await dirty.exec(sqlFile("neon_crm_gestao.sql"));
    const { rows: kept } = await dirty.query<{ n: number }>(`SELECT count(*)::int AS n FROM saved_establishments`);
    assert.equal(Number(kept[0].n), 2, "duplicatas antigas preservadas; só não cria o índice");
    await dirty.close();
  });

  test("migração da Fase 9 tem reversão segura", async () => {
    await assert.rejects(db.exec(sqlFile("neon_crm_gestao_rollback.sql")), /Reversão abortada/);
    await db.exec("ROLLBACK").catch(() => undefined);
    const clean = new PGlite({ extensions: { pgcrypto } });
    await clean.exec(BASE_SCHEMA);
    await clean.exec(sqlFile("neon_crm.sql"));
    await clean.exec(sqlFile("neon_crm_prospects.sql"));
    await clean.exec(sqlFile("neon_crm_gestao.sql"));
    await clean.exec(sqlFile("neon_crm_gestao_rollback.sql"));
    const { rows } = await clean.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'crm_deals' AND column_name = 'archived_at'`);
    assert.equal(Number(rows[0].n), 0);
    await clean.exec(sqlFile("neon_crm_gestao.sql"));
    await clean.close();
  });
});

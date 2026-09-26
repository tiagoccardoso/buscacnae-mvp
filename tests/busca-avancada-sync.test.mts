import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * Fase 7 — sincronização banco → índice (PostgreSQL real em memória via PGlite + Meilisearch simulado).
 *
 * Valida a migração sql/neon_search_index.sql (gatilhos/fila), a visibilidade (prévia não paga
 * não entra; lista liberada, salvos e CRM entram), atualização, exclusão, expiração de dados
 * desatualizados, entrega "pelo menos uma vez" com o índice fora do ar, reindexação completa
 * com troca atômica, saúde/consistência e o fallback de busca no banco.
 */
process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";
process.env.MEILISEARCH_URL = "http://fake-meili.test";
process.env.MEILISEARCH_ADMIN_KEY = "admin-key";
process.env.SEARCH_COMPANY_INDEX_ENABLED = "true";
(globalThis as { fetch: unknown }).fetch = async () => {
  throw new Error("rede desabilitada nos testes");
};

const { setQueryExecutorForTests } = await import("../lib/db.ts");
const { createMeiliClient, resetSearchEngineCircuitBreakers } = await import("../lib/search/meilisearch.ts");
const sync = await import("../lib/search/sync.ts");
const { searchCompaniesInDatabase } = await import("../lib/search/company-fallback.ts");
const { resetVisibilityCache } = await import("../lib/search/visibility.ts");

const INDEX = "buscacnae_companies";
const NOW = Math.floor(Date.UTC(2026, 8, 26, 12) / 1000);
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const W = "cccccccc-0000-4000-8000-00000000000c";
const S1 = "dddddddd-0000-4000-8000-00000000000d";
const S2 = "eeeeeeee-0000-4000-8000-00000000000e";

type Doc = Record<string, unknown> & { id: string };

/** Meilisearch em memória: só os endpoints usados pela sincronização. */
function createFakeMeili() {
  const indexes = new Map<string, Map<string, Doc>>();
  const tasks = new Map<number, Record<string, unknown>>();
  let nextTask = 1;
  const state = { down: false, calls: 0 };
  const enqueue = (details: Record<string, unknown>) => {
    const uid = nextTask++;
    tasks.set(uid, { uid, status: "succeeded", details });
    return Response.json({ taskUid: uid, status: "enqueued" }, { status: 202 });
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    state.calls += 1;
    if (state.down) throw new TypeError("ECONNREFUSED");
    const { pathname } = new URL(url);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    let match: RegExpMatchArray | null;
    if ((match = pathname.match(/^\/tasks\/(\d+)$/))) return Response.json(tasks.get(Number(match[1])));
    if (pathname === "/health") return Response.json({ status: "available" });
    if (pathname === "/indexes" && method === "POST") {
      if (!indexes.has(body.uid)) indexes.set(body.uid, new Map());
      return enqueue({});
    }
    if (pathname === "/swap-indexes") {
      const [left, right] = body[0].indexes as [string, string];
      const leftDocs = indexes.get(left) ?? new Map();
      indexes.set(left, indexes.get(right) ?? new Map());
      indexes.set(right, leftDocs);
      return enqueue({});
    }
    if ((match = pathname.match(/^\/indexes\/([^/]+)$/))) {
      if (method === "DELETE") {
        indexes.delete(match[1]);
        return enqueue({});
      }
      return indexes.has(match[1])
        ? Response.json({ uid: match[1], primaryKey: "id" })
        : Response.json({ message: "not found", code: "index_not_found" }, { status: 404 });
    }
    if ((match = pathname.match(/^\/indexes\/([^/]+)\/settings$/))) return enqueue({});
    if ((match = pathname.match(/^\/indexes\/([^/]+)\/stats$/))) {
      return Response.json({ numberOfDocuments: indexes.get(match[1])?.size ?? 0, isIndexing: false });
    }
    const docs = (uid: string) => {
      if (!indexes.has(uid)) indexes.set(uid, new Map());
      return indexes.get(uid)!;
    };
    if ((match = pathname.match(/^\/indexes\/([^/]+)\/documents$/)) && method === "POST") {
      for (const doc of body as Doc[]) docs(match[1]).set(doc.id, doc);
      return enqueue({ receivedDocuments: body.length });
    }
    if ((match = pathname.match(/^\/indexes\/([^/]+)\/documents\/delete-batch$/))) {
      for (const id of body as string[]) docs(match[1]).delete(id);
      return enqueue({ deletedDocuments: body.length });
    }
    if ((match = pathname.match(/^\/indexes\/([^/]+)\/documents\/delete$/))) {
      const limit = Number(String(body.filter).match(/expiresAt <= (\d+)/)?.[1]);
      let deleted = 0;
      for (const [id, doc] of docs(match[1])) {
        if (Number(doc.expiresAt) <= limit) {
          docs(match[1]).delete(id);
          deleted += 1;
        }
      }
      return enqueue({ deletedDocuments: deleted });
    }
    return Response.json({ message: `inesperado ${method} ${pathname}` }, { status: 400 });
  }) as typeof fetch;
  return { indexes, state, client: createMeiliClient({ url: "http://fake-meili.test", apiKey: "admin-key", fetchImpl, timeoutMs: 1000 }) };
}

const BASE_SCHEMA = `
  CREATE TABLE profiles (id UUID PRIMARY KEY, email TEXT);
  CREATE TABLE establishments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cnpj TEXT UNIQUE, cnpj_root TEXT, company_name TEXT, trade_name TEXT, registration_status TEXT, opened_at TEXT,
    primary_cnae_code TEXT, primary_cnae_description TEXT, secondary_cnaes JSONB, company_size TEXT,
    email TEXT, phone TEXT, website TEXT, state_code TEXT, city_name TEXT, city_ibge TEXT, neighborhood TEXT, cep TEXT,
    address_line TEXT, capital_social NUMERIC, provider_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE search_results (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), search_query_id UUID, profile_id UUID, establishment_id UUID, position INT);
  CREATE TABLE search_access_orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), search_query_id UUID, profile_id UUID, status TEXT);
  CREATE TABLE saved_establishments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), profile_id UUID, establishment_id UUID, list_id UUID);
  CREATE TABLE crm_workspace_members (workspace_id UUID, profile_id UUID, role TEXT);
  CREATE TABLE crm_deals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id UUID, establishment_id UUID);
`;

let db: PGlite;
const ids: Record<string, string> = {};
const fetchedAt = (daysAgo: number) => new Date((NOW - daysAgo * 86_400) * 1000).toISOString();

async function insertCompany(key: string, values: Record<string, unknown>) {
  const columns = Object.keys(values);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO establishments (${columns.join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
    columns.map((column) => (column === "provider_payload" || column === "secondary_cnaes" ? JSON.stringify(values[column]) : values[column]))
  );
  ids[key] = rows[0].id;
  return rows[0].id;
}

async function outboxCount() {
  const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM search_index_outbox`);
  return rows[0].n;
}

const fake = createFakeMeili();
const deps = () => ({ client: fake.client, indexUid: INDEX, nowEpoch: NOW, ttlDays: 90, batchSize: 2 });
const indexed = () => fake.indexes.get(INDEX) ?? new Map<string, Doc>();

describe("sincronização do índice (PGlite)", () => {
  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(BASE_SCHEMA);
    await db.exec(readFileSync(new URL("../sql/neon_search_index.sql", import.meta.url), "utf8"));
    // Idempotente: aplicar duas vezes não quebra nem duplica gatilhos.
    await db.exec(readFileSync(new URL("../sql/neon_search_index.sql", import.meta.url), "utf8"));
    await db.query(`INSERT INTO profiles (id, email) VALUES ($1, 'a@x.com'), ($2, 'b@x.com')`, [A, B]);
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
    resetVisibilityCache();
    resetSearchEngineCircuitBreakers();

    await insertCompany("transp", {
      cnpj: "11222333000181",
      company_name: "TRANSPORTADORA ZANELLA LTDA",
      trade_name: "Zanella Cargas",
      registration_status: "ATIVA",
      opened_at: "2010-03-01",
      primary_cnae_code: "4930202",
      primary_cnae_description: "Transporte rodoviário de carga, intermunicipal",
      company_size: "EPP",
      email: "contato@zanella.com.br",
      phone: "(46) 3225-0000",
      state_code: "PR",
      city_name: "Pato Branco",
      city_ibge: "4118501",
      provider_payload: { casadosdados_detalhe_em: fetchedAt(2) }
    });
    await insertCompany("padaria", {
      cnpj: "44555666000102",
      company_name: "PADARIA CONCEIÇÃO LTDA",
      trade_name: "Pão da Conceição",
      registration_status: "ATIVA",
      primary_cnae_code: "4721102",
      primary_cnae_description: "Padaria e confeitaria com predominância de revenda",
      company_size: "ME",
      state_code: "SP",
      city_name: "São Paulo",
      city_ibge: "3550308",
      provider_payload: { casadosdados_detalhe_em: fetchedAt(5) }
    });
    await insertCompany("mei", {
      cnpj: "77888999000160",
      company_name: "MARIA SOUZA 12345678901",
      trade_name: "Studio Maria",
      registration_status: "ATIVA",
      primary_cnae_code: "9602501",
      primary_cnae_description: "Cabeleireiros, manicure e pedicure",
      company_size: "ME",
      state_code: "SC",
      city_name: "Joinville",
      city_ibge: "4209102",
      provider_payload: { casadosdados_detalhe_em: fetchedAt(1) }
    });
  });

  test("gravação em establishments entra na fila na mesma transação", async () => {
    assert.equal(await outboxCount(), 3);
  });

  test("prévia NÃO paga não é indexada; ninguém vê empresa sem acesso", async () => {
    await db.query(`INSERT INTO search_results (search_query_id, profile_id, establishment_id, position) VALUES ($1, $2, $3, 1), ($1, $2, $4, 2)`, [
      S1,
      A,
      ids.transp,
      ids.padaria
    ]);
    await db.query(`INSERT INTO search_access_orders (search_query_id, profile_id, status) VALUES ($1, $2, 'pending')`, [S1, A]);
    const result = await sync.drainSearchOutbox(deps());
    assert.equal(result.processedEvents, 3);
    assert.equal(result.upserted, 0);
    assert.equal(indexed().size, 0);
    assert.equal(await outboxCount(), 0);
  });

  test("pedido liberado → empresas da busca entram, só para quem comprou", async () => {
    await db.query(`UPDATE search_access_orders SET status = 'paid' WHERE search_query_id = $1`, [S1]);
    assert.equal(await outboxCount(), 2);
    await sync.drainSearchOutbox(deps());
    assert.deepEqual(Array.from(indexed().keys()).sort(), ["11222333000181", "44555666000102"]);
    const doc = indexed().get("11222333000181")!;
    assert.deepEqual(doc.profileIds, [A]);
    assert.equal(doc.city, "Pato Branco");
    // Contato (produto pago) e payload nunca vão para o índice.
    assert.equal(JSON.stringify(doc).includes("zanella.com.br"), false);
    assert.equal(JSON.stringify(doc).includes("3225"), false);
  });

  test("empresa salva e negócio no CRM concedem visibilidade (usuário e workspace)", async () => {
    await db.query(`INSERT INTO saved_establishments (profile_id, establishment_id) VALUES ($1, $2)`, [B, ids.mei]);
    await db.query(`INSERT INTO crm_deals (workspace_id, establishment_id) VALUES ($1, $2)`, [W, ids.mei]);
    await sync.drainSearchOutbox(deps());
    const doc = indexed().get("77888999000160")!;
    assert.deepEqual(doc.profileIds, [B]);
    assert.deepEqual(doc.workspaceIds, [W]);
    assert.equal(doc.legalName, "MARIA SOUZA", "CPF do MEI não é indexado");
  });

  test("atualização na origem reflete no índice (documento inteiro substituído)", async () => {
    await db.query(`UPDATE establishments SET trade_name = NULL, registration_status = 'BAIXADA' WHERE id = $1`, [ids.transp]);
    await sync.drainSearchOutbox(deps());
    const doc = indexed().get("11222333000181")!;
    assert.equal(doc.tradeName, null);
    assert.equal(doc.registrationStatus, "BAIXADA");
  });

  test("mudança que não afeta a busca não enfileira (gatilho por coluna)", async () => {
    await db.query(`UPDATE establishments SET email = 'novo@x.com' WHERE id = $1`, [ids.transp]);
    assert.equal(await outboxCount(), 0);
  });

  test("índice fora do ar: sincronização falha, fila preservada, estado registra o erro", async () => {
    await db.query(`UPDATE establishments SET company_name = 'TRANSPORTADORA ZANELLA E FILHOS LTDA' WHERE id = $1`, [ids.transp]);
    fake.state.down = true;
    resetSearchEngineCircuitBreakers();
    await assert.rejects(sync.drainSearchOutbox(deps()));
    assert.equal(await outboxCount(), 1);
    const { rows } = await db.query<{ last_error: string | null }>(`SELECT last_error FROM search_index_state WHERE index_uid = $1`, [INDEX]);
    assert.match(rows[0].last_error ?? "", /unavailable|circuit_open/);
    fake.state.down = false;
    resetSearchEngineCircuitBreakers();
    const result = await sync.drainSearchOutbox(deps());
    assert.equal(result.remaining, 0);
    assert.equal(indexed().get("11222333000181")!.legalName, "TRANSPORTADORA ZANELLA E FILHOS LTDA");
    const state = await db.query<{ last_error: string | null }>(`SELECT last_error FROM search_index_state WHERE index_uid = $1`, [INDEX]);
    assert.equal(state.rows[0].last_error, null, "sucesso posterior limpa o erro");
  });

  test("dado desatualizado (consulta à fonte além da validade) sai do índice", async () => {
    await db.query(`UPDATE establishments SET provider_payload = $1 WHERE id = $2`, [
      JSON.stringify({ casadosdados_detalhe_em: fetchedAt(200) }),
      ids.padaria
    ]);
    await db.query(`UPDATE establishments SET updated_at = $1, created_at = $1 WHERE id = $2`, [fetchedAt(200), ids.padaria]);
    await sync.drainSearchOutbox(deps());
    assert.equal(indexed().has("44555666000102"), false);
  });

  test("expiração periódica remove o que venceu desde a última gravação", async () => {
    const before = indexed().size;
    const later = await sync.purgeExpiredDocuments({ ...deps(), nowEpoch: NOW + 120 * 86_400 });
    assert.equal(later.deleted, before);
    assert.equal(indexed().size, 0);
  });

  test("perda de acesso e exclusão na origem removem do índice", async () => {
    await sync.reindexAllCompanies(deps());
    assert.ok(indexed().has("77888999000160"));
    await db.query(`DELETE FROM saved_establishments WHERE profile_id = $1`, [B]);
    await sync.drainSearchOutbox(deps());
    assert.deepEqual(indexed().get("77888999000160")!.profileIds, [], "ainda visível pelo CRM");
    await db.query(`DELETE FROM crm_deals WHERE establishment_id = $1`, [ids.mei]);
    await sync.drainSearchOutbox(deps());
    assert.equal(indexed().has("77888999000160"), false);

    await db.query(`DELETE FROM search_results WHERE establishment_id = $1`, [ids.transp]);
    await db.query(`DELETE FROM establishments WHERE id = $1`, [ids.transp]);
    await sync.drainSearchOutbox(deps());
    assert.equal(indexed().has("11222333000181"), false);
  });

  test("reindexação completa reconstrói à parte e troca de forma atômica", async () => {
    const companyId = await insertCompany("nova", {
      cnpj: "12121212000112",
      company_name: "LOGISTICA NOVA ERA LTDA",
      primary_cnae_code: "5250804",
      state_code: "MG",
      city_name: "Nova Era",
      city_ibge: "3145000",
      provider_payload: { casadosdados_detalhe_em: fetchedAt(3) }
    });
    await db.query(`INSERT INTO search_results (search_query_id, profile_id, establishment_id, position) VALUES ($1, $2, $3, 1)`, [S2, A, companyId]);
    await db.query(`INSERT INTO search_access_orders (search_query_id, profile_id, status) VALUES ($1, $2, 'free')`, [S2, A]);
    // Índice ativo com lixo que a reconstrução deve descartar.
    fake.indexes.get(INDEX)!.set("00000000000000", { id: "00000000000000", expiresAt: NOW + 999 });
    const result = await sync.reindexAllCompanies(deps());
    assert.equal(result.indexed, 1);
    assert.deepEqual(Array.from(indexed().keys()), ["12121212000112"]);
    assert.equal(fake.indexes.has(`${INDEX}_rebuild`), false);
    assert.equal(await outboxCount(), 0);
  });

  test("saúde: atraso da fila e última sincronização", async () => {
    await db.query(`UPDATE establishments SET trade_name = 'Nova Era Log' WHERE id = $1`, [ids.nova]);
    const health = await sync.getSearchIndexHealth({ client: fake.client, indexUid: INDEX });
    assert.equal(health.engine, "available");
    assert.equal(health.documents, 1);
    assert.equal(health.outboxBacklog, 1);
    assert.ok(health.lastSyncAt);
    assert.ok(health.lastFullReindexAt);
    assert.equal(health.companyIndexEnabled, true);
  });
});

after(() => setQueryExecutorForTests(null));

describe("fallback de busca no banco (PGlite)", () => {
  test("mesma visibilidade, acentos, CNPJ, filtros, facetas e validade", async () => {
    const scopeA = { profileId: A, workspaceIds: [] };
    // Pedido S1 pago: A vê a padaria (a transportadora foi excluída no teste anterior).
    await db.query(`UPDATE establishments SET provider_payload = $1, updated_at = $2 WHERE id = $3`, [
      JSON.stringify({ casadosdados_detalhe_em: fetchedAt(4) }),
      fetchedAt(4),
      ids.padaria
    ]);
    const accents = await searchCompaniesInDatabase({ q: "padaria conceicao", scope: scopeA, ttlDays: 90, nowEpoch: NOW });
    assert.equal(accents.engine, "database");
    assert.equal(accents.degraded, true);
    assert.deepEqual(accents.hits.map((hit) => hit.cnpj), ["44555666000102"]);
    assert.deepEqual(accents.facets.stateCode, { SP: 1 });

    const byCnpj = await searchCompaniesInDatabase({ q: "44555", scope: scopeA, ttlDays: 90, nowEpoch: NOW });
    assert.equal(byCnpj.hits.length, 1);
    const filtered = await searchCompaniesInDatabase({ q: "", scope: scopeA, filters: { stateCodes: ["PR"] }, ttlDays: 90, nowEpoch: NOW });
    assert.equal(filtered.hits.some((hit) => hit.stateCode !== "PR"), false);

    // B não comprou nada e não tem salvos: não vê nada.
    const other = await searchCompaniesInDatabase({ q: "padaria", scope: { profileId: B, workspaceIds: [] }, ttlDays: 90, nowEpoch: NOW });
    assert.equal(other.hits.length, 0);

    // Dado da fonte mais antigo que a validade: não é servido (mesma regra do índice).
    const stale = await searchCompaniesInDatabase({ q: "padaria", scope: scopeA, ttlDays: 2, nowEpoch: NOW });
    assert.equal(stale.hits.length, 0);

    // Sem tolerância a erro no fallback (comportamento documentado).
    const typo = await searchCompaniesInDatabase({ q: "padraia", scope: scopeA, ttlDays: 90, nowEpoch: NOW });
    assert.equal(typo.hits.length, 0);
  });
});

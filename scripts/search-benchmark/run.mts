/**
 * Benchmark da Busca Avançada (Fase 7) — ANTES × DEPOIS.
 *
 *   npx tsx scripts/search-benchmark/run.mts [--size 100000] [--meili http://127.0.0.1:7700] [--key MASTER] [--out arquivo.json]
 *
 * Motores comparados sobre a MESMA base sintética e o MESMO conjunto de consultas:
 *   A. atual      — filtro "todos os termos, sem acento" usado hoje na tabela de resultados (em memória).
 *   B. pg_trgm    — alternativa sem infraestrutura nova: PostgreSQL + unaccent + pg_trgm (PGlite/WASM).
 *   C. meili      — Meilisearch com as configurações de produção (COMPANY_INDEX_SETTINGS), texto cru.
 *   D. meili+plan — C + intérprete local (cidade/UF/CNPJ/CNAE viram filtros) = caminho de produção.
 *
 * Métricas: recall@10, acerto@1, MRR@10, latência p50/p95, tempo de indexação, tamanho do índice,
 * memória (RSS do processo Meilisearch) e tempo de atualização/exclusão/expiração.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { generateCompanies, mulberry32, type BenchCompany } from "./dataset.mts";
import { buildBenchQueries, type BenchQuery } from "./queries.mts";
import { foldSearchText } from "../../lib/search/text.ts";
import { toCompanySearchDocument } from "../../lib/search/company-documents.ts";
import { createMeiliClient } from "../../lib/search/meilisearch.ts";
import {
  deleteCompanyDocuments,
  deleteExpiredCompanyDocuments,
  deleteIndex,
  ensureCompanyIndex,
  replaceCompanyDocuments,
  searchCompanyIndex
} from "../../lib/search/company-index.ts";
import { planCompanyQuery } from "../../lib/search/company-query-plan.ts";
import { interpretQuery } from "../../lib/search/query-understanding.ts";

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const SIZE = Number(arg("size", "100000"));
const MEILI_URL = arg("meili", process.env.MEILISEARCH_URL ?? "http://127.0.0.1:7700");
const MEILI_KEY = arg("key", process.env.MEILISEARCH_ADMIN_KEY ?? "");
const OUT = arg("out", "");
const SKIP_PG = process.argv.includes("--skip-pg");
const PG_URL = arg("pg", "");
const KEEP = process.argv.includes("--keep");
const PROFILE = "bench-profile";
const INDEX_UID = `bench_companies_${SIZE}`;
const TOP_K = 10;

type EngineResult = { cnpjs: string[]; ms: number; serverMs?: number };
type Engine = { name: string; search: (query: BenchQuery) => Promise<EngineResult> };

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function meiliRssMb() {
  try {
    const pid = execSync("pgrep -f 'meilisearch --db-path' | head -1").toString().trim();
    if (!pid) return null;
    const status = execSync(`grep VmRSS /proc/${pid}/status`).toString();
    return Math.round(Number(status.replace(/\D+/g, " ").trim().split(" ")[0]) / 1024);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// A. Comportamento atual (lib/results/company-table-model.ts → subjectMatchesQuery)
// ---------------------------------------------------------------------------
function buildCurrentEngine(rows: BenchCompany[]): Engine {
  const subjects = rows.map((row) => ({
    row,
    haystack: foldSearchText(
      [row.company_name, row.trade_name, row.city_name, row.state_code, row.primary_cnae_code, row.primary_cnae_description].join(" ")
    ),
    name: foldSearchText(row.company_name)
  }));
  return {
    name: "A. atual (filtro da tabela)",
    async search(query) {
      const start = performance.now();
      const folded = foldSearchText(query.q);
      const digits = folded.replace(/[^0-9a-z]/g, "");
      const terms = folded.split(" ").filter(Boolean);
      const matches = subjects.filter(({ row, haystack }) => {
        if (query.stateCodes?.length && !query.stateCodes.includes(row.state_code)) return false;
        if (digits.length >= 4 && /\d/.test(digits) && row.cnpj.toLowerCase().includes(digits)) return true;
        return terms.every((term) => haystack.includes(term));
      });
      // A tabela ordena por razão social por padrão.
      matches.sort((left, right) => left.name.localeCompare(right.name));
      const cnpjs = matches.slice(0, TOP_K).map(({ row }) => row.cnpj);
      return { cnpjs, ms: performance.now() - start };
    }
  };
}

// ---------------------------------------------------------------------------
// B. PostgreSQL + unaccent + pg_trgm
// ---------------------------------------------------------------------------
type PgLike = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(text: string): Promise<unknown>;
  label: string;
};

async function openPostgres(): Promise<PgLike> {
  if (PG_URL) {
    // PostgreSQL nativo (mesma família do Neon): `npm i --no-save pg` para rodar.
    const { default: pg } = (await import("pg" as string)) as { default: { Client: new (options: { connectionString: string }) => { connect(): Promise<void>; query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> } } };
    const client = new pg.Client({ connectionString: PG_URL });
    await client.connect();
    await client.query("DROP TABLE IF EXISTS companies");
    return {
      label: "PostgreSQL nativo",
      query: async <T,>(text: string, params?: unknown[]) => (await client.query(text, params)) as { rows: T[] },
      exec: (text: string) => client.query(text)
    };
  }
  const db = new PGlite({ extensions: { pg_trgm, unaccent } });
  return { label: "PGlite (WASM)", query: (text, params) => db.query(text, params), exec: (text) => db.exec(text) };
}

async function buildPgEngine(rows: BenchCompany[], report: Record<string, unknown>): Promise<Engine> {
  const db = await openPostgres();
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS unaccent;
    CREATE TABLE companies (
      cnpj TEXT PRIMARY KEY, company_name TEXT, trade_name TEXT, city_name TEXT, city_ibge TEXT, state_code TEXT,
      primary_cnae_code TEXT, primary_cnae_description TEXT, search_text TEXT
    );
  `);
  const loadStart = performance.now();
  for (let start = 0; start < rows.length; start += 2000) {
    const part = rows.slice(start, start + 2000);
    const values: unknown[] = [];
    const tuples = part.map((row, index) => {
      const base = index * 9;
      values.push(
        row.cnpj, row.company_name, row.trade_name, row.city_name, row.city_ibge, row.state_code, row.primary_cnae_code, row.primary_cnae_description,
        foldSearchText([row.company_name, row.trade_name, row.city_name, row.state_code, row.primary_cnae_description].join(" "))
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`;
    });
    await db.query(`INSERT INTO companies VALUES ${tuples.join(",")}`, values);
  }
  const loadMs = performance.now() - loadStart;
  const indexStart = performance.now();
  await db.exec(`CREATE INDEX companies_trgm ON companies USING gin (search_text gin_trgm_ops);`);
  await db.exec(`CREATE INDEX companies_cnpj ON companies (cnpj text_pattern_ops);`);
  await db.exec(`CREATE INDEX companies_cnae ON companies (primary_cnae_code);`);
  const indexMs = performance.now() - indexStart;
  const size = await db.query<{ total: number; idx: number }>(
    `SELECT pg_total_relation_size('companies')::float8 AS total, pg_indexes_size('companies')::float8 AS idx`
  );
  await db.exec(`SET pg_trgm.word_similarity_threshold = 0.5;`);
  await db.exec(`ANALYZE companies;`);

  // Atualização: 1.000 linhas (reescreve texto de busca).
  const updateStart = performance.now();
  await db.query(
    `UPDATE companies SET trade_name = COALESCE(trade_name,'') || ' X', search_text = search_text || ' x'
      WHERE cnpj IN (SELECT cnpj FROM companies ORDER BY cnpj LIMIT 1000)`
  );
  const updateMs = performance.now() - updateStart;

  report.pg_trgm = {
    loadMs: Math.round(loadMs),
    indexBuildMs: Math.round(indexMs),
    tableAndIndexesMb: Math.round((size.rows[0].total / 1048576) * 10) / 10,
    indexesMb: Math.round((size.rows[0].idx / 1048576) * 10) / 10,
    update1kMs: Math.round(updateMs),
    engine: db.label,
    note: db.label === "PGlite (WASM)" ? "PGlite (WASM, 1 thread): latência absoluta não representa o Neon." : "PostgreSQL 16 local (sem rede)."
  };

  return {
    name: "B. PostgreSQL pg_trgm + intérprete",
    async search(query) {
      const start = performance.now();
      // Mesmo intérprete do caminho de produção: comparação justa entre motores.
      const plan = planCompanyQuery(query.q, { stateCodes: query.stateCodes });
      const where: string[] = [];
      const params: unknown[] = [];
      const bind = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      if (plan.filters.cnpj) where.push(`cnpj = ${bind(plan.filters.cnpj)}`);
      if (plan.filters.cnpjRoot) where.push(`cnpj LIKE ${bind(`${plan.filters.cnpjRoot}%`)}`);
      if (plan.filters.primaryCnaes?.length) where.push(`primary_cnae_code = ANY(${bind(plan.filters.primaryCnaes)})`);
      if (plan.filters.stateCodes?.length) where.push(`state_code = ANY(${bind(plan.filters.stateCodes)})`);
      let order = "cnpj";
      if (plan.q && /^\d+$/.test(plan.q)) {
        where.push(`cnpj LIKE ${bind(`${plan.q}%`)}`);
      } else if (plan.q) {
        const q = bind(foldSearchText(plan.q));
        where.push(`${q} <% search_text`);
        order = `word_similarity(${q}, search_text) DESC, cnpj`;
      }
      const result = await db.query<{ cnpj: string }>(
        `SELECT cnpj FROM companies ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ${TOP_K}`,
        params
      );
      return { cnpjs: result.rows.map((row) => row.cnpj), ms: performance.now() - start };
    }
  };
}

// ---------------------------------------------------------------------------
// C/D. Meilisearch
// ---------------------------------------------------------------------------
async function buildMeiliEngines(rows: BenchCompany[], report: Record<string, unknown>): Promise<Engine[]> {
  const client = createMeiliClient({ url: MEILI_URL, apiKey: MEILI_KEY, timeoutMs: 30_000 });
  await deleteIndex(client, INDEX_UID).then((uid) => client.waitForTask(uid)).catch(() => null);
  const rssBefore = meiliRssMb();
  const nowEpoch = Math.floor(Date.UTC(2026, 8, 26) / 1000);

  const indexStart = performance.now();
  await ensureCompanyIndex(client, INDEX_UID);
  const docs = rows
    .map((row) => toCompanySearchDocument(row as unknown as Record<string, unknown>, { profileIds: [PROFILE], workspaceIds: [] }, { nowEpoch, ttlDays: 90 }))
    .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc));
  const taskUids: number[] = [];
  for (let start = 0; start < docs.length; start += 10_000) {
    const uid = await replaceCompanyDocuments(client, INDEX_UID, docs.slice(start, start + 10_000));
    if (uid !== null) taskUids.push(uid);
  }
  for (const uid of taskUids) await client.waitForTask(uid, { timeoutMs: 1_800_000 });
  const indexMs = performance.now() - indexStart;
  const stats = await client.request<{ databaseSize: number; usedDatabaseSize?: number; indexes: Record<string, { numberOfDocuments: number }> }>(
    "/stats",
    { timeoutMs: 10_000 }
  );
  const rssAfterIndex = meiliRssMb();

  // Atualização incremental: 1.000 documentos substituídos (sincronização típica).
  const updateDocs = docs.slice(0, 1000).map((doc) => ({ ...doc, tradeName: `${doc.tradeName ?? ""} Atualizada`.trim(), indexedAt: nowEpoch + 1 }));
  let start = performance.now();
  await client.waitForTask((await replaceCompanyDocuments(client, INDEX_UID, updateDocs))!);
  const update1kMs = performance.now() - start;

  // Uma única empresa (latência de visibilidade após gravação).
  start = performance.now();
  await client.waitForTask((await replaceCompanyDocuments(client, INDEX_UID, [{ ...docs[1], legalName: `${docs[1].legalName} ` }]))!);
  const update1Ms = performance.now() - start;

  // Exclusão de 1.000 (empresas que perderam visibilidade) e reinserção para não afetar o recall.
  start = performance.now();
  await client.waitForTask((await deleteCompanyDocuments(client, INDEX_UID, docs.slice(1000, 2000).map((doc) => doc.id)))!);
  const delete1kMs = performance.now() - start;
  await client.waitForTask((await replaceCompanyDocuments(client, INDEX_UID, docs.slice(1000, 2000)))!);

  // Expiração por filtro (nenhum documento vencido na data do teste: mede o custo da varredura).
  start = performance.now();
  await client.waitForTask(await deleteExpiredCompanyDocuments(client, INDEX_UID, nowEpoch));
  const expireScanMs = performance.now() - start;

  report.meilisearch = {
    version: (await client.request<{ pkgVersion: string }>("/version", { timeoutMs: 5_000 })).pkgVersion,
    documents: stats.indexes[INDEX_UID]?.numberOfDocuments ?? null,
    indexBuildMs: Math.round(indexMs),
    databaseSizeMb: Math.round((stats.databaseSize / 1048576) * 10) / 10,
    usedDatabaseSizeMb: stats.usedDatabaseSize ? Math.round((stats.usedDatabaseSize / 1048576) * 10) / 10 : null,
    rssBeforeMb: rssBefore,
    rssAfterIndexMb: rssAfterIndex,
    update1kMs: Math.round(update1kMs),
    update1Ms: Math.round(update1Ms),
    delete1kMs: Math.round(delete1kMs),
    expireScanMs: Math.round(expireScanMs)
  };

  const scope = { profileId: PROFILE, workspaceIds: [] };
  const raw: Engine = {
    name: "C. Meilisearch (texto cru)",
    async search(query) {
      const t = performance.now();
      const response = await searchCompanyIndex(client, INDEX_UID, {
        q: query.q,
        scope,
        filters: { stateCodes: query.stateCodes },
        limit: TOP_K,
        nowEpoch
      });
      return { cnpjs: response.hits.map((hit) => hit.cnpj), ms: performance.now() - t, serverMs: response.processingTimeMs };
    }
  };
  const planned: Engine = {
    name: "D. Meilisearch + intérprete (produção)",
    async search(query) {
      const t = performance.now();
      const plan = planCompanyQuery(query.q, { stateCodes: query.stateCodes });
      const response = await searchCompanyIndex(client, INDEX_UID, { q: plan.q, scope, filters: plan.filters, limit: TOP_K, nowEpoch });
      return { cnpjs: response.hits.map((hit) => hit.cnpj), ms: performance.now() - t, serverMs: response.processingTimeMs };
    }
  };
  report.meiliClient = client;
  return [raw, planned];
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------
async function evaluate(engine: Engine, queries: BenchQuery[], relevantByQuery: Map<string, Set<string>>) {
  // Aquecimento (JIT, cache de páginas): não entra na medição.
  for (const query of queries.slice(0, 10)) await engine.search(query);
  const latencies: number[] = [];
  const serverLatencies: number[] = [];
  const byCategory = new Map<string, { recall: number[]; hit1: number[]; rr: number[] }>();
  const failures: Array<{ id: string; q: string; recall: number }> = [];
  for (const query of queries) {
    const relevant = relevantByQuery.get(query.id)!;
    const { cnpjs, ms, serverMs } = await engine.search(query);
    latencies.push(ms);
    if (typeof serverMs === "number") serverLatencies.push(serverMs);
    const top = cnpjs.slice(0, TOP_K);
    const found = top.filter((cnpj) => relevant.has(cnpj)).length;
    const recall = relevant.size === 0 ? 1 : found / Math.min(TOP_K, relevant.size);
    const firstRelevant = top.findIndex((cnpj) => relevant.has(cnpj));
    const bucket = byCategory.get(query.category) ?? { recall: [], hit1: [], rr: [] };
    bucket.recall.push(recall);
    bucket.hit1.push(firstRelevant === 0 ? 1 : 0);
    bucket.rr.push(firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0);
    byCategory.set(query.category, bucket);
    if (recall < 0.5) failures.push({ id: query.id, q: query.q, recall: Math.round(recall * 100) / 100 });
  }
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const all = Array.from(byCategory.values());
  return {
    engine: engine.name,
    recallAt10: Math.round(mean(all.flatMap((b) => b.recall)) * 1000) / 1000,
    hitAt1: Math.round(mean(all.flatMap((b) => b.hit1)) * 1000) / 1000,
    mrrAt10: Math.round(mean(all.flatMap((b) => b.rr)) * 1000) / 1000,
    p50Ms: Math.round(percentile(latencies, 50) * 100) / 100,
    p95Ms: Math.round(percentile(latencies, 95) * 100) / 100,
    serverP50Ms: serverLatencies.length ? percentile(serverLatencies, 50) : null,
    serverP95Ms: serverLatencies.length ? percentile(serverLatencies, 95) : null,
    byCategory: Object.fromEntries(
      Array.from(byCategory.entries()).map(([category, bucket]) => [
        category,
        { n: bucket.recall.length, recallAt10: Math.round(mean(bucket.recall) * 1000) / 1000, hitAt1: Math.round(mean(bucket.hit1) * 1000) / 1000 }
      ])
    ),
    failures: failures.slice(0, 40)
  };
}

async function main() {
  const report: Record<string, unknown> = { size: SIZE, generatedAt: new Date().toISOString(), node: process.version };
  console.error(`[bench] gerando ${SIZE} empresas sintéticas…`);
  const rows = generateCompanies(SIZE);
  const queries = buildBenchQueries(rows, mulberry32(7));
  const relevantByQuery = new Map(queries.map((query) => [query.id, new Set(rows.filter(query.relevant).map((row) => row.cnpj))]));
  report.queries = queries.length;
  report.queryCategories = Object.fromEntries(
    Array.from(new Set(queries.map((q) => q.category))).map((category) => [category, queries.filter((q) => q.category === category).length])
  );

  // Custo do intérprete local sozinho.
  const interpretTimes: number[] = [];
  interpretQuery("aquecimento pato branco");
  for (const query of queries) {
    const t = performance.now();
    interpretQuery(query.q);
    interpretTimes.push(performance.now() - t);
  }
  report.interpreter = { p50Ms: Math.round(percentile(interpretTimes, 50) * 100) / 100, p95Ms: Math.round(percentile(interpretTimes, 95) * 100) / 100 };

  const engines: Engine[] = [buildCurrentEngine(rows)];
  if (!SKIP_PG) {
    console.error("[bench] carregando PostgreSQL (PGlite) com pg_trgm…");
    engines.push(await buildPgEngine(rows, report));
  }
  console.error("[bench] indexando no Meilisearch…");
  engines.push(...(await buildMeiliEngines(rows, report)));
  const client = report.meiliClient as ReturnType<typeof createMeiliClient>;
  delete report.meiliClient;

  const results = [];
  for (const engine of engines) {
    console.error(`[bench] avaliando ${engine.name}…`);
    results.push(await evaluate(engine, queries, relevantByQuery));
  }
  (report.meilisearch as Record<string, unknown>).rssAfterQueriesMb = meiliRssMb();
  report.results = results;

  const json = JSON.stringify(report, null, 2);
  if (OUT) writeFileSync(OUT, json);
  console.log(json);
  if (!KEEP) await deleteIndex(client, INDEX_UID).then((uid) => client.waitForTask(uid)).catch(() => null);
  process.exit(0);
}

await main();

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type SqlClient = NeonQueryFunction<false, false>;

let client: SqlClient | null = null;

function getClient(): SqlClient {
  if (client) return client;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL não configurada");
  }
  client = neon(databaseUrl);
  return client;
}

/**
 * Executor alternativo usado SOMENTE pelos testes de integração (Postgres em
 * memória via PGlite). Em produção fica sempre nulo.
 */
type QueryExecutor = {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  transaction(queries: Array<{ text: string; params?: unknown[] }>): Promise<Record<string, unknown>[][]>;
};

// Guardado em globalThis: o runner de testes pode carregar este módulo em mais de
// uma instância (ESM/CJS), e todas precisam enxergar o mesmo executor.
const TEST_EXECUTOR_KEY = Symbol.for("buscacnae.db.testExecutor");
type GlobalWithExecutor = typeof globalThis & { [TEST_EXECUTOR_KEY]?: QueryExecutor | null };

function getTestExecutor() {
  return (globalThis as GlobalWithExecutor)[TEST_EXECUTOR_KEY] ?? null;
}

export function setQueryExecutorForTests(executor: QueryExecutor | null) {
  if (process.env.NODE_ENV === "production") throw new Error("Executor de teste não pode ser usado em produção.");
  (globalThis as GlobalWithExecutor)[TEST_EXECUTOR_KEY] = executor;
}

/**
 * Cliente Neon criado sob demanda: a ausência de DATABASE_URL só falha quando uma
 * query é executada (e não na importação do módulo, o que quebrava `next build`
 * em ambientes sem a variável).
 */
function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
  const testExecutor = getTestExecutor();
  if (testExecutor) {
    return testExecutor.query(strings.reduce((text, part, index) => `${text}$${index}${part}`), values);
  }
  return getClient()(strings, ...(values as never[]));
}

export const sql = Object.assign(sqlTag, {
  query(queryText: string, params?: unknown[]) {
    const testExecutor = getTestExecutor();
    if (testExecutor) return testExecutor.query(queryText, params);
    return getClient().query(queryText, params as never);
  },
  /**
   * Várias consultas em UMA transação não interativa (HTTP). Se qualquer uma
   * falhar, nenhuma é aplicada. Retorna as linhas de cada consulta, na ordem.
   */
  transaction(queries: Array<{ text: string; params?: unknown[] }>) {
    const testExecutor = getTestExecutor();
    if (testExecutor) return testExecutor.transaction(queries);
    const client = getClient();
    return client.transaction(queries.map((query) => client.query(query.text, query.params as never)));
  }
});

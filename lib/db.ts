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
 * Cliente Neon criado sob demanda: a ausência de DATABASE_URL só falha quando uma
 * query é executada (e não na importação do módulo, o que quebrava `next build`
 * em ambientes sem a variável).
 */
function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
  return getClient()(strings, ...(values as never[]));
}

export const sql = Object.assign(sqlTag, {
  query(queryText: string, params?: unknown[]) {
    return getClient().query(queryText, params as never);
  }
});

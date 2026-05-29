import { auth } from "@/lib/auth/neon";
import { sql } from "@/lib/db";

export { auth };

export type CurrentUser = {
  id: string;
  email: string;
  name?: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";

  if (!user?.id || !email) {
    return null;
  }

  return {
    id: user.id,
    email,
    name: typeof user.name === "string" ? user.name : null
  };
}

type SqlQuery = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function getSqlQuery() {
  return sql as unknown as SqlQuery;
}

export async function ensureProfileForUser(user: CurrentUser) {
  const columns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
  `;

  const availableColumns = new Set(columns.map((column) => column.column_name));
  if (!availableColumns.size) return;

  const idColumn = availableColumns.has("id") ? "id" : availableColumns.has("user_id") ? "user_id" : null;
  if (!idColumn || !availableColumns.has("email")) return;

  const profileValues: Record<string, unknown> = {
    [idColumn]: user.id,
    email: user.email
  };

  if (availableColumns.has("full_name")) profileValues.full_name = user.name ?? null;
  if (availableColumns.has("name")) profileValues.name = user.name ?? null;
  if (availableColumns.has("created_at")) profileValues.created_at = new Date().toISOString();
  if (availableColumns.has("updated_at")) profileValues.updated_at = new Date().toISOString();

  const insertColumns = Object.keys(profileValues);
  const values = Object.values(profileValues);
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`).join(", ");
  const updateColumns = insertColumns.filter((column) => column !== idColumn && column !== "created_at");
  const updateSql = updateColumns.length
    ? `DO UPDATE SET ${updateColumns
        .map((column) => {
          if (column === "full_name" || column === "name") {
            return `${column} = COALESCE(EXCLUDED.${column}, profiles.${column})`;
          }
          return `${column} = EXCLUDED.${column}`;
        })
        .join(", ")}`
    : "DO NOTHING";

  await getSqlQuery().query(
    `INSERT INTO profiles (${insertColumns.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (${idColumn}) ${updateSql}`,
    values
  );
}

export async function isKnownAuthEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const rows = await sql`
    SELECT 1
    FROM profiles
    WHERE lower(email) = ${normalizedEmail}
    UNION
    SELECT 1
    FROM search_access_orders
    WHERE lower(email) = ${normalizedEmail}
    UNION
    SELECT 1
    FROM search_access_bulk_orders
    WHERE lower(email) = ${normalizedEmail}
    UNION
    SELECT 1
    FROM search_ai_format_orders
    WHERE lower(email) = ${normalizedEmail}
    LIMIT 1
  `;

  return rows.length > 0;
}

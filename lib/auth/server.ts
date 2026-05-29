import { auth } from "@/lib/auth/neon";
import { sql } from "@/lib/db";

export { auth };

export type CurrentUser = {
  id: string;
  email: string;
  name?: string | null;
};

type ProfileColumn = {
  column_name: string;
};

type ProfileIdentity = {
  id?: string | null;
  email?: string | null;
};

type SqlRunner = <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;

const runSql = sql as unknown as SqlRunner;

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";

  if (!user?.id || !email) {
    return null;
  }

  try {
    return await ensureProfileForUser({
      id: user.id,
      email,
      name: typeof user.name === "string" ? user.name : null
    });
  } catch (error) {
    console.error("Falha ao sincronizar perfil do usuário autenticado com Neon Auth.", error);
    return null;
  }
}

async function ensureProfilesStorage() {
  await sql`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id text PRIMARY KEY,
      neon_auth_user_id text,
      name text,
      email text NOT NULL UNIQUE,
      role text NOT NULL DEFAULT 'user',
      status text NOT NULL DEFAULT 'active',
      stripe_customer_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS neon_auth_user_id text`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name text`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`;

  await sql`CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_profiles_neon_auth_user_id ON public.profiles (neon_auth_user_id)`;

  await sql`
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'set_profiles_updated_at'
          AND tgrelid = 'public.profiles'::regclass
      ) THEN
        CREATE TRIGGER set_profiles_updated_at
        BEFORE UPDATE ON public.profiles
        FOR EACH ROW
        EXECUTE FUNCTION public.set_updated_at();
      END IF;
    END;
    $$
  `;
}

async function getProfileColumns() {
  const columns = await sql<ProfileColumn[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
  `;

  return new Set(columns.map((column) => column.column_name));
}

function buildProfileLookupSql(columns: Set<string>) {
  const clauses: string[] = [];

  if (columns.has("neon_auth_user_id")) {
    clauses.push("neon_auth_user_id = $1");
  }

  if (columns.has("id")) {
    clauses.push("id::text = $1");
  }

  if (columns.has("email")) {
    clauses.push("lower(email) = $2");
  }

  if (!clauses.length) return "";

  return `
    SELECT id::text AS id, email
    FROM public.profiles
    WHERE ${clauses.join(" OR ")}
    LIMIT 1
  `;
}

async function findExistingProfileIdentity(user: CurrentUser, columns: Set<string>) {
  const lookupSql = buildProfileLookupSql(columns);
  if (!lookupSql) return null;

  const rows = await runSql<ProfileIdentity>(lookupSql, [user.id, user.email]);
  return rows[0] ?? null;
}

export async function ensureProfileForUser(user: CurrentUser): Promise<CurrentUser> {
  await ensureProfilesStorage();

  const availableColumns = await getProfileColumns();
  if (!availableColumns.has("id") || !availableColumns.has("email")) return user;

  const existingProfile = await findExistingProfileIdentity(user, availableColumns);
  const profileValues: Record<string, unknown> = {
    id: existingProfile?.id ?? user.id,
    email: user.email
  };

  if (availableColumns.has("neon_auth_user_id")) profileValues.neon_auth_user_id = user.id;
  if (availableColumns.has("name")) profileValues.name = user.name ?? null;
  if (availableColumns.has("full_name")) profileValues.full_name = user.name ?? null;
  if (availableColumns.has("role")) profileValues.role = "user";
  if (availableColumns.has("status")) profileValues.status = "active";
  if (availableColumns.has("created_at")) profileValues.created_at = new Date().toISOString();
  if (availableColumns.has("updated_at")) profileValues.updated_at = new Date().toISOString();

  const insertColumns = Object.keys(profileValues);
  const values = Object.values(profileValues);
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`).join(", ");
  const updateColumns = insertColumns.filter((column) => !["id", "created_at", "role", "status"].includes(column));
  const updateSql = updateColumns.length
    ? `DO UPDATE SET ${updateColumns
        .map((column) => {
          if (column === "name" || column === "full_name") {
            return `${column} = COALESCE(EXCLUDED.${column}, profiles.${column})`;
          }
          return `${column} = EXCLUDED.${column}`;
        })
        .join(", ")}`
    : "DO NOTHING";

  await runSql(
    `INSERT INTO public.profiles (${insertColumns.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (id) ${updateSql}`,
    values
  );

  return {
    id: String(profileValues.id),
    email: user.email,
    name: user.name ?? null
  };
}

export async function isProfileEmailRegistered(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  await ensureProfilesStorage();

  const rows = await sql`
    SELECT 1
    FROM public.profiles
    WHERE lower(email) = ${normalizedEmail}
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function isKnownAuthEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  await ensureProfilesStorage();

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

import { auth } from "@/lib/auth/neon";
import { sql } from "@/lib/db";

export { auth };

export type CurrentUser = {
  id: string;
  email: string;
  name?: string | null;
  authUserId?: string;
  userId?: string;
  role?: "user" | "admin";
  status?: "active" | "inactive" | "blocked";
};

type TableColumn = {
  column_name: string;
  data_type: string;
};

type ProfileIdentity = {
  id?: string | null;
  email?: string | null;
};

type AppUserRecord = {
  id: string;
  neon_auth_user_id: string | null;
  name: string | null;
  email: string;
  role: "user" | "admin";
  status: "active" | "inactive" | "blocked";
};

type SqlRunner = <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;

const runSql = sql as unknown as SqlRunner;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasColumn(columns: Map<string, string>, column: string) {
  return columns.has(column);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";

  if (!user?.id || !email) {
    return null;
  }

  const authUser: CurrentUser = {
    id: user.id,
    authUserId: user.id,
    email,
    name: typeof user.name === "string" ? user.name : null
  };

  try {
    const appUser = await ensureAppUserForAuth(authUser);
    if (appUser.status !== "active") return null;

    return await ensureProfileForUser({
      ...authUser,
      userId: appUser.id,
      role: appUser.role,
      status: appUser.status,
      name: authUser.name ?? appUser.name
    });
  } catch (error) {
    console.error("Falha ao sincronizar usuário autenticado com Neon Auth.", error);
    return null;
  }
}

async function ensureUsersStorage() {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  await sql`
    CREATE TABLE IF NOT EXISTS public.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      neon_auth_user_id text UNIQUE,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      password_hash text,
      role text NOT NULL DEFAULT 'user',
      status text NOT NULL DEFAULT 'active',
      email_verified boolean NOT NULL DEFAULT false,
      last_login_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT users_email_lowercase_check CHECK (email = lower(email)),
      CONSTRAINT users_status_check CHECK (status IN ('active', 'inactive', 'blocked')),
      CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
    )
  `;

  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS neon_auth_user_id text`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name text`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash text`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at timestamptz`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`;
  await sql`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`;

  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_neon_auth_user_id ON public.users (neon_auth_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_status ON public.users (status)`;

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
    DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users
  `;

  await sql`
    CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at()
  `;
}

async function ensureProfilesStorage() {
  await sql`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id text PRIMARY KEY,
      neon_auth_user_id text,
      user_id uuid,
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
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id uuid`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name text`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`;
  await sql`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`;

  await sql`CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles (user_id)`;
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

async function getTableColumns(tableName: "profiles" | "users") {
  const columns = await sql<TableColumn[]>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `;

  return new Map(columns.map((column) => [column.column_name, column.data_type]));
}

function normalizeRole(value: unknown): "user" | "admin" {
  return value === "admin" ? "admin" : "user";
}

function normalizeStatus(value: unknown): "active" | "inactive" | "blocked" {
  if (value === "inactive" || value === "blocked") return value;
  return "active";
}

async function findAppUserByAuthOrEmail(user: CurrentUser) {
  const authUserId = user.authUserId ?? user.id;
  const rows = await runSql<AppUserRecord>(
    `SELECT id::text AS id, neon_auth_user_id, name, email, role, status
     FROM public.users
     WHERE neon_auth_user_id = $1 OR lower(email) = $2
     LIMIT 1`,
    [authUserId, user.email]
  );

  return rows[0] ?? null;
}

export async function ensureAppUserForAuth(user: CurrentUser): Promise<AppUserRecord> {
  await ensureUsersStorage();

  const authUserId = user.authUserId ?? user.id;
  const normalizedEmail = user.email.trim().toLowerCase();
  const normalizedName = user.name?.trim() || normalizedEmail;
  const existing = await findAppUserByAuthOrEmail({ ...user, email: normalizedEmail, authUserId });

  if (existing) {
    await runSql(
      `UPDATE public.users
       SET neon_auth_user_id = COALESCE(neon_auth_user_id, $1),
           name = COALESCE(NULLIF($2, ''), name),
           email = $3
       WHERE id = $4`,
      [authUserId, normalizedName, normalizedEmail, existing.id]
    );

    const refreshed = await findAppUserByAuthOrEmail({ ...user, email: normalizedEmail, authUserId });
    if (refreshed) return refreshed;
  }

  const inserted = await runSql<AppUserRecord>(
    `INSERT INTO public.users (neon_auth_user_id, name, email, role, status, password_hash)
     VALUES ($1, $2, $3, 'user', 'active', NULL)
     ON CONFLICT (email) DO UPDATE
     SET neon_auth_user_id = COALESCE(public.users.neon_auth_user_id, EXCLUDED.neon_auth_user_id),
         name = COALESCE(NULLIF(EXCLUDED.name, ''), public.users.name)
     RETURNING id::text AS id, neon_auth_user_id, name, email, role, status`,
    [authUserId, normalizedName, normalizedEmail]
  );

  return inserted[0];
}

function buildProfileLookupSql(columns: Map<string, string>) {
  const clauses: string[] = [];

  if (hasColumn(columns, "neon_auth_user_id")) {
    clauses.push("neon_auth_user_id = $1");
  }

  if (hasColumn(columns, "id")) {
    clauses.push("id::text = $2");
  }

  if (hasColumn(columns, "email")) {
    clauses.push("lower(email) = $3");
  }

  if (!clauses.length) return "";

  return `
    SELECT id::text AS id, email
    FROM public.profiles
    WHERE ${clauses.join(" OR ")}
    LIMIT 1
  `;
}

async function findExistingProfileIdentity(user: CurrentUser, columns: Map<string, string>) {
  const lookupSql = buildProfileLookupSql(columns);
  if (!lookupSql) return null;

  const authUserId = user.authUserId ?? user.id;
  const rows = await runSql<ProfileIdentity>(lookupSql, [authUserId, user.id, user.email]);
  return rows[0] ?? null;
}

async function fetchProfileIdentity(user: CurrentUser, columns: Map<string, string>) {
  const existingProfile = await findExistingProfileIdentity(user, columns);

  if (!existingProfile?.id) {
    return null;
  }

  return {
    id: existingProfile.id,
    authUserId: user.authUserId ?? user.id,
    userId: user.userId,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    status: user.status
  } satisfies CurrentUser;
}

export async function ensureProfileForUser(user: CurrentUser): Promise<CurrentUser> {
  await ensureProfilesStorage();

  const availableColumns = await getTableColumns("profiles");
  if (!hasColumn(availableColumns, "id") || !hasColumn(availableColumns, "email")) return user;

  const authUserId = user.authUserId ?? user.id;
  const existingProfile = await findExistingProfileIdentity(user, availableColumns);
  const idDataType = availableColumns.get("id") ?? "";
  const canStoreAuthIdAsProfileId = idDataType !== "uuid" || isUuid(user.id);

  const profileValues: Record<string, unknown> = {
    email: user.email
  };

  if (existingProfile?.id) {
    profileValues.id = existingProfile.id;
  } else if (canStoreAuthIdAsProfileId) {
    profileValues.id = user.id;
  }

  if (hasColumn(availableColumns, "neon_auth_user_id")) profileValues.neon_auth_user_id = authUserId;
  if (hasColumn(availableColumns, "user_id")) profileValues.user_id = user.userId ?? null;
  if (hasColumn(availableColumns, "name")) profileValues.name = user.name ?? null;
  if (hasColumn(availableColumns, "full_name")) profileValues.full_name = user.name ?? null;
  if (hasColumn(availableColumns, "role")) profileValues.role = user.role ?? "user";
  if (hasColumn(availableColumns, "status")) profileValues.status = user.status ?? "active";
  if (hasColumn(availableColumns, "created_at")) profileValues.created_at = new Date().toISOString();
  if (hasColumn(availableColumns, "updated_at")) profileValues.updated_at = new Date().toISOString();

  const insertColumns = Object.keys(profileValues);
  const values = Object.values(profileValues);
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`).join(", ");
  const conflictTarget = profileValues.id ? "id" : "email";
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
     ON CONFLICT (${conflictTarget}) ${updateSql}`,
    values
  );

  return (await fetchProfileIdentity({ ...user, authUserId }, availableColumns)) ?? { ...user, authUserId };
}

export async function recordSuccessfulLoginForUser(user: CurrentUser) {
  await ensureUsersStorage();

  const authUserId = user.authUserId ?? user.id;
  await runSql(
    `UPDATE public.users
     SET last_login_at = now()
     WHERE neon_auth_user_id = $1 OR lower(email) = $2`,
    [authUserId, user.email]
  );
}

export async function isUserEmailRegistered(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  await ensureUsersStorage();

  const rows = await sql`
    SELECT 1
    FROM public.users
    WHERE lower(email) = ${normalizedEmail}
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function isProfileEmailRegistered(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  await ensureUsersStorage();
  await ensureProfilesStorage();

  const rows = await sql`
    SELECT 1
    FROM public.users
    WHERE lower(email) = ${normalizedEmail}
    UNION
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

  await ensureUsersStorage();
  await ensureProfilesStorage();

  const rows = await sql`
    SELECT 1
    FROM public.users
    WHERE lower(email) = ${normalizedEmail}
    UNION
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

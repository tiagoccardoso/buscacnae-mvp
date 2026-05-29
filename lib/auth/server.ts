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

export async function ensureProfileForUser(user: CurrentUser) {
  await sql`
    INSERT INTO profiles (id, email, full_name)
    VALUES (${user.id}, ${user.email}, ${user.name ?? null})
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name)
  `;
}

export async function isKnownAuthEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const rows = await sql`
    SELECT 1
    FROM profiles
    WHERE lower(email) = ${normalizedEmail}
    LIMIT 1
  `;

  return rows.length > 0;
}

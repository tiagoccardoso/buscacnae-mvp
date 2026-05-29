import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";

const scrypt = promisify(scryptCallback);

const SESSION_COOKIE_NAME = "buscacnae_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ALGORITHM = "scrypt";
const PASSWORD_KEY_LENGTH = 64;

export type CurrentUser = {
  id: string;
  email: string;
  name?: string | null;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  password_hash?: string;
  is_active?: boolean;
};

function getCookieSecret() {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
  if (!secret) {
    throw new Error("NEON_AUTH_COOKIE_SECRET não configurada");
  }
  return secret;
}

function normalizeEmailValue(value: string) {
  return value.trim().toLowerCase();
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", getCookieSecret()).update(payload).digest("base64url");
}

function createSessionToken(userId: string) {
  const payload = JSON.stringify({ sub: userId, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 });
  const encodedPayload = base64UrlEncode(payload);
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function readSessionToken(token: string | undefined) {
  if (!token) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as { sub?: string; exp?: number };
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `${PASSWORD_ALGORITHM}:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, salt, storedKey] = passwordHash.split(":");
  if (algorithm !== PASSWORD_ALGORITHM || !salt || !storedKey) return false;

  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  const storedKeyBuffer = Buffer.from(storedKey, "hex");

  return storedKeyBuffer.length === derivedKey.length && timingSafeEqual(storedKeyBuffer, derivedKey);
}

async function findUserByEmail(email: string) {
  const rows = (await sql`
    SELECT id, name, email, password_hash, is_active
    FROM users
    WHERE lower(email) = ${normalizeEmailValue(email)}
    LIMIT 1
  `) as UserRow[];

  return rows[0] ?? null;
}

async function findUserById(id: string) {
  const rows = (await sql`
    SELECT id, name, email, is_active
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `) as UserRow[];

  return rows[0] ?? null;
}

export async function createUserWithPassword({ name, email, password }: { name: string; email: string; password: string }) {
  const normalizedEmail = normalizeEmailValue(email);
  const passwordHash = await hashPassword(password);

  const rows = (await sql`
    INSERT INTO users (name, email, password_hash)
    VALUES (${name.trim()}, ${normalizedEmail}, ${passwordHash})
    RETURNING id, name, email
  `) as UserRow[];

  const user = rows[0];
  if (!user) throw new Error("Não foi possível criar o usuário.");

  await ensureProfileForUser({ id: user.id, email: user.email, name: user.name });

  return user;
}

export async function authenticateUserWithPassword(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash || user.is_active === false) return null;

  const validPassword = await verifyPassword(password, user.password_hash);
  if (!validPassword) return null;

  await sql`
    UPDATE users
    SET last_login_at = NOW(), updated_at = NOW()
    WHERE id = ${user.id}
  `;

  return {
    id: user.id,
    email: user.email,
    name: user.name
  } satisfies CurrentUser;
}

export async function createSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export async function signOut() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const userId = readSessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!userId) return null;

  const user = await findUserById(userId);
  if (!user || user.is_active === false) return null;

  return {
    id: user.id,
    email: normalizeEmailValue(user.email),
    name: user.name
  };
}

export async function ensureProfileForUser(user: CurrentUser) {
  await sql`
    INSERT INTO profiles (id, user_id, email, full_name, updated_at)
    VALUES (${user.id}, ${user.id}, ${user.email}, ${user.name ?? null}, NOW())
    ON CONFLICT (id) DO UPDATE
    SET user_id = COALESCE(profiles.user_id, EXCLUDED.user_id),
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        updated_at = NOW()
  `;
}

export async function isKnownAuthEmail(email: string) {
  return Boolean(await findUserByEmail(email));
}

export const sessionCookieName = SESSION_COOKIE_NAME;

import { createNeonAuth } from "@neondatabase/auth/next/server";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();

if (!baseUrl) {
  throw new Error("NEON_AUTH_BASE_URL não configurada");
}

if (!cookieSecret) {
  throw new Error("NEON_AUTH_COOKIE_SECRET não configurada");
}

function normalizeOrigin(value: string | undefined | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return "";
  }
}

function splitOrigins(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

function getTrustedOrigins() {
  const origins = new Set<string>();

  for (const origin of splitOrigins(process.env.NEON_AUTH_TRUSTED_ORIGINS)) {
    origins.add(origin);
  }

  for (const origin of [
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL),
    normalizeOrigin(process.env.VERCEL_URL),
    normalizeOrigin(process.env.VERCEL_BRANCH_URL),
    normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001"
  ]) {
    if (origin) origins.add(origin);
  }

  return Array.from(origins);
}

const authConfig: Parameters<typeof createNeonAuth>[0] & { trustedOrigins?: string[] } = {
  baseUrl,
  cookies: {
    secret: cookieSecret
  },
  // O Neon Auth usa Better Auth por baixo e valida a origem das requisições.
  // Sem a origem do domínio atual aqui, signUp/signIn podem falhar com "Invalid origin".
  trustedOrigins: getTrustedOrigins()
};

export const auth = createNeonAuth(authConfig);

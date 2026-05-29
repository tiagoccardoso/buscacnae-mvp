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
  const trimmed = value?.trim().replace(/\/$/, "");
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return "";
  }
}

function addOriginWithWwwVariant(origins: Set<string>, value: string | undefined | null) {
  const origin = normalizeOrigin(value);
  if (!origin) return;

  origins.add(origin);

  try {
    const url = new URL(origin);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.replace(/^www\./, "");
      origins.add(url.origin);
    } else if (!url.hostname.endsWith(".vercel.app") && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      url.hostname = `www.${url.hostname}`;
      origins.add(url.origin);
    }
  } catch {
    // Ignora origens inválidas.
  }
}

function getTrustedOrigins() {
  const origins = new Set<string>();

  // Domínios públicos do BuscaCNAE. Mantemos direto no código para não depender
  // de variáveis não reconhecidas pela documentação do Neon Auth.
  addOriginWithWwwVariant(origins, "https://www.buscacnae.com.br");
  addOriginWithWwwVariant(origins, "https://buscacnae.com.br");

  // Ambientes locais usados no desenvolvimento.
  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");
  origins.add("http://localhost:3001");
  origins.add("http://127.0.0.1:3001");

  // URLs já usadas pelo projeto/Vercel. Estas não são variáveis novas de Auth;
  // servem apenas para derivar a origem real quando o app roda em preview.
  for (const value of [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.SITE_URL,
    process.env.APP_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  ]) {
    addOriginWithWwwVariant(origins, value);
  }

  return Array.from(origins);
}

const trustedOrigins = getTrustedOrigins();

export const auth = createNeonAuth({
  baseUrl,
  cookies: {
    secret: cookieSecret
  },
  // O erro "Invalid origin" acontece quando o Better Auth, usado pelo Neon Auth,
  // recebe uma requisição de um domínio que não está nesta lista.
  // A lista abaixo usa apenas as variáveis oficiais do Neon Auth para a conexão
  // e define as origens confiáveis diretamente no código da aplicação.
  trustedOrigins
});

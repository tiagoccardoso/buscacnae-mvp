import { createNeonAuth } from "@neondatabase/auth/next/server";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();

if (!baseUrl) {
  throw new Error("NEON_AUTH_BASE_URL não configurada");
}

if (!cookieSecret) {
  throw new Error("NEON_AUTH_COOKIE_SECRET não configurada");
}

type RequestLike = Request | { headers?: Headers | Record<string, string | string[] | undefined> } | undefined;

function getHeader(request: RequestLike, name: string) {
  const headers = request?.headers;
  if (!headers) return "";

  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }

  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function normalizeOrigin(value: string | undefined | null) {
  const trimmed = value?.trim().replace(/\/$/, "");
  if (!trimmed) return "";

  if (trimmed.includes("*")) {
    return /^https?:\/\//i.test(trimmed) || trimmed.startsWith("*.") ? trimmed : `https://${trimmed}`;
  }

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

function getOriginFromHost(host: string, protocol = "https") {
  const cleanHost = host.split(",")[0]?.trim();
  if (!cleanHost) return "";

  const resolvedProtocol = cleanHost.startsWith("localhost") || cleanHost.startsWith("127.0.0.1") ? "http" : protocol;
  return normalizeOrigin(`${resolvedProtocol}://${cleanHost}`);
}

function addWwwVariants(origins: Set<string>, origin: string) {
  if (!origin || origin.includes("*")) return;

  try {
    const url = new URL(origin);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.replace(/^www\./, "");
      origins.add(url.origin);
    } else {
      url.hostname = `www.${url.hostname}`;
      origins.add(url.origin);
    }
  } catch {
    // Ignora origens inválidas.
  }
}

function getStaticTrustedOrigins() {
  const origins = new Set<string>();

  for (const origin of splitOrigins(process.env.NEON_AUTH_TRUSTED_ORIGINS)) {
    origins.add(origin);
    addWwwVariants(origins, origin);
  }

  for (const origin of [
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL),
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
    normalizeOrigin(process.env.NEXT_PUBLIC_BASE_URL),
    normalizeOrigin(process.env.SITE_URL),
    normalizeOrigin(process.env.APP_URL),
    normalizeOrigin(process.env.VERCEL_URL),
    normalizeOrigin(process.env.VERCEL_BRANCH_URL),
    normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    "https://*.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001"
  ]) {
    if (origin) {
      origins.add(origin);
      addWwwVariants(origins, origin);
    }
  }

  return Array.from(origins);
}

function originHostMatchesRequest(origin: string, request: RequestLike) {
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    const host = getHeader(request, "host") || getHeader(request, "x-forwarded-host");
    const forwardedHost = getHeader(request, "x-forwarded-host");
    const expectedHosts = [host, forwardedHost]
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    return expectedHosts.includes(originUrl.host.toLowerCase());
  } catch {
    return false;
  }
}

const staticTrustedOrigins = getStaticTrustedOrigins();

const authConfig: Parameters<typeof createNeonAuth>[0] & {
  trustedOrigins?: string[] | ((request?: RequestLike) => string[] | Promise<string[]>);
} = {
  baseUrl,
  cookies: {
    secret: cookieSecret
  },
  // O Neon Auth usa Better Auth por baixo e valida a origem das requisições.
  // Além das origens configuradas em ambiente, aceita dinamicamente a origem
  // da própria requisição quando ela bate com o Host/X-Forwarded-Host do app.
  // Isso corrige o erro "Invalid origin" em domínio próprio, Vercel e localhost
  // sem abrir CORS para domínios externos.
  trustedOrigins: (request?: RequestLike) => {
    const origins = new Set(staticTrustedOrigins);
    const requestOrigin = normalizeOrigin(getHeader(request, "origin"));
    const forwardedProto = getHeader(request, "x-forwarded-proto") || "https";
    const hostOrigin = getOriginFromHost(getHeader(request, "host"), forwardedProto.split(",")[0]?.trim() || "https");
    const forwardedHostOrigin = getOriginFromHost(getHeader(request, "x-forwarded-host"), forwardedProto.split(",")[0]?.trim() || "https");

    if (hostOrigin) origins.add(hostOrigin);
    if (forwardedHostOrigin) origins.add(forwardedHostOrigin);
    if (requestOrigin && originHostMatchesRequest(requestOrigin, request)) {
      origins.add(requestOrigin);
      addWwwVariants(origins, requestOrigin);
    }

    return Array.from(origins);
  }
};

export const auth = createNeonAuth(authConfig);

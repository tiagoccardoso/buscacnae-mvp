import { createNeonAuth } from "@neondatabase/auth/next/server";

const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();

if (!baseUrl) {
  throw new Error("NEON_AUTH_BASE_URL não configurada");
}

if (!cookieSecret) {
  throw new Error("NEON_AUTH_COOKIE_SECRET não configurada");
}

export const auth = createNeonAuth({
  baseUrl,
  cookies: {
    secret: cookieSecret
  }
});

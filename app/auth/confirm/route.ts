import { NextResponse } from "next/server";

function sanitizeNextPath(value: string | null) {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = sanitizeNextPath(url.searchParams.get("next"));
  const orderId = url.searchParams.get("order_id")?.trim() ?? "";
  const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
  const signInUrl = new URL("/sign-in", url.origin);
  signInUrl.searchParams.set("next", next);
  if (orderId) signInUrl.searchParams.set("order_id", orderId);
  if (email) signInUrl.searchParams.set("email", email);
  signInUrl.searchParams.set("message", "Entre com e-mail e senha para concluir o acesso.");

  return NextResponse.redirect(signInUrl);
}

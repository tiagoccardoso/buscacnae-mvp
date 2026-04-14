import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimSearchAccessOrderForUser, claimSearchAccessOrdersForUserByEmail } from "@/lib/billing";

function sanitizeNextPath(value: string | null) {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function getRequestOrigin(request: Request) {
  const url = new URL(request.url);
  return url.origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = sanitizeNextPath(url.searchParams.get("next"));
  const orderId = url.searchParams.get("order_id")?.trim() ?? "";
  const origin = getRequestOrigin(request);

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/sign-in?error=Link inválido ou expirado.", origin));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash
  });

  if (error) {
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, origin)
    );
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user?.id && user.email) {
    try {
      await claimSearchAccessOrdersForUserByEmail({
        userId: user.id,
        email: user.email
      });

      if (orderId) {
        await claimSearchAccessOrderForUser({
          orderId,
          userId: user.id,
          email: user.email
        });
      }
    } catch (claimError) {
      console.error("Falha ao vincular buscas públicas ao histórico após confirmar o magic link.", claimError);
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}

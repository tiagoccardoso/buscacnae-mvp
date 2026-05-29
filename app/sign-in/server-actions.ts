"use server";

import { redirect } from "next/navigation";
import { auth, ensureProfileForUser, getCurrentUser, isKnownAuthEmail } from "@/lib/auth/server";
import { claimSearchAccessOrderForUser, claimSearchAccessOrdersForUserByEmail } from "@/lib/billing";

function sanitizeNextPath(value: string | null) {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function buildSignInUrl(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  const query = searchParams.toString();
  return query ? `/sign-in?${query}` : "/sign-in";
}

export async function requestAccessCodeAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const orderId = String(formData.get("orderId") ?? "").trim();

  if (!email) {
    redirect("/sign-in?error=Informe um email válido.");
  }

  const isAllowed = await isKnownAuthEmail(email);
  if (!isAllowed) {
    redirect("/sign-in?error=Use o mesmo e-mail cadastrado em uma compra ou perfil existente.");
  }

  const { error } = await auth.emailOtp.sendVerificationOtp({ email });

  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  redirect(
    buildSignInUrl({
      email,
      next,
      order_id: orderId,
      message: "Enviamos o código de acesso para o seu email."
    })
  );
}

export async function verifyAccessCodeAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const otp = String(formData.get("otp") ?? "").trim();
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const orderId = String(formData.get("orderId") ?? "").trim();

  if (!email || !otp) {
    redirect(buildSignInUrl({ email, next, order_id: orderId, error: "Informe o e-mail e o código recebido." }));
  }

  const { error } = await auth.signIn.emailOtp({ email, otp });
  if (error) {
    redirect(buildSignInUrl({ email, next, order_id: orderId, error: error.message || "Código inválido ou expirado." }));
  }

  const user = await getCurrentUser();
  if (user) {
    await ensureProfileForUser(user);
    try {
      await claimSearchAccessOrdersForUserByEmail({ userId: user.id, email: user.email });
      if (orderId) {
        await claimSearchAccessOrderForUser({ orderId, userId: user.id, email: user.email });
      }
    } catch (claimError) {
      console.error("Falha ao vincular buscas públicas ao histórico após autenticação Neon Auth.", claimError);
    }
  }

  redirect(next);
}

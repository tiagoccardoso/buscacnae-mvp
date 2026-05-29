"use server";

import { redirect } from "next/navigation";
import { auth, ensureProfileForUser, getCurrentUser, isKnownAuthEmail } from "@/lib/auth/server";
import { claimSearchAccessOrderForUser, claimSearchAccessOrdersForUserByEmail } from "@/lib/billing";
import { sql } from "@/lib/db";
import { getBaseUrl } from "@/lib/env";

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

function buildSignUpUrl(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  const query = searchParams.toString();
  return query ? `/sign-up?${query}` : "/sign-up";
}

function buildForgotPasswordUrl(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  const query = searchParams.toString();
  return query ? `/forgot-password?${query}` : "/forgot-password";
}

function normalizeEmail(value: FormDataEntryValue | null) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

async function syncCurrentUserAfterAuth(orderId: string) {
  const user = await getCurrentUser();
  if (!user) return;

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

export async function signInWithPasswordAction(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const orderId = normalizeText(formData.get("orderId"));

  if (!email || !password) {
    redirect(buildSignInUrl({ email, next, order_id: orderId, error: "Informe e-mail e senha para entrar." }));
  }

  const isAllowed = await isKnownAuthEmail(email);
  if (!isAllowed) {
    redirect(buildSignInUrl({ email, next, order_id: orderId, error: "Não encontramos uma conta cadastrada para este e-mail." }));
  }

  const { error } = await auth.signIn.email({ email, password });

  if (error) {
    redirect(buildSignInUrl({ email, next, order_id: orderId, error: error.message || "E-mail ou senha inválidos." }));
  }

  await syncCurrentUserAfterAuth(orderId);

  redirect(next);
}

export async function signUpWithPasswordAction(formData: FormData) {
  const name = normalizeText(formData.get("name"));
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const orderId = normalizeText(formData.get("orderId"));

  if (!name || !email || !password || !confirmPassword) {
    redirect(buildSignUpUrl({ name, email, next, order_id: orderId, error: "Preencha nome, e-mail, senha e confirmação de senha." }));
  }

  if (password.length < 8) {
    redirect(buildSignUpUrl({ name, email, next, order_id: orderId, error: "A senha deve ter pelo menos 8 caracteres." }));
  }

  if (password !== confirmPassword) {
    redirect(buildSignUpUrl({ name, email, next, order_id: orderId, error: "A senha e a confirmação precisam ser iguais." }));
  }

  const existingProfile = await sql`
    SELECT id
    FROM profiles
    WHERE lower(email) = ${email}
    LIMIT 1
  `;

  if (existingProfile.length) {
    redirect(buildSignUpUrl({ name, email, next, order_id: orderId, error: "Já existe uma conta cadastrada para este e-mail." }));
  }

  const { data, error } = await auth.signUp.email({ email, password, name });

  if (error) {
    redirect(buildSignUpUrl({ name, email, next, order_id: orderId, error: error.message || "Não foi possível criar sua conta." }));
  }

  const signUpData = data as { user?: { id?: string } } | null;
  const currentUser = await getCurrentUser();
  const createdUser = currentUser ?? {
    id: typeof signUpData?.user?.id === "string" ? signUpData.user.id : "",
    email,
    name
  };

  if (createdUser.id) {
    await ensureProfileForUser({ id: createdUser.id, email, name });
  }

  await syncCurrentUserAfterAuth(orderId);

  redirect(next);
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));

  if (!email) {
    redirect(buildForgotPasswordUrl({ error: "Informe um e-mail válido para recuperar a senha." }));
  }

  const redirectTo = `${getBaseUrl()}/reset-password`;
  const authAny = auth as any;

  try {
    if (typeof authAny.requestPasswordReset === "function") {
      const { error } = await authAny.requestPasswordReset({ email, redirectTo });
      if (error) throw new Error(error.message || "Não foi possível iniciar a recuperação de senha.");
    } else if (authAny.api?.requestPasswordReset) {
      await authAny.api.requestPasswordReset({ body: { email, redirectTo } });
    } else {
      throw new Error("O método de recuperação de senha do Neon Auth não está disponível nesta versão do SDK.");
    }
  } catch (error) {
    console.error("Falha ao solicitar recuperação de senha pelo Neon Auth.", error);
  }

  redirect(buildForgotPasswordUrl({ message: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação de senha." }));
}

export async function resetPasswordAction(formData: FormData) {
  const token = normalizeText(formData.get("token"));
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) {
    redirect("/forgot-password?error=Solicite uma nova recuperação de senha.");
  }

  if (!password || !confirmPassword) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent("Informe e confirme a nova senha.")}`);
  }

  if (password.length < 8) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent("A nova senha deve ter pelo menos 8 caracteres.")}`);
  }

  if (password !== confirmPassword) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent("A senha e a confirmação precisam ser iguais.")}`);
  }

  const authAny = auth as any;

  try {
    if (typeof authAny.resetPassword === "function") {
      const { error } = await authAny.resetPassword({ token, newPassword: password });
      if (error) throw new Error(error.message || "Não foi possível redefinir a senha.");
    } else if (authAny.api?.resetPassword) {
      await authAny.api.resetPassword({ body: { token, newPassword: password } });
    } else {
      throw new Error("O método de redefinição de senha do Neon Auth não está disponível nesta versão do SDK.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível redefinir a senha.";
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`);
  }

  redirect("/sign-in?message=Senha redefinida com sucesso. Entre com sua nova senha.");
}

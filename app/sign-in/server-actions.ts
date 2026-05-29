"use server";

import { redirect } from "next/navigation";
import {
  authenticateUserWithPassword,
  createSession,
  createUserWithPassword,
  ensureProfileForUser,
  getCurrentUser,
  isKnownAuthEmail,
  signOut
} from "@/lib/auth/server";
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
    console.error("Falha ao vincular buscas públicas ao histórico após autenticação própria.", claimError);
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

  const user = await authenticateUserWithPassword(email, password);
  if (!user) {
    redirect(buildSignInUrl({ email, next, order_id: orderId, error: "E-mail ou senha inválidos." }));
  }

  await createSession(user.id);
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

  const isAllowed = await isKnownAuthEmail(email);
  if (isAllowed) {
    redirect(buildSignUpUrl({ name, email, next, order_id: orderId, error: "Já existe uma conta cadastrada para este e-mail." }));
  }

  try {
    const user = await createUserWithPassword({ name, email, password });
    await createSession(user.id);
    await syncCurrentUserAfterAuth(orderId);
  } catch (error) {
    console.error("Falha ao criar usuário local.", error);
    redirect(buildSignUpUrl({ name, email, next, order_id: orderId, error: "Não foi possível criar sua conta. Verifique se o e-mail já está cadastrado." }));
  }

  redirect(next);
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));

  if (!email) {
    redirect(buildForgotPasswordUrl({ error: "Informe um e-mail válido para recuperar a senha." }));
  }

  // O envio de e-mail transacional ainda precisa ser conectado a um provedor como Resend ou Brevo.
  // Mantemos uma resposta segura sem revelar se o e-mail existe.
  redirect(buildForgotPasswordUrl({ message: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação de senha." }));
}

export async function resetPasswordAction() {
  redirect("/forgot-password?message=Solicite a recuperação de senha para receber um novo link.");
}

export async function signOutAction() {
  await signOut();
  redirect("/");
}

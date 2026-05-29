"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, ensureProfileForUser, getCurrentUser, isProfileEmailRegistered } from "@/lib/auth/server";
import { claimSearchAccessOrderForUser, claimSearchAccessOrdersForUserByEmail } from "@/lib/billing";
import type { CurrentUser } from "@/lib/auth/server";

type AuthMode = "login" | "recover" | "signup";

type AuthResponseUser = {
  id?: unknown;
  email?: unknown;
  name?: unknown;
};

function extractAuthResponseUser(data: unknown): CurrentUser | null {
  const response = data as { user?: AuthResponseUser } | null | undefined;
  const user = response?.user;
  const id = typeof user?.id === "string" ? user.id : "";
  const email = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";

  if (!id || !email) return null;

  return {
    id,
    email,
    name: typeof user.name === "string" ? user.name : null
  };
}

const PASSWORD_MIN_LENGTH = 8;

function sanitizeNextPath(value: string | null) {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function sanitizeMode(value: string | null): AuthMode {
  if (value === "recover" || value === "signup") return value;
  return "login";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildSignInUrl(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  const query = searchParams.toString();
  return query ? `/sign-in?${query}` : "/sign-in";
}

function withAuthParams(formData: FormData, extras: Record<string, string>) {
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const orderId = String(formData.get("orderId") ?? "").trim();
  const mode = sanitizeMode(String(formData.get("mode") ?? ""));

  return buildSignInUrl({
    mode,
    next,
    order_id: orderId,
    ...extras
  });
}

async function getRequestOrigin() {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const proto = headersList.get("x-forwarded-proto") ?? "http";

  if (!host) return "http://localhost:3000";
  return `${proto}://${host}`;
}

function getFriendlyAuthError(action: "login" | "signup") {
  if (action === "signup") {
    return "Não foi possível criar sua conta agora. Verifique os dados informados ou tente novamente em alguns instantes.";
  }

  return "Não foi possível entrar. Confira seu e-mail e senha e tente novamente.";
}

async function claimOrdersForAuthenticatedUser(orderId: string) {
  const user = await getCurrentUser();
  if (!user) return;

  const profileUser = await ensureProfileForUser(user);

  try {
    await claimSearchAccessOrdersForUserByEmail({ userId: profileUser.id, email: profileUser.email });
    if (orderId) {
      await claimSearchAccessOrderForUser({ orderId, userId: profileUser.id, email: profileUser.email });
    }
  } catch (claimError) {
    console.error("Falha ao vincular buscas públicas ao histórico após autenticação Neon Auth.", claimError);
  }
}

export async function signInWithPasswordAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const orderId = String(formData.get("orderId") ?? "").trim();

  if (!email || !password) {
    redirect(withAuthParams(formData, { mode: "login", email, error: "Informe e-mail e senha para entrar." }));
  }

  if (!isValidEmail(email)) {
    redirect(withAuthParams(formData, { mode: "login", email, error: "Informe um e-mail válido." }));
  }

  const { error } = await auth.signIn.email({ email, password });

  if (error) {
    console.error("Falha no login por e-mail e senha com Neon Auth.", error);
    redirect(withAuthParams(formData, { mode: "login", email, error: getFriendlyAuthError("login") }));
  }

  await claimOrdersForAuthenticatedUser(orderId);

  redirect(next);
}

export async function requestPasswordRecoveryAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirect(withAuthParams(formData, { mode: "recover", error: "Informe seu e-mail para recuperar a senha." }));
  }

  if (!isValidEmail(email)) {
    redirect(withAuthParams(formData, { mode: "recover", email, error: "Informe um e-mail válido." }));
  }

  const origin = await getRequestOrigin();
  const resetUrl = `${origin}/api/auth/request-password-reset`;
  const redirectTo = `${origin}/sign-in`;

  let recoveryAccepted = false;

  try {
    const response = await fetch(resetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, redirectTo }),
      cache: "no-store"
    });

    recoveryAccepted = response.ok;
    if (!response.ok) {
      console.error("Neon Auth não aceitou a solicitação de recuperação de senha.", { status: response.status });
    }
  } catch (error) {
    console.error("Falha ao solicitar recuperação de senha via Neon Auth.", error);
  }

  if (!recoveryAccepted) {
    redirect(withAuthParams(formData, { mode: "recover", email, error: "Não foi possível iniciar a recuperação de senha agora. Tente novamente em alguns instantes." }));
  }

  redirect(
    withAuthParams(formData, {
      mode: "recover",
      email,
      message: "Se o e-mail estiver cadastrado, enviaremos as instruções para recuperar a senha em instantes."
    })
  );
}

export async function signUpWithPasswordAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const orderId = String(formData.get("orderId") ?? "").trim();

  if (!name) {
    redirect(withAuthParams(formData, { mode: "signup", email, error: "Informe seu nome para criar a conta." }));
  }

  if (!email || !isValidEmail(email)) {
    redirect(withAuthParams(formData, { mode: "signup", email, error: "Informe um e-mail válido para criar a conta." }));
  }

  if (!password) {
    redirect(withAuthParams(formData, { mode: "signup", email, error: "Informe uma senha para criar a conta." }));
  }

  if (!passwordConfirmation) {
    redirect(withAuthParams(formData, { mode: "signup", email, error: "Confirme a senha para criar a conta." }));
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    redirect(withAuthParams(formData, { mode: "signup", email, error: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` }));
  }

  if (password !== passwordConfirmation) {
    redirect(withAuthParams(formData, { mode: "signup", email, error: "A senha e a confirmação precisam ser iguais." }));
  }

  const alreadyRegistered = await isProfileEmailRegistered(email);
  if (alreadyRegistered) {
    redirect(withAuthParams(formData, { mode: "signup", email, error: "Já existe uma conta cadastrada com este e-mail. Entre com sua senha ou recupere o acesso." }));
  }

  const { data, error } = await auth.signUp.email({ email, password, name, callbackURL: next });

  if (error) {
    console.error("Falha no cadastro por e-mail e senha com Neon Auth.", error);
    redirect(withAuthParams(formData, { mode: "signup", email, error: getFriendlyAuthError("signup") }));
  }

  const user = (await getCurrentUser()) ?? extractAuthResponseUser(data);
  if (user) {
    await ensureProfileForUser({ ...user, name });
    await claimOrdersForAuthenticatedUser(orderId);
    redirect(next);
  }

  redirect(
    buildSignInUrl({
      mode: "login",
      email,
      next,
      order_id: orderId,
      message: "Conta criada com sucesso. Entre com seu e-mail e senha para acessar o dashboard."
    })
  );
}

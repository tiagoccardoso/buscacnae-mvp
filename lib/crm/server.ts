import "server-only";

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/server";
import { isUuid } from "./input";
import { resolveCrmContext } from "./repository";

export const CRM_WORKSPACE_COOKIE = "buscacnae_crm_ws";

/**
 * Contexto do CRM para a requisição atual. O cookie guarda apenas a PREFERÊNCIA de
 * workspace; a associação é revalidada no banco a cada chamada.
 */
export async function getCrmSession() {
  const user = await getCurrentUser();
  if (!user) return null;
  const cookieStore = await cookies();
  const preferred = cookieStore.get(CRM_WORKSPACE_COOKIE)?.value;
  const { ctx, workspaces } = await resolveCrmContext(user, isUuid(preferred) ? preferred : null);
  return { user, ctx, workspaces };
}

export async function rememberWorkspace(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(CRM_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
}

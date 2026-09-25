import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { AI_NO_STORE, rateLimited, readAskBody, respondWithAnswer } from "@/lib/ai/http";
import { loadAssistantDataset } from "@/lib/ai/server";
import { isUuid, MapSearchNotFoundError } from "@/lib/map/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/ai/ask — “Pergunte ao BuscaCNAE”.
 * Corpo: { searchId, question, context: { view, urlFilters, previous } }.
 *
 * Só lê o universo da busca do próprio usuário (mesma regra da Lista/Mapa/Inteligência);
 * não consulta a Casa dos Dados, não grava nada e não executa SQL vindo do modelo.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Faça login para usar o assistente." }, { status: 401, headers: AI_NO_STORE });

  const parsed = await readAskBody(request);
  if (!parsed.ok) return parsed.response;
  const searchId = typeof parsed.body.searchId === "string" ? parsed.body.searchId : "";
  if (!isUuid(searchId)) return NextResponse.json({ error: "Busca inválida." }, { status: 400, headers: AI_NO_STORE });

  const limited = rateLimited(`user:${user.id}`);
  if (limited) return limited;

  try {
    const dataset = await loadAssistantDataset(searchId, user.id);
    return await respondWithAnswer(parsed.body, dataset);
  } catch (error) {
    if (error instanceof MapSearchNotFoundError) {
      return NextResponse.json({ error: "Busca não encontrada." }, { status: 404, headers: AI_NO_STORE });
    }
    console.error("[ai] falha ao responder", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Não foi possível responder agora. Tente novamente em instantes." }, { status: 500, headers: AI_NO_STORE });
  }
}

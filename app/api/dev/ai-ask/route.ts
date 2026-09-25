import { NextResponse } from "next/server";
import { AI_NO_STORE, rateLimited, readAskBody, respondWithAnswer } from "@/lib/ai/http";
import { syntheticDataset } from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SIZES = new Set([100, 1_000, 10_000, 20_000, 50_000]);

/**
 * Assistente sobre os dados SINTÉTICOS de /dev/mapa (sem login, banco nem Casa dos Dados).
 * Mesmo orquestrador da rota real. Em produção responde 404, salvo MAP_DEV_HARNESS=1.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.MAP_DEV_HARNESS !== "1") {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }
  const parsed = await readAskBody(request);
  if (!parsed.ok) return parsed.response;
  const limited = rateLimited(`dev:${request.headers.get("x-forwarded-for") ?? "local"}`);
  if (limited) return limited;
  const size = Number(new URL(request.url).searchParams.get("n"));
  const dataset = syntheticDataset(ALLOWED_SIZES.has(size) ? size : 1_000);
  try {
    return await respondWithAnswer(parsed.body, dataset);
  } catch (error) {
    console.error("[ai] falha no ambiente local", error);
    return NextResponse.json({ error: "Falha ao responder." }, { status: 500, headers: AI_NO_STORE });
  }
}

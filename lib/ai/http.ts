import { NextResponse } from "next/server";
import {
  getAiAssistantModel,
  getAiAssistantProvider,
  getAiAssistantRateLimit,
  getAiAssistantTimeoutMs,
  getOpenAiApiKey,
  isAiInterpretationEnabled
} from "@/lib/env";
import { answerQuestion, type AssistantDataset, type AssistantOptions } from "@/lib/ai/orchestrator";
import { checkRateLimit } from "@/lib/ai/rate-limit";

/** Regras HTTP comuns da rota real (/api/ai/ask) e da rota local (/api/dev/ai-ask). */

export const AI_NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 16 * 1024;

export function assistantOptionsFromEnv(): AssistantOptions {
  const provider = getAiAssistantProvider();
  const apiKey = getOpenAiApiKey();
  return {
    llm: provider === "openai" && apiKey ? { apiKey, model: getAiAssistantModel(), timeoutMs: getAiAssistantTimeoutMs() } : null,
    interpretation: isAiInterpretationEnabled()
  };
}

export type ParsedAskBody = { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse };

export async function readAskBody(request: Request): Promise<ParsedAskBody> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return { ok: false, response: NextResponse.json({ error: "Envie JSON." }, { status: 415, headers: AI_NO_STORE }) };
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: NextResponse.json({ error: "Pergunta grande demais." }, { status: 413, headers: AI_NO_STORE }) };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "JSON inválido." }, { status: 400, headers: AI_NO_STORE }) };
  }
}

export function rateLimited(key: string) {
  const result = checkRateLimit(key, getAiAssistantRateLimit());
  if (!result.limited) return null;
  return NextResponse.json(
    { error: `Muitas perguntas em pouco tempo. Tente de novo em ${Math.ceil(result.retryAfter / 60)} min.` },
    { status: 429, headers: { ...AI_NO_STORE, "Retry-After": String(result.retryAfter) } }
  );
}

export async function respondWithAnswer(body: Record<string, unknown>, dataset: AssistantDataset, options = assistantOptionsFromEnv()) {
  const answer = await answerQuestion({ question: body.question, context: body.context }, dataset, options);
  // Auditoria mínima: sem o texto da pergunta nem dados de empresas.
  console.info("[ai] pergunta", {
    status: answer.status,
    tool: answer.tool,
    interpreter: answer.engine.interpreter,
    fallback: answer.engine.fallback,
    ms: answer.engine.ms,
    chars: typeof body.question === "string" ? body.question.length : 0
  });
  return NextResponse.json(answer, { headers: AI_NO_STORE });
}

import { NextRequest } from "next/server";
import { formatCnaeCode, normalizeCnaeCode } from "@/lib/cnae-utils";
import { searchCnaeOptions } from "@/lib/cnae-options";
import { getOpenAiApiKey, getOpenAiModel } from "@/lib/env";

type Suggestion = {
  code: string;
  label: string;
  reason: string;
};

function extractFirstJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return value.slice(start, end + 1);
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text) {
    return payload.output_text;
  }

  if (Array.isArray(payload?.output)) {
    const parts: string[] = [];

    for (const item of payload.output) {
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string") parts.push(content.text);
          if (typeof content?.output_text === "string") parts.push(content.output_text);
        }
      }
    }

    return parts.join("\n").trim();
  }

  return "";
}

async function hydrateSuggestions(rawSuggestions: Array<{ code?: string; reason?: string }>) {
  const uniqueCodes = Array.from(
    new Set(
      rawSuggestions
        .map((item) => normalizeCnaeCode(item.code ?? ""))
        .filter(Boolean)
    )
  ).slice(0, 8);

  if (uniqueCodes.length === 0) return [] as Suggestion[];

  const options = await searchCnaeOptions({ ids: uniqueCodes, limit: uniqueCodes.length });
  const optionByCode = new Map(options.map((item) => [item.value, item]));

  return uniqueCodes.map((code) => {
    const raw = rawSuggestions.find((item) => normalizeCnaeCode(item.code ?? "") === code);
    const option = optionByCode.get(code);
    return {
      code,
      label: option?.label ?? formatCnaeCode(code),
      reason: raw?.reason?.trim() || "CNAE sugerido com base no contexto informado."
    };
  });
}

async function buildFallback(message: string) {
  const options = await searchCnaeOptions({ query: message, limit: 6 });
  return {
    answer:
      options.length > 0
        ? "Encontrei CNAEs relacionados ao contexto informado. Você pode adicionar qualquer sugestão abaixo com um clique."
        : "Não encontrei CNAEs diretamente pelo texto. Tente descrever a atividade com mais detalhes, como serviço prestado, setor e tipo de empresa.",
    suggestions: options.map((item) => ({
      code: item.value,
      label: item.label,
      reason: "Sugestão encontrada pelo catálogo público de CNAEs a partir da descrição informada."
    }))
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message?: string;
      selectedCodes?: string[];
    };

    const message = String(body.message ?? "").trim();
    const selectedCodes = Array.isArray(body.selectedCodes)
      ? body.selectedCodes.map((item) => normalizeCnaeCode(String(item))).filter(Boolean)
      : [];

    if (!message) {
      return Response.json({ error: "Informe o contexto do negócio para sugerir CNAEs." }, { status: 400 });
    }

    const apiKey = getOpenAiApiKey();

    if (!apiKey) {
      return Response.json(await buildFallback(message));
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: getOpenAiModel(),
        instructions:
          "Você é um assistente de classificação CNAE para prospecção B2B no Brasil. Responda apenas JSON válido com o formato {\"answer\": string, \"suggestions\": [{\"code\": string, \"reason\": string}]}. Sugira até 6 CNAEs, priorize subclasses brasileiras, use apenas códigos numéricos sem pontuação e não repita códigos já selecionados.",
        input: `Contexto do usuário: ${message}\nCNAEs já selecionados: ${selectedCodes.join(", ") || "nenhum"}`,
        max_output_tokens: 450,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      return Response.json(await buildFallback(message));
    }

    const payload = await response.json();
    const rawText = extractResponseText(payload);
    const jsonText = extractFirstJsonObject(rawText);

    if (!jsonText) {
      return Response.json(await buildFallback(message));
    }

    const parsed = JSON.parse(jsonText) as {
      answer?: string;
      suggestions?: Array<{ code?: string; reason?: string }>;
    };

    const suggestions = await hydrateSuggestions(Array.isArray(parsed.suggestions) ? parsed.suggestions : []);

    if (suggestions.length === 0) {
      return Response.json(await buildFallback(message));
    }

    return Response.json({
      answer:
        typeof parsed.answer === "string" && parsed.answer.trim()
          ? parsed.answer.trim()
          : "Analisei o contexto informado e selecionei CNAEs aderentes para você testar na pesquisa.",
      suggestions
    });
  } catch {
    return Response.json(await buildFallback(""), { status: 200 });
  }
}

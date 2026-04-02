import { NextRequest } from "next/server";
import { normalizeText } from "@/lib/utils";

type IbgeState = {
  id: number;
  sigla: string;
  nome: string;
};

type ResponseState = {
  value: string;
  label: string;
};

async function fetchStates() {
  const response = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados", {
    headers: {
      Accept: "application/json"
    },
    next: {
      revalidate: 60 * 60 * 24 * 30
    }
  });

  if (!response.ok) {
    throw new Error("Falha ao carregar estados.");
  }

  const rows = (await response.json()) as IbgeState[];
  return rows
    .map<ResponseState>((row) => ({
      value: row.sigla.toUpperCase(),
      label: `${row.sigla.toUpperCase()} · ${row.nome}`
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "27");
  const ids = idsParam
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length === 2);

  try {
    const states = await fetchStates();
    const uniqueIds = Array.from(new Set(ids));

    if (uniqueIds.length > 0) {
      const byValue = new Map(states.map((item) => [item.value, item]));
      const items = uniqueIds.map((id) => byValue.get(id) ?? { value: id, label: `${id} · UF selecionada` });
      return Response.json({ items });
    }

    const normalizedQuery = normalizeText(query);
    const items = states
      .filter((item) => {
        if (!normalizedQuery) return true;
        return normalizeText(item.label).includes(normalizedQuery) || item.value.includes(query.trim().toUpperCase());
      })
      .slice(0, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 27);

    return Response.json({ items });
  } catch (error) {
    return Response.json(
      {
        items: [],
        error: error instanceof Error ? error.message : "Falha ao carregar estados."
      },
      { status: 500 }
    );
  }
}

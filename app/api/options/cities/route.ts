import { NextRequest } from "next/server";
import { normalizeText, toTitleCase } from "@/lib/utils";

type IbgeCity = {
  id: number;
  nome: string;
};

type ResponseCity = {
  cityName: string;
  stateCode: string;
  value: string;
  label: string;
};

async function fetchCitiesByState(stateCode: string) {
  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateCode.toUpperCase()}/municipios`,
    {
      headers: {
        Accept: "application/json"
      },
      next: {
        revalidate: 60 * 60 * 24 * 30
      }
    }
  );

  if (!response.ok) {
    throw new Error("Falha ao carregar cidades.");
  }

  const rows = (await response.json()) as IbgeCity[];
  return rows.map<ResponseCity>((row) => ({
    cityName: toTitleCase(row.nome),
    stateCode: stateCode.toUpperCase(),
    value: `${normalizeText(row.nome)}|${stateCode.toUpperCase()}`,
    label: `${toTitleCase(row.nome)} / ${stateCode.toUpperCase()}`
  }));
}

export async function GET(request: NextRequest) {
  const statesParam = request.nextUrl.searchParams.get("states") ?? "";
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");

  const stateCodes = Array.from(
    new Set(
      statesParam
        .split(",")
        .map((item) => item.trim().toUpperCase())
        .filter((item) => item.length === 2)
    )
  );

  if (stateCodes.length === 0) {
    return Response.json({ items: [] });
  }

  const normalizedQuery = normalizeText(query);

  try {
    const groups = await Promise.all(stateCodes.map((stateCode) => fetchCitiesByState(stateCode)));
    const items = groups
      .flat()
      .filter((item) => {
        if (!normalizedQuery) return true;
        return normalizeText(item.cityName).includes(normalizedQuery) || normalizeText(item.label).includes(normalizedQuery);
      })
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"))
      .slice(0, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20);

    return Response.json({ items });
  } catch (error) {
    return Response.json(
      {
        items: [],
        error: error instanceof Error ? error.message : "Falha ao carregar cidades."
      },
      { status: 500 }
    );
  }
}

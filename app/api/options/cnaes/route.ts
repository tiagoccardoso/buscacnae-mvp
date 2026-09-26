import { NextRequest } from "next/server";
import { searchCnaeOptions } from "@/lib/cnae-options";
import { fuzzyCnaeOptions } from "@/lib/search/fuzzy-options";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");

  const ids = idsParam
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    const items = await searchCnaeOptions({
      query,
      ids,
      limit
    });

    // Fase 7: sem resultado exato, tenta a interpretação tolerante a erro ("trasnportadora").
    if (items.length === 0 && ids.length === 0 && query.trim()) {
      const fuzzy = await fuzzyCnaeOptions(query, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 25);
      return Response.json({ items: fuzzy, approximate: fuzzy.length > 0 });
    }

    return Response.json({ items });
  } catch (error) {
    return Response.json(
      {
        items: [],
        error: error instanceof Error ? error.message : "Falha ao carregar catálogo de CNAEs."
      },
      { status: 500 }
    );
  }
}

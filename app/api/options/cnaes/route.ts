import { NextRequest } from "next/server";
import { searchCnaeOptions } from "@/lib/cnae-options";

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

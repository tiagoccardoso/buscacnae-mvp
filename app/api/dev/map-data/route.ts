import { NextResponse } from "next/server";
import { buildSyntheticMapData } from "@/lib/map/dev-fixtures";
import { mapJsonResponse } from "@/lib/map/json-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SIZES = new Set([100, 1_000, 10_000, 20_000, 50_000]);

/**
 * Dados sintéticos do mapa (mesmo formato de GET /api/map/searches/[id]) para o ambiente
 * local de validação (/dev/mapa). Em produção responde 404, salvo MAP_DEV_HARNESS=1.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.MAP_DEV_HARNESS !== "1") {
    return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  }
  const size = Number(new URL(request.url).searchParams.get("n"));
  const data = buildSyntheticMapData(ALLOWED_SIZES.has(size) ? size : 1_000);
  return mapJsonResponse(request, data, { headers: { "Cache-Control": "no-store" } });
}

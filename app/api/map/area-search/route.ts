import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { runAreaSearch } from "@/lib/map/area-search-service";
import type { AreaSearchResponse, GeoBounds } from "@/lib/map/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function readBounds(value: unknown): GeoBounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ["west", "south", "east", "north"] as const;
  if (!keys.every((key) => typeof record[key] === "number" && Number.isFinite(record[key]))) return null;
  return { west: record.west as number, south: record.south as number, east: record.east as number, north: record.north as number };
}

/**
 * "Buscar nesta área": ação explícita do usuário (nunca disparada por movimento de câmera).
 * Converte a área visível em municípios e executa a busca oficial da Casa dos Dados.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json<AreaSearchResponse>(
      { ok: false, reason: "invalid", message: "Faça login para continuar." },
      { status: 401, headers: NO_STORE }
    );
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const bounds = readBounds(record.bounds);
  const searchId = typeof record.searchId === "string" ? record.searchId : "";

  if (!bounds || !searchId) {
    return NextResponse.json<AreaSearchResponse>(
      { ok: false, reason: "invalid", message: "Não foi possível identificar a área visível." },
      { status: 400, headers: NO_STORE }
    );
  }

  try {
    const result = await runAreaSearch({ profileId: user.id, email: user.email ?? "", sourceSearchId: searchId, bounds });
    if (result.ok) {
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/history");
    }
    return NextResponse.json<AreaSearchResponse>(result, { status: result.ok ? 200 : 422, headers: NO_STORE });
  } catch (error) {
    console.error("[map] falha em buscar nesta área", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json<AreaSearchResponse>(
      { ok: false, reason: "error", message: "Não foi possível buscar nesta área agora. Tente novamente em instantes." },
      { status: 500, headers: NO_STORE }
    );
  }
}

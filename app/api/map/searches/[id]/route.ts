import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getSearchMapData, MapSearchNotFoundError } from "@/lib/map/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ id: string }>;
};

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Dados do Mapa Empresarial para uma busca salva do usuário autenticado.
 * Lê o que a busca oficial (Casa dos Dados) já gravou; não dispara nova consulta
 * à Casa dos Dados. Respeita a regra de liberação da lista (amostra antes da compra).
 */
export async function GET(_request: Request, { params }: RouteProps) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Faça login para ver o mapa." }, { status: 401, headers: NO_STORE });
  }

  const { id } = await params;

  try {
    const data = await getSearchMapData(id, user.id);
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MapSearchNotFoundError) {
      return NextResponse.json({ error: "Busca não encontrada." }, { status: 404, headers: NO_STORE });
    }
    console.error("[map] falha ao montar dados do mapa", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json(
      { error: "Não foi possível carregar o mapa agora. Tente novamente em instantes." },
      { status: 500, headers: NO_STORE }
    );
  }
}

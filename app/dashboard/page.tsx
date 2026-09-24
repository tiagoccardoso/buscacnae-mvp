import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { formatDateTime } from "@/lib/format";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const db = createDbClient();
  const [{ count: searchCount }, { count: leadCount }, { count: orderCount }, latestSearch] = await Promise.all([
    db.from("search_queries").select("*", { count: "exact", head: true }).eq("profile_id", user.id),
    db.from("saved_establishments").select("*", { count: "exact", head: true }).eq("profile_id", user.id),
    db.from("search_access_orders").select("*", { count: "exact", head: true }).eq("profile_id", user.id),
    db
      .from("search_queries")
      .select("id, cnae_code, city_name, state_code, created_at, total_results")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const latestSearchId = latestSearch.data?.id ?? null;
  const latestOrder = latestSearchId
    ? await db
        .from("search_access_orders")
        .select("result_count")
        .eq("search_query_id", latestSearchId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const searchTotal = searchCount ?? 0;
  const leadTotal = leadCount ?? 0;
  const orderTotal = orderCount ?? 0;
  const latestResults = latestOrder.data?.result_count ?? latestSearch.data?.total_results ?? 0;

  return (
    <>
      <section className="section" aria-labelledby="dashboard-overview">
        <h2 id="dashboard-overview" className="sr-only">Visão geral</h2>
        <div className="stat-group">
          <div className="stat">
            <span className="stat-value">{searchTotal}</span>
            <span className="stat-label">Buscas realizadas</span>
          </div>
          <div className="stat">
            <span className="stat-value">{orderTotal}</span>
            <span className="stat-label">Pedidos gerados</span>
          </div>
          <div className="stat">
            <span className="stat-value">{leadTotal}</span>
            <span className="stat-label">Leads salvos</span>
          </div>
          <div className="stat">
            <span className="stat-value">{latestResults}</span>
            <span className="stat-label">Resultados na última busca</span>
          </div>
        </div>
        <p className="footnote">
          Modelo de compra: uma lista por vez. Pesquise, veja a prévia, pague e reabra a lista quando quiser pelo histórico.
        </p>
      </section>

      <section className="grid-2" aria-label="Atalhos">
        <div className="tile stack-lg">
          <div className="section-header">
            <span className="eyebrow">Última busca</span>
            {latestSearch.data ? (
              <>
                <h2 className="title-2">
                  {latestSearch.data.cnae_code} · {latestSearch.data.city_name}/{latestSearch.data.state_code}
                </h2>
                <p className="section-copy">
                  {latestResults} resultados encontrados em {formatDateTime(latestSearch.data.created_at)}.
                </p>
              </>
            ) : (
              <>
                <h2 className="title-2">Nenhuma busca ainda</h2>
                <p className="section-copy">Você ainda não executou nenhuma busca no dashboard.</p>
              </>
            )}
          </div>
          <div className="cluster">
            {latestSearch.data ? (
              <>
                <Link href={`/dashboard/search/${latestSearch.data.id}`} className="button-secondary">
                  Abrir resultado
                </Link>
                <Link href={`/dashboard/search?reuse=${latestSearch.data.id}`} className="button-ghost">
                  Repetir busca
                </Link>
              </>
            ) : (
              <Link href="/dashboard/search" className="button-secondary">
                Fazer primeira busca
              </Link>
            )}
          </div>
        </div>

        <div className="tile stack-lg">
          <div className="section-header">
            <span className="eyebrow">Próxima ação</span>
            <h2 className="title-2">Rode uma nova busca ou reaproveite o que já funcionou.</h2>
            <p className="section-copy">
              Repita recortes, compare buscas, salve empresas e continue a operação sem refazer tudo do zero.
            </p>
          </div>
          <div className="cluster">
            <Link href="/dashboard/search" className="button" data-analytics-event="search_started" data-analytics-label="Dashboard nova busca">
              Nova busca
            </Link>
            <Link href="/dashboard/history" className="button-ghost">
              Abrir histórico
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import { DashboardImpactVisuals } from "@/components/dashboard-impact-visuals";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const [{ count: searchCount }, { count: leadCount }, { count: orderCount }, latestSearch] = await Promise.all([
    admin.from("search_queries").select("*", { count: "exact", head: true }).eq("profile_id", user.id),
    admin.from("saved_establishments").select("*", { count: "exact", head: true }).eq("profile_id", user.id),
    admin.from("search_access_orders").select("*", { count: "exact", head: true }).eq("profile_id", user.id),
    admin
      .from("search_queries")
      .select("id, cnae_code, city_name, state_code, created_at, total_results")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const latestSearchId = latestSearch.data?.id ?? null;
  const latestOrder = latestSearchId
    ? await admin
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
  const latestCity = latestSearch.data?.city_name ?? "Sem buscas";

  return (
    <div className="stack dashboard-premium-stack">
      <div className="grid-3 metric-surface-grid dashboard-connected-grid">
        <div className="surface-premium card metric metric-card metric-card-premium">
          <span className="kicker">Modelo de compra</span>
          <strong>Uma lista por vez</strong>
          <span className="muted">Pesquise, veja a prévia, pague e reabra a lista quando quiser pelo histórico.</span>
        </div>
        <div className="surface-premium card metric metric-card metric-card-premium">
          <span className="kicker">Buscas realizadas</span>
          <strong>{searchTotal}</strong>
          <span className="muted">Pesquisas registradas para reuso de filtros, comparação e recompra.</span>
        </div>
        <div className="surface-premium card metric metric-card metric-card-premium">
          <span className="kicker">Pedidos gerados</span>
          <strong>{orderTotal}</strong>
          <span className="muted">Listas criadas a partir das pesquisas feitas na plataforma.</span>
        </div>
      </div>

      <DashboardImpactVisuals
        searchCount={searchTotal}
        leadCount={leadTotal}
        latestResults={latestResults}
        latestCity={latestCity}
      />

      <div className="panel-grid two">
        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Próxima ação</span>
          <h2 className="section-title">Rode uma nova busca ou reaproveite o que já funcionou.</h2>
          <p className="section-copy">
            O dashboard serve para produtividade comercial: repetir recortes, comparar buscas, salvar empresas e continuar a operação sem refazer tudo do zero.
          </p>
          <div className="inline-actions">
            <Link href="/dashboard/search" className="button" data-analytics-event="search_started" data-analytics-label="Dashboard nova busca">
              Nova busca
            </Link>
            <Link href="/dashboard/history" className="button-ghost">
              Abrir histórico
            </Link>
          </div>
        </div>

        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Última busca</span>
          {latestSearch.data ? (
            <>
              <h2 className="section-title" style={{ marginBottom: 0 }}>
                {latestSearch.data.cnae_code} · {latestSearch.data.city_name}/{latestSearch.data.state_code}
              </h2>
              <p className="section-copy">
                {latestResults} resultados encontrados em {formatDateTime(latestSearch.data.created_at)}.
              </p>
              <div className="stat-grid stat-grid-premium">
                <div className="stat-box stat-box-premium">
                  <strong>{latestResults}</strong>
                  <span className="muted">Empresas retornadas</span>
                </div>
                <div className="stat-box stat-box-premium">
                  <strong>{latestSearch.data.city_name}</strong>
                  <span className="muted">Município da busca</span>
                </div>
                <div className="stat-box stat-box-premium">
                  <strong>{latestSearch.data.cnae_code}</strong>
                  <span className="muted">CNAE principal</span>
                </div>
              </div>
              <div className="inline-actions">
                <Link href={`/dashboard/search/${latestSearch.data.id}`} className="button-secondary">
                  Abrir resultado
                </Link>
                <Link href={`/dashboard/search?reuse=${latestSearch.data.id}`} className="button-ghost">
                  Repetir busca
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="section-copy">Você ainda não executou nenhuma busca no dashboard.</p>
              <Link href="/dashboard/search" className="button-ghost">
                Fazer primeira busca
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

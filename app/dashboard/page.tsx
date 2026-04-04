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

  const searchTotal = searchCount ?? 0;
  const leadTotal = leadCount ?? 0;
  const paidOrdersTotal = orderCount ?? 0;
  const latestResults = latestSearch.data?.total_results ?? 0;
  const latestCity = latestSearch.data?.city_name ?? "Sem buscas";

  return (
    <div className="stack dashboard-premium-stack">
      <div className="grid-3 metric-surface-grid dashboard-connected-grid">
        <div className="surface-premium card metric metric-card metric-card-premium">
          <span className="kicker">Modelo comercial</span>
          <strong>Pagamento avulso</strong>
          <span className="muted">Cada lista é cobrada individualmente e liberada após a confirmação do checkout.</span>
        </div>
        <div className="surface-premium card metric metric-card metric-card-premium">
          <span className="kicker">Buscas realizadas</span>
          <strong>{searchTotal}</strong>
          <span className="muted">Consultas registradas com histórico, rastreabilidade e visão comercial consolidada.</span>
        </div>
        <div className="surface-premium card metric metric-card metric-card-premium">
          <span className="kicker">Pedidos gerados</span>
          <strong>{paidOrdersTotal}</strong>
          <span className="muted">Pedidos avulsos criados a partir das buscas públicas e autenticadas.</span>
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
          <h2 className="section-title">Continue operando com a mesma linguagem premium da landing page.</h2>
          <p className="section-copy">
            Rode uma nova busca, refine seu recorte e mantenha a transição entre pesquisa pública e governança interna com a mesma clareza visual.
          </p>
          <div className="inline-actions">
            <Link href="/dashboard/search" className="button">
              Abrir formulário de busca
            </Link>
            <Link href="/dashboard/leads" className="button-ghost">
              Ver leads salvos
            </Link>
          </div>
        </div>

        <div className="surface-premium card-lg stack">
          <span className="eyebrow">Última consulta</span>
          {latestSearch.data ? (
            <>
              <h2 className="section-title" style={{ marginBottom: 0 }}>
                {latestSearch.data.cnae_code} · {latestSearch.data.city_name}/{latestSearch.data.state_code}
              </h2>
              <p className="section-copy">
                {latestSearch.data.total_results} resultados encontrados em {formatDateTime(latestSearch.data.created_at)}.
              </p>
              <div className="stat-grid stat-grid-premium">
                <div className="stat-box stat-box-premium">
                  <strong>{latestSearch.data.total_results}</strong>
                  <span className="muted">Empresas retornadas</span>
                </div>
                <div className="stat-box stat-box-premium">
                  <strong>{latestSearch.data.city_name}</strong>
                  <span className="muted">Município da busca</span>
                </div>
                <div className="stat-box stat-box-premium">
                  <strong>{latestSearch.data.cnae_code}</strong>
                  <span className="muted">Subclasse CNAE usada</span>
                </div>
              </div>
              <Link href={`/dashboard/search/${latestSearch.data.id}`} className="button-secondary">
                Ver resultado da busca
              </Link>
            </>
          ) : (
            <>
              <p className="section-copy">Você ainda não executou nenhuma busca neste ambiente premium.</p>
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?message=Faça login para acessar o dashboard.");
  }

  return (
    <main className="page">
      <section className="container dashboard-shell">
        <div className="surface-premium card-lg dashboard-command-center">
          <div className="dashboard-command-copy stack">
            <span className="eyebrow">Dashboard premium</span>
            <h1 className="display-title" style={{ fontSize: "clamp(2rem, 4vw, 3.6rem)" }}>
              Inteligência comercial com visual de produto enterprise.
            </h1>
            <p className="lead-copy">
              Acompanhe histórico, listas liberadas e detalhes de empresas em uma interface com profundidade,
              animação controlada e leitura imediata.
            </p>
            <div className="inline-actions">
              <span className="pill">{user.email}</span>
              <span className="pill success">Pagamento avulso</span>
            </div>
          </div>

          <div className="surface card-lg stack command-card-shell">
            <div className="command-kpi-grid">
              <div className="command-kpi">
                <span className="kicker">Modo</span>
                <strong>Governança</strong>
              </div>
              <div className="command-kpi">
                <span className="kicker">Função</span>
                <strong>Histórico e detalhe</strong>
              </div>
            </div>
            <div className="glow-divider" />
            <div className="dashboard-nav dashboard-nav-premium">
              <Link href="/dashboard">Resumo</Link>
              <Link href="/dashboard/search">Nova busca</Link>
              <Link href="/dashboard/history">Histórico</Link>
              <Link href="/dashboard/leads">Leads salvos</Link>
              <Link href="/onboarding">Onboarding</Link>
              <Link href="/pricing">Preço por resultado</Link>
            </div>
            <span className="muted">
              A navegação abaixo organiza operação, revisão de listas e acesso aos principais pontos do sistema em uma única camada visual.
            </span>
          </div>
        </div>

        {children}
      </section>
    </main>
  );
}

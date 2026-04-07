import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

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
            <span className="eyebrow">Dashboard</span>
            <h1 className="display-title" style={{ fontSize: "clamp(2rem, 4vw, 3.6rem)" }}>
              Histórico, listas, leads salvos e recompra em um só lugar.
            </h1>
            <p className="lead-copy">
              O dashboard é a camada de organização do produto. Use para reabrir listas, repetir buscas, salvar leads e seguir operando depois da compra.
            </p>
            <div className="inline-actions">
              <span className="pill">{user.email}</span>
              <span className="pill success">Compra avulsa por lista</span>
            </div>
          </div>

          <div className="surface card-lg stack command-card-shell">
            <div className="command-kpi-grid">
              <div className="command-kpi">
                <span className="kicker">Função</span>
                <strong>Histórico e recompra</strong>
              </div>
              <div className="command-kpi">
                <span className="kicker">Rotina</span>
                <strong>Reabrir, repetir e salvar</strong>
              </div>
            </div>
            <div className="glow-divider" />
            <div className="dashboard-nav dashboard-nav-premium">
              <Link href="/dashboard">Resumo</Link>
              <Link href="/dashboard/search">Nova busca</Link>
              <Link href="/dashboard/history">Histórico</Link>
              <Link href="/dashboard/leads">Leads salvos</Link>
              <Link href="/pricing">Preços</Link>
              <Link href="/faq">FAQ</Link>
            </div>
            <span className="muted">
              Reaproveite filtros, acompanhe compras e mantenha o material comercial organizado sem transformar o fluxo principal em um sistema pesado.
            </span>
          </div>
        </div>

        {children}
      </section>
    </main>
  );
}

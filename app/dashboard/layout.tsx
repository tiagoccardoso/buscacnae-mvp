import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/server";
import { DashboardNav } from "@/components/dashboard-nav";

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
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in?message=Faça login para acessar o dashboard.");
  }

  return (
    <main className="page">
      <div className="container">
        <header className="dashboard-header enter">
          <div className="stack-xs">
            <span className="eyebrow">Dashboard</span>
            <h1 className="title-large">Suas listas</h1>
            <p className="footnote dashboard-account">
              {user.email} · Compra avulsa por lista
            </p>
          </div>
          <DashboardNav />
        </header>

        <div className="dashboard-body">{children}</div>
      </div>
    </main>
  );
}

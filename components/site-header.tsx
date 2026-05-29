import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/server";
import { getAppName } from "@/lib/env";
import { SignOutButton } from "@/components/sign-out-button";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="container nav-shell">
      <nav className="nav nav-premium" aria-label="Navegação principal">
        <Link href="/" className="brand" data-analytics-event="header_brand_clicked" data-analytics-label="Brand">
          <span className="brand-badge">BC</span>
          <span>{getAppName()}</span>
        </Link>

        <div className="nav-links nav-links-premium">
          <Link href="/pricing" className="button-ghost" data-analytics-event="nav_pricing_opened">
            Preços
          </Link>
          <Link href="/onboarding" className="button-ghost" data-analytics-event="nav_onboarding_opened">
            Como funciona
          </Link>
          <Link href="/faq" className="button-ghost" data-analytics-event="nav_faq_opened">
            FAQ
          </Link>
          {user ? (
            <>
              <Link href="/dashboard" className="button-secondary" data-analytics-event="dashboard_opened" data-analytics-label="Header dashboard">
                Dashboard
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/" className="button" data-analytics-event="search_entry_clicked" data-analytics-label="Header pesquisar">
                Fazer pesquisa
              </Link>
              <Link href="/sign-in" className="button-ghost" data-analytics-event="login_started" data-analytics-label="Header entrar">
                Entrar
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

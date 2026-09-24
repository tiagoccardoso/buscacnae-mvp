import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/server";
import { getAppName } from "@/lib/env";
import { SignOutButton } from "@/components/sign-out-button";
import { SiteMobileNav } from "@/components/site-mobile-nav";

const primaryLinks = [
  { href: "/pricing", label: "Preços", event: "nav_pricing_opened" },
  { href: "/onboarding", label: "Como funciona", event: "nav_onboarding_opened" },
  { href: "/faq", label: "FAQ", event: "nav_faq_opened" }
];

export async function SiteHeader() {
  const user = await getCurrentUser();
  const appName = getAppName();

  return (
    <header className="site-header glass">
      <nav className="container site-nav" aria-label="Navegação principal">
        <Link href="/" className="brand" data-analytics-event="header_brand_clicked" data-analytics-label="Brand">
          <span className="brand-mark" aria-hidden="true">BC</span>
          <span>{appName}</span>
        </Link>

        <div className="nav-links">
          {primaryLinks.map((link) => (
            <Link key={link.href} href={link.href} className="nav-link" data-analytics-event={link.event}>
              {link.label}
            </Link>
          ))}
        </div>

        <div className="nav-actions">
          {user ? (
            <>
              <Link href="/dashboard" className="button-secondary" data-analytics-event="dashboard_opened" data-analytics-label="Header dashboard">
                Dashboard
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/sign-in" className="button-ghost is-neutral" data-analytics-event="login_started" data-analytics-label="Header entrar">
                Entrar
              </Link>
              <Link href="/" className="button" data-analytics-event="search_entry_clicked" data-analytics-label="Header pesquisar">
                Fazer pesquisa
              </Link>
            </>
          )}
        </div>

        <SiteMobileNav links={primaryLinks} isSignedIn={Boolean(user)} />
      </nav>
    </header>
  );
}

import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppName } from "@/lib/env";
import { SignOutButton } from "@/components/sign-out-button";

export async function SiteHeader() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <header className="container nav-shell">
      <nav className="nav nav-premium">
        <Link href="/" className="brand">
          <span className="brand-badge">BC</span>
          <span>{getAppName()}</span>
        </Link>

        <div className="nav-links nav-links-premium">
          <Link href="/pricing" className="button-ghost">
            Como funciona
          </Link>
          <Link href="/onboarding" className="button-ghost">
            Onboarding
          </Link>
          {user ? (
            <>
              <Link href="/dashboard" className="button-secondary">
                Dashboard
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/" className="button">
                Fazer pesquisa
              </Link>
              <Link href="/sign-in" className="button-ghost">
                Entrar no dashboard
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

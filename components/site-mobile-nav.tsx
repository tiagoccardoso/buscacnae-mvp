"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SignOutButton } from "@/components/sign-out-button";

type NavLink = {
  href: string;
  label: string;
  event: string;
};

type SiteMobileNavProps = {
  links: NavLink[];
  isSignedIn: boolean;
};

/** Menu de navegação para telas estreitas. Fecha com Esc, clique fora ou troca de rota. */
export function SiteMobileNav({ links, isSignedIn }: SiteMobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handlePointer);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("pointerdown", handlePointer);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="button-icon nav-menu-toggle"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="nav-menu-icon" aria-hidden="true" />
      </button>

      <div ref={menuRef} id={menuId} className="mobile-menu" hidden={!open}>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="nav-link" data-analytics-event={link.event}>
            {link.label}
          </Link>
        ))}

        <div className="mobile-menu-actions">
          {isSignedIn ? (
            <>
              <Link href="/dashboard" className="button-secondary" data-analytics-event="dashboard_opened" data-analytics-label="Mobile dashboard">
                Dashboard
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/" className="button" data-analytics-event="search_entry_clicked" data-analytics-label="Mobile pesquisar">
                Fazer pesquisa
              </Link>
              <Link href="/sign-in" className="button-secondary" data-analytics-event="login_started" data-analytics-label="Mobile entrar">
                Entrar
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}

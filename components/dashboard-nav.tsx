"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Resumo", match: (path: string) => path === "/dashboard" },
  { href: "/dashboard/search", label: "Nova busca", match: (path: string) => path === "/dashboard/search" },
  {
    href: "/dashboard/history",
    label: "Histórico",
    match: (path: string) => path.startsWith("/dashboard/history") || /^\/dashboard\/search\/[^/]+/.test(path)
  },
  {
    href: "/dashboard/leads",
    label: "Leads salvos",
    match: (path: string) => path.startsWith("/dashboard/leads") || path.startsWith("/dashboard/companies")
  }
];

/** Navegação do dashboard como controle segmentado, com indicação da seção atual. */
export function DashboardNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="segmented" aria-label="Seções do dashboard">
      {items.map((item) => {
        const active = item.match(pathname);
        return (
          <Link key={item.href} href={item.href} className="segmented-item" aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

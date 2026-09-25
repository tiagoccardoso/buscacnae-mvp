import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Renderização (SSR) da tabela de resultados: paginação inicial, estados e acessibilidade.
 * A virtualização é client-side (TanStack Virtual); aqui garantimos que o HTML inicial
 * nunca monta a lista inteira.
 */
process.env.DATABASE_URL = "postgresql://u:p@localhost.invalid/db";

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { CompanyResultsTable } = await import("../components/results/company-results-table.tsx");

type ListItem = import("../lib/company-model.ts").CompanyListItem;

function item(index: number): ListItem {
  return {
    id: `id-${index}`,
    position: index + 1,
    cnpj: String(10000000000100 + index),
    legalName: `EMPRESA ${index} LTDA`,
    tradeName: null,
    status: "ATIVA",
    openedAt: "2019-05-02",
    headquartersOrBranch: "matriz",
    size: null,
    shareCapital: 1000,
    simplesOptIn: null,
    meiOptIn: null,
    legalNature: null,
    primaryCnae: "4781400",
    primaryCnaeDescription: null,
    secondaryCnaes: [],
    city: "Campinas",
    state: "SP",
    neighborhood: null,
    postalCode: null,
    addressSummary: null,
    email: null,
    phone: null,
    phoneIsMobile: false,
    website: null,
    saved: false
  };
}

function render(items: ListItem[], props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    React.createElement(CompanyResultsTable, { items, variant: "order", caption: "Teste", ...props })
  );
}

test("1.000 resultados: HTML inicial só com a primeira página (25 linhas)", () => {
  const html = render(Array.from({ length: 1000 }, (_, i) => item(i)));
  const rows = html.match(/aria-rowindex="/g) ?? [];
  assert.equal(rows.length, 25);
  assert.ok(html.includes("Página 1 de 40"));
  assert.ok(html.includes("1.000 empresas"));
  assert.ok(html.includes('aria-rowcount="1001"'));
});

test("acessibilidade: caption, cabeçalhos ordenáveis com aria-sort e checkboxes rotulados", () => {
  const html = render([item(0), item(1)]);
  assert.ok(html.includes('<caption class="sr-only">Teste</caption>'));
  assert.ok(html.includes('aria-sort="ascending"'), "coluna # ordenada por padrão");
  assert.ok(html.includes('aria-label="Selecionar todas as empresas"'));
  assert.ok(html.includes('aria-label="Selecionar EMPRESA 0 LTDA"'));
  assert.ok(html.includes("02/05/2019"));
  assert.equal(html.includes("Ver ficha"), false, "pedido público não linka a ficha do dashboard");
});

test("dashboard: link da ficha e botão de carteira", () => {
  const html = render([item(0)], {
    variant: "dashboard",
    showCompanyLink: true,
    saveSelectionAction: async () => ({ ok: true, saved: 0 }),
    toggleSavedAction: async () => undefined
  });
  assert.ok(html.includes("/dashboard/companies/10000000000100"));
  assert.ok(html.includes("Salvar na carteira"));
});

test("estado vazio de filtros não quebra com lista vazia", () => {
  const html = render([]);
  assert.ok(html.includes("Nenhuma empresa corresponde aos filtros."));
});

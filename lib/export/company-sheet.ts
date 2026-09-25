import type { Company } from "@/lib/company-model";
import { formatCnpj, formatDate, formatMoney } from "@/lib/format";

/**
 * Planilha "Leads CRM" montada a partir do modelo normalizado Company.
 * Colunas declaradas uma única vez (cabeçalho, largura, quebra e valor) para
 * que índices de largura/quebra nunca fiquem desalinhados.
 */
type CrmColumn = {
  header: string;
  width: number;
  wrap?: boolean;
  value: (company: Company, position: number) => string;
};

function text(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function yesNo(value: boolean | null) {
  return value === null ? "" : value ? "Sim" : "Não";
}

function cnaeList(company: Company) {
  return company.secondaryCnaes
    .map((cnae) => (cnae.code && cnae.description ? `${cnae.code} - ${cnae.description}` : cnae.description ?? cnae.code ?? ""))
    .filter(Boolean)
    .join(" • ");
}

export const COMPANY_CRM_COLUMNS: CrmColumn[] = [
  { header: "Posição", width: 10, value: (_c, position) => text(position) },
  { header: "CNPJ", width: 22, value: (c) => formatCnpj(c.cnpj) },
  { header: "Raiz do CNPJ", width: 16, value: (c) => text(c.cnpjRoot) },
  { header: "Razão Social", width: 34, value: (c) => text(c.legalName) },
  { header: "Nome Fantasia", width: 28, value: (c) => text(c.tradeName) },
  {
    header: "Matriz/Filial",
    width: 12,
    value: (c) => (c.headquartersOrBranch === "matriz" ? "Matriz" : c.headquartersOrBranch === "filial" ? "Filial" : "")
  },
  { header: "Situação Cadastral", width: 18, value: (c) => text(c.status) },
  { header: "Data de Abertura", width: 14, value: (c) => (c.openedAt ? formatDate(c.openedAt) : "") },
  { header: "CNAE Principal", width: 16, value: (c) => text(c.primaryCnae.code) },
  { header: "Descrição CNAE Principal", width: 34, wrap: true, value: (c) => text(c.primaryCnae.description) },
  { header: "CNAEs Secundários", width: 46, wrap: true, value: (c) => cnaeList(c) },
  { header: "Código Natureza Jurídica", width: 16, value: (c) => text(c.legalNature.code) },
  { header: "Natureza Jurídica", width: 28, wrap: true, value: (c) => text(c.legalNature.description) },
  { header: "Porte", width: 18, value: (c) => text(c.size) },
  { header: "Simples", width: 10, value: (c) => yesNo(c.simplesOptIn) },
  { header: "MEI", width: 10, value: (c) => yesNo(c.meiOptIn) },
  { header: "Capital Social", width: 16, value: (c) => (c.shareCapital === null ? "" : formatMoney(c.shareCapital)) },
  { header: "Telefone", width: 18, wrap: true, value: (c) => text(c.contacts.phone) },
  { header: "E-mail", width: 30, wrap: true, value: (c) => text(c.contacts.email) },
  { header: "Site", width: 24, value: (c) => text(c.contacts.website) },
  { header: "País", width: 12, value: (c) => text(c.address.country) },
  { header: "UF", width: 8, value: (c) => text(c.address.state) },
  { header: "Cidade", width: 22, value: (c) => text(c.address.city) },
  { header: "IBGE Cidade", width: 14, value: (c) => text(c.address.cityIbge) },
  { header: "Bairro", width: 18, wrap: true, value: (c) => text(c.address.neighborhood) },
  { header: "CEP", width: 14, value: (c) => text(c.address.postalCode) },
  { header: "Endereço", width: 44, wrap: true, value: (c) => text(c.address.street) },
  { header: "Número", width: 12, value: (c) => text(c.address.number) },
  { header: "Complemento", width: 18, wrap: true, value: (c) => text(c.address.complement) }
];

export function buildCompanyCrmSheet(entries: Array<{ position: number; company: Company }>) {
  return {
    rows: [
      COMPANY_CRM_COLUMNS.map((column) => column.header),
      ...entries.map(({ position, company }) => COMPANY_CRM_COLUMNS.map((column) => column.value(company, position)))
    ],
    columnWidths: COMPANY_CRM_COLUMNS.map((column) => column.width),
    wrapColumns: COMPANY_CRM_COLUMNS.flatMap((column, index) => (column.wrap ? [index] : []))
  };
}

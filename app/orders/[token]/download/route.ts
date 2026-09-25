import { NextResponse } from "next/server";
import { getSearchAccessOrderByAccessToken, syncSearchAccessOrderPaymentStatus } from "@/lib/billing";
import { mergeEstablishmentSources } from "@/lib/establishment-canonical";
import { buildDisplayEstablishment, getEstablishmentPayload } from "@/lib/establishment-presenter";
import { createXlsxWorkbook } from "@/lib/export/xlsx";
import { buildCompanyCrmSheet } from "@/lib/export/company-sheet";
import { companyFromEstablishment, type Company } from "@/lib/company-model";
import { buildEstablishmentDetailSections } from "@/lib/establishment-detail-sections";
import { formatCnpj, formatDate, formatMoney } from "@/lib/format";
import { createDbClient } from "@/lib/db-client";
import { extractSingleObject } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DownloadRouteProps = {
  params: Promise<{ token: string }> | { token: string };
};

function sanitizeFilePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value).trim();
}

function formatSecondaryCnaes(value: unknown) {
  const formatEntry = (item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const code = toCell(record.codigo ?? record.code ?? record.id ?? record.subclasse);
      const description = toCell(record.descricao ?? record.description ?? record.text);
      if (code && description) return `${code} - ${description}`;
      if (description) return description;
      if (code) return code;
      return "";
    }

    return toCell(item);
  };

  if (!Array.isArray(value)) {
    return formatEntry(value);
  }

  return value
    .map((item) => formatEntry(item))
    .filter(Boolean)
    .join(" • ");
}

function formatMaybeDate(value: unknown) {
  const text = toCell(value);
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? formatDate(text) : text;
}

function formatMaybeMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  return formatMoney(value as number | string);
}

function buildFichaRows(position: unknown, establishment: Record<string, unknown>) {
  const display = buildDisplayEstablishment(establishment);
  const payload = getEstablishmentPayload(display);
  const rawJsonPayload = payload ?? display.provider_payload;
  const { primaryFields } = buildEstablishmentDetailSections(display, rawJsonPayload);

  const rows: string[][] = [];
  const push = (group: string, field: string, value: unknown, keepEmpty = false) => {
    const formatted = toCell(value);
    if (!formatted && !keepEmpty) return;
    rows.push([
      toCell(position),
      formatCnpj(toCell(display.cnpj)),
      toCell(display.company_name),
      group,
      field,
      formatted || "-"
    ]);
  };

  for (const field of primaryFields) {
    const value = field.key === "opened_at"
      ? formatMaybeDate(field.value)
      : field.key === "capital_social" || field.key.toLowerCase().includes("capital")
        ? formatMaybeMoney(field.value)
        : field.key === "secondary_cnaes"
          ? formatSecondaryCnaes(field.value)
          : field.value;

    push("Dados principais", field.label, value, true);
  }


  rows.push(["", "", "", "", "", ""]);
  return rows;
}

export async function GET(_request: Request, { params }: DownloadRouteProps) {
  const { token } = await params;
  const initialOrder = await getSearchAccessOrderByAccessToken(token);

  if (!initialOrder) {
    return new NextResponse("Pedido não encontrado.", { status: 404 });
  }

  const order = await syncSearchAccessOrderPaymentStatus(initialOrder);

  if (!["paid", "free"].includes(order.status)) {
    return new NextResponse("A lista ainda não foi liberada para download.", { status: 403 });
  }

  const db = createDbClient();
  const [{ data: search }, { data: rows }] = await Promise.all([
    db
      .from("search_queries")
      .select("cnae_code, city_name, state_code, created_at")
      .eq("id", order.search_query_id)
      .maybeSingle(),
    db
      .from("search_results")
      .select("position, establishment_id, provider_payload, establishments(*)")
      .eq("search_query_id", order.search_query_id)
      .order("position", { ascending: true })
  ]);

  const crmEntries: Array<{ position: number; company: Company }> = [];

  const fichaSheetRows: string[][] = [
    ["Posição", "CNPJ", "Razão Social", "Grupo", "Campo", "Valor"]
  ];

  for (const row of rows ?? []) {
    const establishment = extractSingleObject(row.establishments);
    if (!establishment) continue;

    const mergedEstablishment = mergeEstablishmentSources(establishment, extractSingleObject(row.provider_payload));

    // Planilha CRM a partir do modelo normalizado (lib/company-model.ts).
    crmEntries.push({ position: Number(row.position ?? 0), company: companyFromEstablishment(mergedEstablishment) });

    fichaSheetRows.push(...buildFichaRows(row.position, mergedEstablishment));
  }

  const crmSheet = buildCompanyCrmSheet(crmEntries);
  const workbook = createXlsxWorkbook({
    sheets: [
      {
        name: "Leads CRM",
        rows: crmSheet.rows,
        columnWidths: crmSheet.columnWidths,
        wrapColumns: crmSheet.wrapColumns,
        freezeHeader: true,
        autoFilter: true
      },
      {
        name: "Ficha completa",
        rows: fichaSheetRows,
        columnWidths: [10, 22, 34, 18, 24, 96],
        wrapColumns: [5],
        freezeHeader: true,
        autoFilter: true
      }
    ]
  });

  const fileParts = [
    "buscacnae",
    sanitizeFilePart(search?.cnae_code ?? "pesquisa"),
    sanitizeFilePart(search?.city_name ?? "lista"),
    sanitizeFilePart(search?.state_code ?? "br"),
    order.id.slice(0, 8)
  ].filter(Boolean);
  const filename = `${fileParts.join("-")}.xlsx`;

  return new NextResponse(workbook, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}

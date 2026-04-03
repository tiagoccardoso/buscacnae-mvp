import { NextResponse } from "next/server";
import { getSearchAccessOrderByAccessToken, syncSearchAccessOrderPaymentStatus } from "@/lib/billing";
import { createXlsxWorkbook } from "@/lib/export/xlsx";
import { formatCnpj, formatDate, formatMoney } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractSingleObject, flattenUnknownToRows, safeJsonStringify } from "@/lib/utils";

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

function stringifyMultiline(value: unknown) {
  return safeJsonStringify(value, 2);
}

function formatSecondaryCnaes(value: unknown) {
  if (!Array.isArray(value)) {
    return toCell(value);
  }

  return value
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        return toCell(record.descricao ?? record.codigo ?? record.id ?? safeJsonStringify(item, 0));
      }

      return toCell(item);
    })
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

  const admin = createSupabaseAdminClient();
  const [{ data: search }, { data: rows }] = await Promise.all([
    admin
      .from("search_queries")
      .select("cnae_code, city_name, state_code, created_at")
      .eq("id", order.search_query_id)
      .maybeSingle(),
    admin
      .from("search_results")
      .select("position, establishment_id, establishments(*)")
      .eq("search_query_id", order.search_query_id)
      .order("position", { ascending: true })
  ]);

  const listSheetRows: string[][] = [
    [
      "Posição",
      "CNPJ",
      "Raiz do CNPJ",
      "Razão Social",
      "Nome Fantasia",
      "Situação Cadastral",
      "Data de Abertura",
      "CNAE Principal",
      "Descrição CNAE Principal",
      "CNAEs Secundários",
      "Código Natureza Jurídica",
      "Natureza Jurídica",
      "Porte",
      "Simples",
      "MEI",
      "Capital Social",
      "Telefone",
      "E-mail",
      "Site",
      "País",
      "UF",
      "Cidade",
      "IBGE Cidade",
      "Bairro",
      "CEP",
      "Endereço",
      "Número",
      "Complemento",
      "Dados brutos formatados (JSON)"
    ]
  ];

  const rawSheetRows: string[][] = [
    ["Posição", "CNPJ", "Razão Social", "Campo bruto", "Valor bruto"]
  ];

  for (const row of rows ?? []) {
    const establishment = extractSingleObject(row.establishments);
    if (!establishment) continue;

    const formattedPayload = stringifyMultiline(establishment.provider_payload);

    listSheetRows.push([
      toCell(row.position),
      formatCnpj(toCell(establishment.cnpj)),
      toCell(establishment.cnpj_root),
      toCell(establishment.company_name),
      toCell(establishment.trade_name),
      toCell(establishment.registration_status),
      formatMaybeDate(establishment.opened_at),
      toCell(establishment.primary_cnae_code),
      toCell(establishment.primary_cnae_description),
      formatSecondaryCnaes(establishment.secondary_cnaes),
      toCell(establishment.legal_nature_code),
      toCell(establishment.legal_nature_description),
      toCell(establishment.company_size),
      toCell(establishment.simples_opt_in),
      toCell(establishment.mei_opt_in),
      formatMaybeMoney(establishment.capital_social),
      toCell(establishment.phone),
      toCell(establishment.email),
      toCell(establishment.website),
      toCell(establishment.country),
      toCell(establishment.state_code),
      toCell(establishment.city_name),
      toCell(establishment.city_ibge),
      toCell(establishment.neighborhood),
      toCell(establishment.cep),
      toCell(establishment.address_line),
      toCell(establishment.address_number),
      toCell(establishment.complement),
      formattedPayload
    ]);

    const flattenedRawRows = flattenUnknownToRows(establishment.provider_payload);
    for (const flatRow of flattenedRawRows) {
      rawSheetRows.push([
        toCell(row.position),
        formatCnpj(toCell(establishment.cnpj)),
        toCell(establishment.company_name),
        flatRow.path,
        flatRow.value
      ]);
    }
  }

  const workbook = createXlsxWorkbook({
    sheets: [
      {
        name: "Lista",
        rows: listSheetRows,
        columnWidths: [10, 22, 16, 34, 28, 18, 14, 14, 32, 36, 16, 28, 18, 10, 10, 16, 18, 30, 24, 16, 8, 22, 14, 18, 14, 30, 12, 18, 86],
        wrapColumns: [8, 9, 11, 16, 17, 24, 25, 27, 28]
      },
      {
        name: "Dados brutos",
        rows: rawSheetRows,
        columnWidths: [10, 22, 34, 48, 96],
        wrapColumns: [3, 4]
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

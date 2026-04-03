import { NextResponse } from "next/server";
import { getSearchAccessOrderByAccessToken, syncSearchAccessOrderPaymentStatus } from "@/lib/billing";
import { createXlsxWorkbook } from "@/lib/export/xlsx";
import { formatCnpj } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

function stringify(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

  const workbookRows: string[][] = [
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
      "Payload Consolidado (JSON)"
    ]
  ];

  for (const row of rows ?? []) {
    const establishment = extractSingleObject(row.establishments);
    if (!establishment) continue;

    workbookRows.push([
      toCell(row.position),
      formatCnpj(toCell(establishment.cnpj)),
      toCell(establishment.cnpj_root),
      toCell(establishment.company_name),
      toCell(establishment.trade_name),
      toCell(establishment.registration_status),
      toCell(establishment.opened_at),
      toCell(establishment.primary_cnae_code),
      toCell(establishment.primary_cnae_description),
      stringify(establishment.secondary_cnaes),
      toCell(establishment.legal_nature_code),
      toCell(establishment.legal_nature_description),
      toCell(establishment.company_size),
      toCell(establishment.simples_opt_in),
      toCell(establishment.mei_opt_in),
      toCell(establishment.capital_social),
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
      stringify(establishment.provider_payload)
    ]);
  }

  const workbook = createXlsxWorkbook({
    sheetName: "Lista",
    rows: workbookRows
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

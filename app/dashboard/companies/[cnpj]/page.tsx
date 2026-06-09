import { notFound, redirect } from "next/navigation";
import { EstablishmentDetails } from "@/components/establishment-details";
import { fetchCasaDosDadosCompanyByCnpj } from "@/lib/discovery/providers/casadosdados";
import { fetchCnpjWsCompanyByCnpj } from "@/lib/discovery/providers/cnpjws";
import { formatCnpj } from "@/lib/format";
import { createDbClient } from "@/lib/db-client";
import { getCurrentUser } from "@/lib/auth/server";
import { NormalizedEstablishment } from "@/lib/types";
import { getDiscoveryProvider } from "@/lib/env";

type CompanyPageProps = {
  params: Promise<{ cnpj: string }>;
};

type EstablishmentRow = {
  id: string;
  cnpj: string;
  cnpj_root?: string | null;
  company_name: string;
  trade_name?: string | null;
  registration_status?: string | null;
  opened_at?: string | null;
  primary_cnae_code?: string | null;
  primary_cnae_description?: string | null;
  secondary_cnaes?: unknown;
  legal_nature_code?: string | null;
  legal_nature_description?: string | null;
  company_size?: string | null;
  simples_opt_in?: boolean | null;
  mei_opt_in?: boolean | null;
  capital_social?: number | string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  state_code?: string | null;
  city_name?: string | null;
  city_ibge?: string | null;
  neighborhood?: string | null;
  cep?: string | null;
  address_line?: string | null;
  address_number?: string | null;
  complement?: string | null;
  provider_payload?: unknown;
};

function hasValue(value: unknown) {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

function needsDetailedEnrichment(row: EstablishmentRow) {
  const detailedFields = [
    row.registration_status,
    row.primary_cnae_code,
    row.primary_cnae_description,
    row.opened_at,
    row.city_name,
    row.state_code,
    row.cep,
    row.address_line,
    row.email,
    row.phone,
    row.legal_nature_description
  ];

  return detailedFields.filter(hasValue).length < 8;
}

function mergeProviderPayload(existingPayload: unknown, detailedPayload: Record<string, unknown>, source: "casadosdados" | "cnpjws") {
  const detailKey = source === "casadosdados" ? "casadosdados_detalhe" : "cnpjws_consulta";

  if (existingPayload && typeof existingPayload === "object" && !Array.isArray(existingPayload)) {
    return {
      ...(existingPayload as Record<string, unknown>),
      [detailKey]: detailedPayload
    };
  }

  if (existingPayload) {
    return {
      casadosdados_pesquisa: existingPayload,
      [detailKey]: detailedPayload
    };
  }

  return {
    [detailKey]: detailedPayload
  };
}

async function fetchDetailedCompanyByCnpj(cnpj: string) {
  const preferredProvider = getDiscoveryProvider();
  const providers = preferredProvider === "casadosdados"
    ? (["casadosdados", "cnpjws"] as const)
    : (["cnpjws", "casadosdados"] as const);

  let lastError: unknown = null;

  for (const provider of providers) {
    try {
      const detail = provider === "casadosdados"
        ? await fetchCasaDosDadosCompanyByCnpj(cnpj)
        : await fetchCnpjWsCompanyByCnpj(cnpj);

      return { ...detail, source: provider };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Falha ao enriquecer ficha com dados detalhados.");
}

function mergeEstablishmentRow(
  current: EstablishmentRow,
  normalized: NormalizedEstablishment,
  detailedPayload: Record<string, unknown>,
  detailSource: "casadosdados" | "cnpjws"
): EstablishmentRow {
  return {
    ...current,
    cnpj: normalized.cnpj || current.cnpj,
    cnpj_root: normalized.cnpjRoot ?? current.cnpj_root ?? null,
    company_name: normalized.companyName || current.company_name,
    trade_name: normalized.tradeName ?? current.trade_name ?? null,
    registration_status: normalized.registrationStatus ?? current.registration_status ?? null,
    opened_at: normalized.openedAt ?? current.opened_at ?? null,
    primary_cnae_code: normalized.primaryCnaeCode ?? current.primary_cnae_code ?? null,
    primary_cnae_description:
      normalized.primaryCnaeDescription ?? current.primary_cnae_description ?? null,
    secondary_cnaes: normalized.secondaryCnaes ?? current.secondary_cnaes ?? null,
    legal_nature_code: normalized.legalNatureCode ?? current.legal_nature_code ?? null,
    legal_nature_description:
      normalized.legalNatureDescription ?? current.legal_nature_description ?? null,
    company_size: normalized.companySize ?? current.company_size ?? null,
    simples_opt_in: normalized.simplesOptIn ?? current.simples_opt_in ?? null,
    mei_opt_in: normalized.meiOptIn ?? current.mei_opt_in ?? null,
    capital_social: normalized.capitalSocial ?? current.capital_social ?? null,
    email: normalized.email ?? current.email ?? null,
    phone: normalized.phone ?? current.phone ?? null,
    website: normalized.website ?? current.website ?? null,
    country: normalized.country ?? current.country ?? null,
    state_code: normalized.stateCode ?? current.state_code ?? null,
    city_name: normalized.cityName ?? current.city_name ?? null,
    city_ibge: normalized.cityIbge ?? current.city_ibge ?? null,
    neighborhood: normalized.neighborhood ?? current.neighborhood ?? null,
    cep: normalized.cep ?? current.cep ?? null,
    address_line: normalized.addressLine ?? current.address_line ?? null,
    address_number: normalized.addressNumber ?? current.address_number ?? null,
    complement: normalized.complement ?? current.complement ?? null,
    provider_payload: mergeProviderPayload(current.provider_payload, detailedPayload, detailSource)
  };
}

function buildEstablishmentUpdatePayload(row: EstablishmentRow) {
  return {
    cnpj_root: row.cnpj_root ?? null,
    company_name: row.company_name,
    trade_name: row.trade_name ?? null,
    registration_status: row.registration_status ?? null,
    opened_at: row.opened_at ?? null,
    primary_cnae_code: row.primary_cnae_code ?? null,
    primary_cnae_description: row.primary_cnae_description ?? null,
    secondary_cnaes: row.secondary_cnaes ?? null,
    legal_nature_code: row.legal_nature_code ?? null,
    legal_nature_description: row.legal_nature_description ?? null,
    company_size: row.company_size ?? null,
    simples_opt_in: row.simples_opt_in ?? null,
    mei_opt_in: row.mei_opt_in ?? null,
    capital_social: row.capital_social ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    website: row.website ?? null,
    country: row.country ?? null,
    state_code: row.state_code ?? null,
    city_name: row.city_name ?? null,
    city_ibge: row.city_ibge ?? null,
    neighborhood: row.neighborhood ?? null,
    cep: row.cep ?? null,
    address_line: row.address_line ?? null,
    address_number: row.address_number ?? null,
    complement: row.complement ?? null,
    provider_payload: row.provider_payload ?? null
  };
}

export default async function CompanyPage({ params }: CompanyPageProps) {
  const { cnpj } = await params;
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    redirect("/sign-in");
  }

  const normalizedCnpj = decodeURIComponent(cnpj);

  const { data } = await db
    .from("establishments")
    .select("*")
    .eq("cnpj", normalizedCnpj)
    .maybeSingle();

  if (!data) {
    notFound();
  }

  let company = data as EstablishmentRow;

  if (needsDetailedEnrichment(company)) {
    try {
      const detail = await fetchDetailedCompanyByCnpj(company.cnpj);
      if (detail.normalized) {
        company = mergeEstablishmentRow(company, detail.normalized, detail.raw, detail.source);

        const db = createDbClient();
        const { error } = await db
          .from("establishments")
          .update(buildEstablishmentUpdatePayload(company))
          .eq("id", company.id);

        if (error) {
          console.error("Falha ao persistir dados detalhados do estabelecimento", error);
        }
      }
    } catch (error) {
      console.error("Falha ao enriquecer ficha com dados detalhados", error);
    }
  }

  return (
    <div className="stack">
      <div className="surface-premium card-lg stack">
        <span className="eyebrow">Ficha do estabelecimento</span>
        <h2 className="section-title" style={{ fontSize: "2.1rem", marginBottom: 0 }}>
          {company.company_name}
        </h2>
        <span className="muted">{formatCnpj(company.cnpj)}</span>
      </div>

      <div className="surface-premium card-lg stack">
        <EstablishmentDetails establishment={company as unknown as Record<string, unknown>} />
      </div>
    </div>
  );
}

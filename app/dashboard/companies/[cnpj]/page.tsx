import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EstablishmentDetails } from "@/components/establishment-details";
import { fetchCasaDosDadosCompanyByCnpj, isCasaDosDadosError } from "@/lib/discovery/providers/casadosdados";
import { formatCnpj } from "@/lib/format";
import { createDbClient } from "@/lib/db-client";
import { getCurrentUser } from "@/lib/auth/server";
import { resolveCompanyProfile, type EstablishmentRow } from "@/lib/company-profile";

type CompanyPageProps = {
  params: Promise<{ cnpj: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CompanyPage({ params, searchParams }: CompanyPageProps) {
  const { cnpj } = await params;
  const query = searchParams ? await searchParams : {};
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

  // Fonte única: Casa dos Dados. Nenhuma outra consulta externa acontece ao abrir a ficha.
  const profile = await resolveCompanyProfile(data as EstablishmentRow, fetchCasaDosDadosCompanyByCnpj, (error) => {
    console.warn("[company] consulta detalhada indisponível", {
      kind: isCasaDosDadosError(error) ? error.kind : "unknown",
      status: isCasaDosDadosError(error) ? error.status : null
    });
  });
  const company = profile.company;

  if (profile.updatePayload) {
    const { error } = await db.from("establishments").update(profile.updatePayload).eq("id", company.id);
    if (error) {
      console.error("Falha ao persistir dados detalhados do estabelecimento", { code: error.code ?? null });
    }
  }

  // Retorno contextual ao Mapa Empresarial (preserva a busca de origem).
  const fromMap = query.from === "mapa";
  const originSearch = typeof query.search === "string" && UUID_PATTERN.test(query.search) ? query.search : "";
  const backHref = fromMap
    ? originSearch
      ? `/dashboard/mapa?search=${originSearch}`
      : "/dashboard/mapa"
    : null;

  return (
    <section className="section" aria-labelledby="company-title">
      {backHref ? (
        <div>
          <Link href={backHref} className="button-ghost button-sm">
            ← Voltar ao mapa
          </Link>
        </div>
      ) : null}

      <div className="section-header">
        <span className="eyebrow">Ficha do estabelecimento</span>
        <h2 id="company-title" className="title-1">
          {company.company_name}
        </h2>
        <p className="footnote numeric">{formatCnpj(company.cnpj)}</p>
        <p className="section-copy">
          Informações cadastrais da Casa dos Dados, reunidas em uma leitura única.
        </p>
      </div>

      {profile.pendingRevalidation ? (
        <div className="notice info" role="status">
          Esta ficha foi registrada em uma versão anterior da plataforma e ainda não pôde ser atualizada agora.
          Contatos e dados tributários podem estar desatualizados; uma nova atualização será tentada na próxima abertura.
        </div>
      ) : null}

      <EstablishmentDetails establishment={company as unknown as Record<string, unknown>} />
    </section>
  );
}

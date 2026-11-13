import Link from "next/link";
import { CrmHeader } from "@/components/crm/crm-header";
import { CrmUnavailable } from "@/components/crm/crm-unavailable";
import { ProspectForm } from "@/components/crm/prospect-form";
import { createProspectAction } from "@/app/dashboard/crm/prospect-actions";
import { canAssignDeal } from "@/lib/crm/permissions";
import { listMembers, listStages } from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** Cadastro manual de prospect: não exige busca nem compra de lista. */
export default async function NewProspectPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const from = params.from === "leads" ? "leads" : "crm";
  const session = await getCrmSession().catch((error) => {
    console.error("[crm] indisponível", { message: error instanceof Error ? error.message : String(error) });
    return undefined;
  });
  if (session === undefined) return <CrmUnavailable />;
  if (!session) return null;
  const { ctx, workspaces } = session;

  const [stages, members] = await Promise.all([listStages(ctx), listMembers(ctx)]);
  const actor = { profileId: ctx.profileId, role: ctx.role };
  const memberIds = new Set(members.map((member) => member.profileId));
  const owners = members
    .filter((member) => canAssignDeal(actor, { ownerProfileId: null }, member.profileId, memberIds))
    .map((member) => ({ value: member.profileId, label: `${member.name}${member.profileId === ctx.profileId ? " (você)" : ""}` }));
  const back = from === "leads" ? "/dashboard/leads" : "/dashboard/crm";

  return (
    <>
      <CrmHeader ctx={ctx} workspaces={workspaces} current="novo" returnTo="/dashboard/crm/novo" feedback={{ status: "", error: "" }} />
      <section className="section prospect-page" aria-labelledby="new-prospect-title">
        <Link href={back} className="button-ghost button-sm">← {from === "leads" ? "Leads salvos" : "Pipeline"}</Link>
        <div className="section-header">
          <span className="eyebrow">Novo prospect</span>
          <h2 id="new-prospect-title" className="title-1">Cadastrar prospect manualmente</h2>
          <p className="section-copy">
            Para contatos que chegaram por indicação, evento, WhatsApp ou visita. Os dados informados aqui ficam no seu CRM e
            não alteram a base oficial de CNPJ. Só o nome é obrigatório.
          </p>
        </div>
        <ProspectForm
          mode="create"
          action={createProspectAction}
          from={from}
          cancelHref={back}
          stages={stages}
          owners={owners}
          defaultOwnerId={ctx.profileId}
        />
      </section>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { CrmHeader } from "@/components/crm/crm-header";
import { CrmUnavailable } from "@/components/crm/crm-unavailable";
import { ProspectForm } from "@/components/crm/prospect-form";
import { updateProspectAction } from "@/app/dashboard/crm/prospect-actions";
import { isUuid } from "@/lib/crm/input";
import { canEditDeal } from "@/lib/crm/permissions";
import { getDeal, getProspect } from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ dealId: string }> };

export default async function EditProspectPage({ params }: PageProps) {
  const { dealId } = await params;
  if (!isUuid(dealId)) notFound();
  const session = await getCrmSession().catch(() => undefined);
  if (session === undefined) return <CrmUnavailable />;
  if (!session) return null;
  const { ctx, workspaces } = session;

  const deal = await getDeal(ctx, dealId);
  if (!deal || !deal.prospectId) notFound();
  const prospect = await getProspect(ctx, deal.prospectId);
  if (!prospect) notFound();
  const self = `/dashboard/crm/${deal.id}`;
  const editable = canEditDeal({ profileId: ctx.profileId, role: ctx.role }, deal);

  return (
    <>
      <CrmHeader ctx={ctx} workspaces={workspaces} current="negocio" returnTo="/dashboard/crm" feedback={{ status: "", error: "" }} />
      <section className="section prospect-page" aria-labelledby="edit-prospect-title">
        <Link href={self} className="button-ghost button-sm">← Voltar ao negócio</Link>
        <div className="section-header">
          <span className="eyebrow">Cadastro manual</span>
          <h2 id="edit-prospect-title" className="title-1">Editar {prospect.tradeName || prospect.name}</h2>
          <p className="section-copy">As alterações ficam registradas no histórico (quais campos mudaram, por quem e quando).</p>
        </div>
        {editable ? (
          <ProspectForm mode="edit" action={updateProspectAction} defaults={prospect} dealId={deal.id} cancelHref={self} />
        ) : (
          <div className="notice info">Somente o responsável ou um administrador edita este prospect.</div>
        )}
      </section>
    </>
  );
}

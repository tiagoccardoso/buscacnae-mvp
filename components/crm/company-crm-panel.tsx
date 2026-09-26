import Link from "next/link";
import { addCompanyToCrmAction } from "@/app/dashboard/crm/actions";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/crm/input";
import { getDealByEstablishment, listActivities, listStages } from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";
import { describeActivity } from "@/lib/crm/timeline";

/**
 * Painel "CRM" na ficha da empresa: a empresa é a entidade central, então a ficha
 * mostra o negócio (se houver) e o histórico recente — ou permite iniciar um.
 * Falhas do CRM nunca derrubam a ficha.
 */
export async function CompanyCrmPanel({ establishmentId, returnTo }: { establishmentId: string; returnTo: string }) {
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load(establishmentId);
  } catch (error) {
    console.warn("[crm] painel da empresa indisponível", { message: error instanceof Error ? error.message : String(error) });
    return null;
  }
  if (!data) return null;
  const { ctx, deal, stageName, activities } = data;

  return (
    <section className="card stack-sm crm-company-panel" aria-labelledby="company-crm-title">
      <div className="cluster cluster-between">
        <h3 id="company-crm-title" className="headline">CRM · {ctx.workspace.isPersonal ? "pessoal" : ctx.workspace.name}</h3>
        {deal ? <Link href={`/dashboard/crm/${deal.id}`} className="button-secondary button-sm">Abrir negócio</Link> : null}
      </div>
      {deal ? (
        <>
          <div className="inline-list">
            <span className="pill accent">{stageName}</span>
            <span className="pill">{deal.ownerName ? `Responsável: ${deal.ownerName}` : "Sem responsável"}</span>
            {deal.amountCents !== null ? <span className="pill numeric">{formatCents(deal.amountCents)}</span> : null}
            {deal.openTasks ? <span className="pill warning">{deal.openTasks} tarefa(s) aberta(s)</span> : null}
          </div>
          {activities.length ? (
            <ol className="crm-mini-timeline">
              {activities.map((activity) => (
                <li key={activity.id}><span>{describeActivity(activity)}</span> <span className="caption">{activity.actorName ?? "Sistema"} · {formatDateTime(activity.happenedAt)}</span></li>
              ))}
            </ol>
          ) : null}
        </>
      ) : (
        <form action={addCompanyToCrmAction} className="cluster">
          <input type="hidden" name="establishmentId" value={establishmentId} />
          <input type="hidden" name="source" value="company" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <p className="footnote">Esta empresa ainda não está no seu pipeline.</p>
          <button type="submit" className="button-secondary button-sm">Adicionar ao CRM</button>
        </form>
      )}
    </section>
  );
}

async function load(establishmentId: string) {
  const session = await getCrmSession();
  if (!session) return null;
  const { ctx } = session;
  const deal = await getDealByEstablishment(ctx, establishmentId);
  if (!deal) return { ctx, deal: null, stageName: "", activities: [] };
  const [stages, activities] = await Promise.all([listStages(ctx), listActivities(ctx, { dealId: deal.id }, 4)]);
  return { ctx, deal, stageName: stages.find((stage) => stage.id === deal.stageId)?.name ?? "Sem etapa", activities };
}

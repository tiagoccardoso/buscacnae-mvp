import { CrmHeader } from "@/components/crm/crm-header";
import { CrmUnavailable } from "@/components/crm/crm-unavailable";
import {
  addMemberAction,
  addStageAction,
  changeMemberAction,
  createTeamAction,
  removeStageAction,
  reorderStageAction,
  saveStageAction
} from "@/app/dashboard/crm/actions";
import { readCrmFeedback } from "@/lib/crm/messages";
import { ROLE_LABEL, canChangeMember, canConfigurePipeline, canManageMembers } from "@/lib/crm/permissions";
import { STAGE_KIND_LABEL, sortStages } from "@/lib/crm/pipeline";
import { listDeals, listMembers, listStages } from "@/lib/crm/repository";
import { getCrmSession } from "@/lib/crm/server";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function CrmSettingsPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const session = await getCrmSession().catch(() => undefined);
  if (session === undefined) return <CrmUnavailable />;
  if (!session) return null;
  const { ctx, workspaces } = session;
  const actor = { profileId: ctx.profileId, role: ctx.role };

  const [stages, members, deals] = await Promise.all([listStages(ctx), listMembers(ctx), listDeals(ctx)]);
  const ordered = sortStages(stages);
  const countByStage = new Map<string, number>();
  for (const deal of deals) countByStage.set(deal.stageId, (countByStage.get(deal.stageId) ?? 0) + 1);
  const pipelineAdmin = canConfigurePipeline(actor);
  const membersAdmin = canManageMembers(actor) && !ctx.workspace.isPersonal;

  return (
    <>
      <CrmHeader ctx={ctx} workspaces={workspaces} current="configuracoes" returnTo="/dashboard/crm/configuracoes" feedback={readCrmFeedback(params)} />

      <section className="section" aria-labelledby="pipeline-title">
        <div className="section-header">
          <span className="eyebrow">Pipeline</span>
          <h3 id="pipeline-title" className="title-2">Etapas de {ctx.workspace.isPersonal ? "seu CRM" : ctx.workspace.name}</h3>
          <p className="section-copy">Etapas “em andamento” formam o funil; uma etapa de ganho e uma de perda fecham o negócio e registram a data de fechamento.</p>
        </div>
        <ol className="crm-stage-list">
          {ordered.map((stage, index) => {
            const count = countByStage.get(stage.id) ?? 0;
            const others = ordered.filter((item) => item.id !== stage.id);
            return (
              <li key={stage.id} className={`crm-stage-row is-${stage.kind}`}>
                <span className="crm-column-dot" aria-hidden="true" />
                {pipelineAdmin ? (
                  <form action={saveStageAction} className="crm-stage-form">
                    <input type="hidden" name="stageId" value={stage.id} />
                    <label className="sr-only" htmlFor={`stage-name-${stage.id}`}>Nome da etapa</label>
                    <input id={`stage-name-${stage.id}`} name="name" className="input" defaultValue={stage.name} maxLength={60} required />
                    <label className="sr-only" htmlFor={`stage-kind-${stage.id}`}>Tipo da etapa</label>
                    <select id={`stage-kind-${stage.id}`} name="kind" className="input" defaultValue={stage.kind}>
                      {(["open", "won", "lost"] as const).map((kind) => <option key={kind} value={kind}>{STAGE_KIND_LABEL[kind]}</option>)}
                    </select>
                    <button type="submit" className="button-ghost button-sm">Salvar</button>
                  </form>
                ) : (
                  <span className="crm-stage-name"><strong>{stage.name}</strong> <span className="footnote">{STAGE_KIND_LABEL[stage.kind]}</span></span>
                )}
                <span className="pill">{count} negócio(s)</span>
                {pipelineAdmin ? (
                  <div className="crm-stage-actions">
                    <form action={reorderStageAction}>
                      <input type="hidden" name="stageId" value={stage.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button type="submit" className="button-icon" disabled={index === 0} aria-label={`Subir ${stage.name}`}>↑</button>
                    </form>
                    <form action={reorderStageAction}>
                      <input type="hidden" name="stageId" value={stage.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button type="submit" className="button-icon" disabled={index === ordered.length - 1} aria-label={`Descer ${stage.name}`}>↓</button>
                    </form>
                    <details className="crm-disclosure crm-stage-remove">
                      <summary>Excluir</summary>
                      <form action={removeStageAction} className="stack-xs">
                        <input type="hidden" name="stageId" value={stage.id} />
                        {count > 0 ? (
                          <label className="field"><span className="field-label">Mover {count} negócio(s) para</span>
                            <select name="moveDealsTo" className="input" required defaultValue="">
                              <option value="" disabled>Escolha a etapa</option>
                              {others.map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}
                            </select>
                          </label>
                        ) : null}
                        <button type="submit" className="button-ghost button-sm is-destructive">Confirmar exclusão</button>
                      </form>
                    </details>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        {pipelineAdmin ? (
          <form action={addStageAction} className="crm-stage-add">
            <label className="field"><span className="field-label">Nova etapa</span><input name="name" className="input" required maxLength={60} placeholder="Ex.: Negociação" /></label>
            <label className="field"><span className="field-label">Tipo</span>
              <select name="kind" className="input" defaultValue="open">
                {(["open", "won", "lost"] as const).map((kind) => <option key={kind} value={kind}>{STAGE_KIND_LABEL[kind]}</option>)}
              </select>
            </label>
            <button type="submit" className="button-secondary button-sm">Adicionar etapa</button>
          </form>
        ) : <p className="footnote">Somente proprietário ou administrador altera o pipeline.</p>}
      </section>

      <section className="section" aria-labelledby="team-title">
        <div className="section-header">
          <span className="eyebrow">Equipe e permissões</span>
          <h3 id="team-title" className="title-2">{ctx.workspace.isPersonal ? "CRM pessoal" : `Membros de ${ctx.workspace.name}`}</h3>
          <p className="section-copy">
            Cada workspace é isolado: negócios, notas, tarefas e contatos de uma equipe nunca aparecem em outra.
            Proprietário e administradores configuram tudo; membros veem os negócios da equipe e editam os seus ou os sem responsável.
          </p>
        </div>

        <div className="table-wrap">
          <table className="table table-responsive">
            <caption className="sr-only">Membros do workspace</caption>
            <thead><tr><th>Pessoa</th><th>Papel</th><th>Ações</th></tr></thead>
            <tbody>
              {members.map((member) => {
                const target = { profileId: member.profileId, role: member.role };
                const roleOptions = (["admin", "member"] as const).filter((role) => role !== member.role && canChangeMember(actor, target, role) && !(ctx.role === "admin" && role === "admin"));
                const removable = !ctx.workspace.isPersonal && canChangeMember(actor, target, "remove");
                return (
                  <tr key={member.profileId}>
                    <td data-label="Pessoa"><div className="cell-stack"><strong>{member.name}{member.profileId === ctx.profileId ? " (você)" : ""}</strong><span className="muted">{member.email}</span></div></td>
                    <td data-label="Papel"><span className={`pill${member.role === "owner" ? " accent" : ""}`}>{ROLE_LABEL[member.role]}</span></td>
                    <td data-label="Ações">
                      <div className="table-actions">
                        {roleOptions.map((role) => (
                          <form key={role} action={changeMemberAction}>
                            <input type="hidden" name="profileId" value={member.profileId} />
                            <input type="hidden" name="next" value={role} />
                            <button type="submit" className="button-ghost button-sm">Tornar {ROLE_LABEL[role].toLowerCase()}</button>
                          </form>
                        ))}
                        {removable ? (
                          <form action={changeMemberAction}>
                            <input type="hidden" name="profileId" value={member.profileId} />
                            <input type="hidden" name="next" value="remove" />
                            <button type="submit" className="button-ghost button-sm is-destructive">{member.profileId === ctx.profileId ? "Sair da equipe" : "Remover"}</button>
                          </form>
                        ) : null}
                        {!roleOptions.length && !removable ? <span className="muted">—</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {membersAdmin ? (
          <form action={addMemberAction} className="crm-stage-add">
            <label className="field"><span className="field-label">E-mail da conta BuscaCNAE</span><input name="email" type="email" className="input" required autoComplete="off" /></label>
            <label className="field"><span className="field-label">Papel</span>
              <select name="role" className="input" defaultValue="member">
                <option value="member">Membro</option>
                {ctx.role === "owner" ? <option value="admin">Administrador</option> : null}
              </select>
            </label>
            <button type="submit" className="button-secondary button-sm">Adicionar membro</button>
          </form>
        ) : null}

        <div className="tile tile-compact stack-sm">
          <h4 className="headline">Criar equipe</h4>
          <p className="footnote">Uma equipe é um novo workspace com pipeline próprio. Seu CRM pessoal continua separado — negócios não são copiados entre eles.</p>
          <form action={createTeamAction} className="crm-stage-add">
            <label className="field"><span className="field-label">Nome da equipe</span><input name="name" className="input" required maxLength={120} placeholder="Ex.: Comercial Sul" /></label>
            <button type="submit" className="button-secondary button-sm">Criar equipe</button>
          </form>
        </div>
      </section>
    </>
  );
}

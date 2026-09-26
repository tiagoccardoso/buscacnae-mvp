import Link from "next/link";
import { switchWorkspaceAction } from "@/app/dashboard/crm/actions";
import { ROLE_LABEL } from "@/lib/crm/permissions";
import type { CrmContext, CrmRole, CrmWorkspace } from "@/lib/crm/types";

type Props = {
  ctx: CrmContext;
  workspaces: Array<CrmWorkspace & { role: CrmRole }>;
  current: "kanban" | "tabela" | "tarefas" | "configuracoes" | "negocio";
  returnTo: string;
  feedback: { status: string; error: string };
};

const VIEWS = [
  { key: "kanban", label: "Kanban", href: "/dashboard/crm" },
  { key: "tabela", label: "Tabela", href: "/dashboard/crm?view=tabela" },
  { key: "tarefas", label: "Tarefas", href: "/dashboard/crm?view=tarefas" },
  { key: "configuracoes", label: "Pipeline e equipe", href: "/dashboard/crm/configuracoes" }
] as const;

/** Cabeçalho comum do CRM: workspace ativo, papel do usuário e visões. */
export function CrmHeader({ ctx, workspaces, current, returnTo, feedback }: Props) {
  return (
    <div className="stack-sm">
      <div className="section-header-row crm-header">
        <div className="section-header">
          <span className="eyebrow">CRM</span>
          <h2 className="title-1">Da empresa ao cliente</h2>
          <p className="footnote">
            {ctx.workspace.isPersonal ? "CRM pessoal" : `Equipe ${ctx.workspace.name}`} · seu papel: {ROLE_LABEL[ctx.role]}
          </p>
        </div>
        {workspaces.length > 1 ? (
          <form action={switchWorkspaceAction} className="crm-workspace-switch">
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="field">
              <span className="field-label">Workspace</span>
              <select name="workspaceId" className="input" defaultValue={ctx.workspace.id}>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.isPersonal ? "Meu CRM (pessoal)" : workspace.name} — {ROLE_LABEL[workspace.role]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button-secondary button-sm">Trocar</button>
          </form>
        ) : null}
      </div>
      <nav className="segmented crm-views" aria-label="Visões do CRM">
        {VIEWS.map((view) => (
          <Link key={view.key} href={view.href} className="segmented-item" aria-current={current === view.key ? "page" : undefined}>
            {view.label}
          </Link>
        ))}
      </nav>
      {feedback.status ? <div className="notice success" role="status">{feedback.status}</div> : null}
      {feedback.error ? <div className="notice danger" role="alert">{feedback.error}</div> : null}
    </div>
  );
}

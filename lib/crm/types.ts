/**
 * Tipos do CRM nativo (Fase 6).
 *
 * Regra central: o CRM referencia a empresa por `establishmentId`. Os dados cadastrais
 * (razão social, CNPJ, cidade…) chegam por JOIN em `establishments` somente para exibição
 * e ficam em `CrmCompanyRef` — nunca são gravados nas tabelas do CRM.
 */

export type CrmRole = "owner" | "admin" | "member";

export type StageKind = "open" | "won" | "lost";

export type DealSource = "manual" | "search" | "list" | "map" | "company" | "prospecting";

export type CrmWorkspace = {
  id: string;
  name: string;
  isPersonal: boolean;
  ownerProfileId: string;
};

/** Contexto de acesso resolvido no servidor: quem é o usuário DENTRO de um workspace. */
export type CrmContext = {
  workspace: CrmWorkspace;
  profileId: string;
  role: CrmRole;
};

export type CrmMember = {
  profileId: string;
  role: CrmRole;
  name: string;
  email: string;
};

export type PipelineStage = {
  id: string;
  name: string;
  kind: StageKind;
  position: number;
};

/** Dados de exibição da empresa, lidos de `establishments` (fonte única). */
export type CrmCompanyRef = {
  establishmentId: string;
  cnpj: string;
  companyName: string;
  tradeName: string;
  cityName: string;
  stateCode: string;
};

export type Deal = {
  id: string;
  establishmentId: string;
  stageId: string;
  position: number;
  title: string | null;
  ownerProfileId: string | null;
  primaryContactId: string | null;
  amountCents: number | null;
  expectedCloseDate: string | null;
  source: DealSource;
  sourceRef: string | null;
  lostReason: string | null;
  closedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DealView = Deal & {
  company: CrmCompanyRef;
  ownerName: string | null;
  openTasks: number;
  nextTaskDueAt: string | null;
};

export type CrmNote = {
  id: string;
  dealId: string;
  body: string;
  authorProfileId: string | null;
  authorName: string | null;
  createdAt: string;
};

export type CrmTask = {
  id: string;
  dealId: string;
  title: string;
  dueAt: string | null;
  status: "todo" | "done";
  assigneeProfileId: string | null;
  assigneeName: string | null;
  createdBy: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type CrmContact = {
  id: string;
  establishmentId: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
};

export type ActivityType =
  | "deal.created"
  | "deal.updated"
  | "deal.deleted"
  | "stage.changed"
  | "owner.changed"
  | "note.created"
  | "task.created"
  | "task.completed"
  | "task.reopened"
  | "contact.created"
  | "contact.linked"
  | "contact.deleted";

export type CrmActivity = {
  id: string;
  dealId: string | null;
  establishmentId: string | null;
  actorProfileId: string | null;
  actorName: string | null;
  type: ActivityType;
  payload: Record<string, unknown>;
  happenedAt: string;
};

/** Registro a inserir em crm_activities (sem id/data: o banco preenche). */
export type ActivityDraft = {
  type: ActivityType;
  dealId: string | null;
  establishmentId: string | null;
  actorProfileId: string;
  payload: Record<string, unknown>;
};

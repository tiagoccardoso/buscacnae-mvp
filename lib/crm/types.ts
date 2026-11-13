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

/**
 * Dados de exibição do alvo do negócio. Para empresas da base vêm de `establishments`
 * (fonte única); para prospects manuais vêm de `crm_prospects` (dado do usuário).
 * `kind` diz qual é a origem — a interface deixa a diferença visível.
 */
export type CrmCompanyRef = {
  kind: "establishment" | "prospect";
  establishmentId: string | null;
  prospectId: string | null;
  /** CNPJ oficial (somente kind = establishment). */
  cnpj: string;
  companyName: string;
  tradeName: string;
  cityName: string;
  stateCode: string;
  /** Telefone para WhatsApp: do prospect (whatsapp > telefone) ou o telefone público da ficha. */
  whatsappPhone: string | null;
  personKind: "company" | "person";
};

export type ProspectRecord = {
  id: string;
  kind: "company" | "person";
  name: string;
  tradeName: string | null;
  documentType: "cnpj" | "cpf" | null;
  document: string | null;
  origin: import("./prospects").ProspectOrigin;
  originDetail: string | null;
  segment: string | null;
  cityName: string | null;
  stateCode: string | null;
  address: string | null;
  contactName: string | null;
  contactRole: string | null;
  phone: string | null;
  whatsapp: string | null;
  phoneSecondary: string | null;
  email: string | null;
  website: string | null;
  tags: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Deal = {
  id: string;
  establishmentId: string | null;
  prospectId: string | null;
  priority: import("./prospects").DealPriority;
  nextContactAt: string | null;
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
  /** Arquivado: fora da listagem padrão, com histórico preservado (Fase 9). */
  archivedAt: string | null;
  /** Última interação registrada explicitamente (interaction.logged). */
  lastInteractionAt: string | null;
  /** Último evento de qualquer tipo no histórico do negócio. */
  lastActivityAt: string | null;
  /** Contato para ações rápidas (contato principal > cadastro do prospect > telefone público da ficha). */
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
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
  establishmentId: string | null;
  prospectId: string | null;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  createdAt: string;
};

/** Canais das interações registradas manualmente pelo usuário. */
export type InteractionChannel = "call" | "whatsapp" | "meeting" | "email" | "visit" | "other";

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
  | "contact.deleted"
  | "prospect.created"
  | "prospect.updated"
  | "interaction.logged"
  | "next_contact.scheduled"
  | "deal.archived"
  | "deal.restored";

export type CrmActivity = {
  id: string;
  dealId: string | null;
  establishmentId: string | null;
  prospectId: string | null;
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
  prospectId?: string | null;
  actorProfileId: string;
  payload: Record<string, unknown>;
};

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { EmptyState } from "@/components/empty-state";
import { LeadToggleForm } from "@/components/lead-toggle-form";
import { ProspectingResearchButton } from "@/components/prospecting/research-button";
import { formatCnpj, formatDateTime, formatMoney } from "@/lib/format";
import { extractSingleObject } from "@/lib/utils";
import {
  assignSavedLeadListAction,
  createSavedLeadListAction,
  deleteSavedLeadListAction,
  removeEstablishmentFromListAction,
  runProspectingEnrichmentAction,
  updateSavedEstablishmentMetaAction,
  updateSavedLeadListAction
} from "@/app/dashboard/actions";
import { buildDisplayEstablishment } from "@/lib/establishment-presenter";
import { calculateLeadScore, normalizeScoreCriteria, scoreExplanation } from "@/lib/prospecting/score";
import type { ProspectingStage, ScoreCriteria } from "@/lib/prospecting/types";

type LeadsPageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

type SavedListRecord = {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[] | null;
  score_criteria?: unknown;
  created_at?: string;
};

type LeadView = {
  savedAt: string;
  establishmentId: string;
  cnpj: string;
  companyName: string;
  tradeName: string;
  cityName: string;
  stateCode: string;
  email: string;
  phone: string;
  website: string;
  companySize: string;
  primaryCnaeCode: string;
  openedAt: string;
  capitalSocial: number;
  status: string;
  listId: string;
  listName: string;
  notes: string;
  tags: string[];
  stage: ProspectingStage;
  score: number;
  scoreExplanation: string;
};

const STAGES: Array<{ value: ProspectingStage; label: string }> = [
  { value: "new", label: "Novo" },
  { value: "researching", label: "Em pesquisa" },
  { value: "qualified", label: "Qualificado" },
  { value: "lead", label: "Lead" },
  { value: "discarded", label: "Descartado" }
];

function readStatusMessage(status: string) {
  if (status === "lista-criada") return "Lista salva criada com sucesso.";
  if (status === "lista-editada") return "Configurações da lista atualizadas.";
  if (status === "lead-vinculado") return "Lead vinculado à lista salva.";
  if (status === "lead-atualizado") return "Tags, notas e etapa atualizadas.";
  if (status === "lead-removido") return "Empresa removida da lista; continua disponível na carteira.";
  if (status === "lista-excluida") return "Lista salva excluída com sucesso.";
  if (status === "enriquecimento-concluido") return "Enriquecimento concluído com origem registrada.";
  return "";
}

function readErrorMessage(error: string) {
  if (error === "lista-sem-nome") return "Informe um nome para a lista salva.";
  if (error === "lista-duplicada") return "Já existe uma lista salva com esse nome.";
  if (error === "lista-vinculo") return "Não foi possível vincular o lead à lista.";
  if (error === "lista-invalida") return "Lista salva inválida.";
  if (error === "lista-edicao") return "Não foi possível editar a lista.";
  if (error === "lista-exclusao") return "Não foi possível excluir a lista.";
  if (error === "lead-atualizacao") return "Não foi possível atualizar o lead.";
  if (error === "lead-invalido") return "Lead inválido para operação.";
  if (error === "enriquecimento-falhou") return "Não foi possível enriquecer a empresa agora.";
  return "";
}

function toCapital(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function valueOrEmpty(value: unknown) {
  return String(value ?? "").trim();
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = createDbClient();
  const params = searchParams ? await searchParams : {};
  const selectedListId = typeof params.list === "string" ? params.list : "";
  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const selectedStage = typeof params.stage === "string" ? params.stage as ProspectingStage : "";
  const status = typeof params.status === "string" ? params.status : "";
  const error = typeof params.error === "string" ? params.error : "";

  // These are the columns that already existed before the Fase 5 migration.
  // Keep the main read compatible so an unapplied migration cannot hide the
  // user's existing wallet entries behind the empty state.
  const [{ data: listRows }, { data: rows }, { data: optionalListRows }, { data: optionalMetaRows }] = await Promise.all([
    db.from("saved_lead_lists").select("id,name,created_at").eq("profile_id", user.id).order("name", { ascending: true }),
    db.from("saved_establishments").select("created_at, notes, list_id, saved_lead_lists(id,name), establishments(*)").eq("profile_id", user.id).order("created_at", { ascending: false }),
    db.from("saved_lead_lists").select("id,description,tags,score_criteria").eq("profile_id", user.id),
    db.from("saved_establishments").select("establishment_id,tags,stage").eq("profile_id", user.id)
  ]);

  const optionalListById = new Map((optionalListRows ?? []).map((list) => [String(list.id), list]));
  const optionalMetaByEstablishmentId = new Map((optionalMetaRows ?? []).map((row) => [String(row.establishment_id), row]));
  const savedLists = (listRows ?? []).map((list) => ({ ...list, ...(optionalListById.get(String(list.id)) ?? {}) })) as SavedListRecord[];
  const listById = new Map(savedLists.map((list) => [list.id, list]));
  const leads = (rows ?? [])
    .map((row) => {
      const establishment = extractSingleObject(row.establishments);
      const list = extractSingleObject(row.saved_lead_lists);
      if (!establishment) return null;
      const optionalMeta = optionalMetaByEstablishmentId.get(String(establishment.id));
      const display = buildDisplayEstablishment(establishment);
      const listId = valueOrEmpty(row.list_id ?? list?.id);
      const criteria: ScoreCriteria = normalizeScoreCriteria(listById.get(listId)?.score_criteria);
      const score = calculateLeadScore({
        registrationStatus: valueOrEmpty(display.registration_status),
        companySize: valueOrEmpty(display.company_size),
        stateCode: valueOrEmpty(display.state_code),
        primaryCnaeCode: valueOrEmpty(display.primary_cnae_code),
        openedAt: valueOrEmpty(display.opened_at),
        website: valueOrEmpty(display.website),
        email: valueOrEmpty(display.email),
        phone: valueOrEmpty(display.phone)
      }, criteria);
      return {
        savedAt: valueOrEmpty(row.created_at),
        establishmentId: valueOrEmpty(establishment.id),
        cnpj: valueOrEmpty(display.cnpj),
        companyName: valueOrEmpty(display.company_name) || "-",
        tradeName: valueOrEmpty(display.trade_name),
        cityName: valueOrEmpty(display.city_name) || "-",
        stateCode: valueOrEmpty(display.state_code) || "-",
        email: valueOrEmpty(display.email),
        phone: valueOrEmpty(display.phone),
        website: valueOrEmpty(display.website),
        companySize: valueOrEmpty(display.company_size),
        primaryCnaeCode: valueOrEmpty(display.primary_cnae_code),
        openedAt: valueOrEmpty(display.opened_at),
        capitalSocial: toCapital(display.capital_social),
        status: valueOrEmpty(display.registration_status),
        listId,
        listName: valueOrEmpty(list?.name),
        notes: valueOrEmpty(row.notes),
        tags: stringList(optionalMeta?.tags),
        stage: STAGES.some((item) => item.value === optionalMeta?.stage) ? optionalMeta?.stage as ProspectingStage : "new",
        score: score.score,
        scoreExplanation: scoreExplanation(score)
      } satisfies LeadView;
    })
    .filter((item): item is LeadView => Boolean(item));

  const filteredLeads = leads.filter((item) => {
    if (selectedListId && item.listId !== selectedListId) return false;
    if (selectedStage && item.stage !== selectedStage) return false;
    if (!query) return true;
    return [item.companyName, item.tradeName, item.cnpj, item.cityName, item.stateCode, item.email, item.website, item.notes, ...item.tags].join(" ").toLowerCase().includes(query);
  });

  const statusMessage = readStatusMessage(status);
  const errorMessage = readErrorMessage(error);
  if (leads.length === 0) return <EmptyState title="Nenhum lead salvo" description="Salve empresas a partir dos resultados das buscas para montar carteiras por nicho, região e potencial de prospecção." ctaHref="/dashboard/search" ctaLabel="Buscar empresas" />;

  const selectedList = savedLists.find((list) => list.id === selectedListId);
  const selectedCriteria = normalizeScoreCriteria(selectedList?.score_criteria);
  const topPromising = [...filteredLeads].sort((a, b) => b.score - a.score).slice(0, 3);
  const topCapital = [...filteredLeads].sort((a, b) => b.capitalSocial - a.capitalSocial).slice(0, 3);

  return (
    <>
      {statusMessage || errorMessage ? <div className="stack-sm">{statusMessage ? <div className="notice success" role="status">{statusMessage}</div> : null}{errorMessage ? <div className="notice danger" role="alert">{errorMessage}</div> : null}</div> : null}
      <section className="section" aria-labelledby="leads-title">
        <div className="section-header-row"><div className="section-header"><span className="eyebrow">Central de prospecção</span><h2 id="leads-title" className="title-1">Da busca ao lead, com origem auditável</h2><p className="section-copy">Listas referenciam o estabelecimento/CNPJ existente. Tags, notas, pesquisa e enriquecimentos ficam separados do cadastro oficial.</p></div><div className="cluster"><Link href={`/dashboard/leads/export${selectedListId ? `?list=${encodeURIComponent(selectedListId)}` : ""}`} className="button-ghost">Exportar CSV</Link><form action={createSavedLeadListAction} className="inline-form" data-analytics-event="saved_list_created"><label htmlFor="new-lead-list" className="sr-only">Nome da nova lista</label><input id="new-lead-list" name="name" className="input" placeholder="Nova lista de prospecção" /><button type="submit" className="button-secondary">Criar lista</button></form></div></div>
        <nav className="list-filter" aria-label="Filtrar por lista salva"><Link href="/dashboard/leads" className={`pill${selectedListId ? "" : " pill-active"}`}>Todas ({leads.length})</Link>{savedLists.map((list) => { const count = leads.filter((item) => item.listId === list.id).length; return <div key={list.id} className="list-filter-item"><Link href={`/dashboard/leads?list=${encodeURIComponent(list.id)}`} className={`pill${selectedListId === list.id ? " pill-active" : ""}`}>{list.name} ({count})</Link><form action={deleteSavedLeadListAction}><input type="hidden" name="listId" value={list.id} /><button type="submit" className="button-icon list-filter-remove" aria-label={`Excluir lista ${list.name}`} title="Excluir lista">×</button></form></div>; })}</nav>
      </section>

      {selectedList ? <section className="tile section" aria-labelledby="list-settings-title"><div className="section-header"><span className="eyebrow">Lista selecionada</span><h2 id="list-settings-title" className="title-2">Editar lista e critérios de score</h2><p className="footnote">O score é determinístico. A pesquisa assistida pode explicar o resultado, mas não altera a pontuação.</p></div><form action={updateSavedLeadListAction} className="grid-2"><input type="hidden" name="listId" value={selectedList.id} /><label className="field">Nome<input name="name" className="input" defaultValue={selectedList.name} maxLength={120} required /></label><label className="field">Tags da lista<input name="tags" className="input" defaultValue={stringList(selectedList.tags).join(", ")} placeholder="indústria, PR, campanha-abril" /></label><label className="field">Descrição<textarea name="description" className="input" defaultValue={selectedList.description ?? ""} maxLength={500} rows={2} /></label><div className="stack-sm"><strong>Alvos (opcionais)</strong><label className="field">UFs<input name="targetStates" className="input" defaultValue={selectedCriteria.targetStates.join(", ")} placeholder="PR, SP" /></label><label className="field">CNAEs<input name="targetCnaeCodes" className="input" defaultValue={selectedCriteria.targetCnaeCodes.join(", ")} placeholder="6920601, 6201501" /></label><label className="field">Portes<input name="targetCompanySizes" className="input" defaultValue={selectedCriteria.targetCompanySizes.join(", ")} placeholder="small, medium" /></label><label className="field">Mínimo de anos ativo<input name="minYearsActive" type="number" min="0" max="200" className="input" defaultValue={selectedCriteria.minYearsActive ?? ""} /></label></div><div className="stack-sm"><strong>Pesos (0–100)</strong>{(["activeStatus", "companySize", "location", "cnae", "tenure", "digitalPresence"] as const).map((key) => <label className="field" key={key}>{key}<input name={`weight${key.charAt(0).toUpperCase()}${key.slice(1)}`} type="number" min="0" max="100" className="input" defaultValue={selectedCriteria.weights[key]} /></label>)}</div><div className="cluster"><button type="submit" className="button-secondary">Salvar critérios</button><span className="footnote">{filteredLeads.length} empresa(s) no recorte atual.</span></div></form></section> : null}

      <section className="section" aria-labelledby="filters-title"><div className="section-header"><span className="eyebrow">Operação</span><h2 id="filters-title" className="title-2">Pesquisar e qualificar</h2></div><form method="get" className="cluster">{selectedListId ? <input type="hidden" name="list" value={selectedListId} /> : null}<label className="field">Pesquisa<input name="q" className="input" defaultValue={query} placeholder="empresa, CNPJ, cidade, tag ou nota" /></label><label className="field">Etapa<select name="stage" className="input" defaultValue={selectedStage}><option value="">Todas</option>{STAGES.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label><button type="submit" className="button-secondary">Filtrar</button><Link href={selectedListId ? `/dashboard/leads?list=${encodeURIComponent(selectedListId)}` : "/dashboard/leads"} className="button-ghost">Limpar</Link></form></section>

      <section className="rank-grid" aria-label="Rankings da carteira"><div className="stack-sm"><div className="section-header"><h3 className="title-3">Maior score determinístico</h3><p className="footnote">Critérios configurados na lista, sem score inventado por LLM.</p></div><ol className="rank-list">{topPromising.map((item) => <li key={item.establishmentId}><span className="rank-name"><strong>{item.companyName}</strong><span>{item.cityName}/{item.stateCode}</span></span><span className="rank-value">{item.score}/100</span></li>)}</ol></div><div className="stack-sm"><div className="section-header"><h3 className="title-3">Maior capital declarado</h3><p className="footnote">Dado oficial, não enriquecido.</p></div><ol className="rank-list">{topCapital.map((item) => <li key={item.establishmentId}><span className="rank-name"><strong>{item.companyName}</strong><span>{item.cityName}/{item.stateCode}</span></span><span className="rank-value">{item.capitalSocial > 0 ? formatMoney(item.capitalSocial) : "—"}</span></li>)}</ol></div></section>

      <section className="section" aria-labelledby="leads-table-title"><div className="section-header"><span className="eyebrow">Carteira filtrada</span><h2 id="leads-table-title" className="title-2">{filteredLeads.length} empresa(s) na prospecção</h2><p className="section-copy">Dados oficiais aparecem separados dos metadados operacionais e do enriquecimento derivado.</p></div>{filteredLeads.length === 0 ? <div className="notice info">Nenhuma empresa corresponde aos filtros atuais.</div> : <div className="table-wrap"><table className="table table-responsive"><caption className="sr-only">Empresas na carteira de prospecção</caption><thead><tr><th>Empresa</th><th>CNPJ/local</th><th>Score</th><th>Lista</th><th>Tags/notas/etapa</th><th>Pesquisa/enriquecimento</th><th>Ações</th></tr></thead><tbody>{filteredLeads.map((lead) => <tr key={lead.establishmentId}><td data-label="Empresa"><div className="cell-stack"><strong>{lead.companyName}</strong><span className="muted">{lead.tradeName || "Nome fantasia não informado"}</span><span className="muted">Fonte oficial: Casa dos Dados</span></div></td><td data-label="CNPJ/local"><div className="cell-stack"><span>{formatCnpj(lead.cnpj)}</span><span>{lead.cityName}/{lead.stateCode}</span><span className="muted">{lead.primaryCnaeCode || "CNAE não informado"}</span></div></td><td data-label="Score"><div className="cell-stack"><strong>{lead.score}/100</strong><span className="muted" title={lead.scoreExplanation}>{lead.scoreExplanation || "Sem pontos positivos"}</span></div></td><td data-label="Lista"><form action={assignSavedLeadListAction} className="cell-form"><input type="hidden" name="establishmentId" value={lead.establishmentId} /><select name="listId" defaultValue={lead.listId} className="input" aria-label={`Lista de ${lead.companyName}`}><option value="">Sem lista</option>{savedLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select><input name="newListName" className="input" placeholder="Nova lista" /><button type="submit" className="button-secondary button-sm">Salvar</button></form></td><td data-label="Tags/notas/etapa"><form action={updateSavedEstablishmentMetaAction} className="cell-form"><input type="hidden" name="establishmentId" value={lead.establishmentId} /><input name="tags" className="input" defaultValue={lead.tags.join(", ")} placeholder="tags" aria-label={`Tags de ${lead.companyName}`} /><textarea name="notes" className="input" defaultValue={lead.notes} placeholder="Nota operacional" rows={2} aria-label={`Notas de ${lead.companyName}`} /><select name="stage" className="input" defaultValue={lead.stage} aria-label={`Etapa de ${lead.companyName}`}>{STAGES.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select><button type="submit" className="button-secondary button-sm">Atualizar</button></form></td><td data-label="Pesquisa/enriquecimento"><div className="cell-stack"><ProspectingResearchButton establishmentId={lead.establishmentId} /><form action={runProspectingEnrichmentAction}><input type="hidden" name="establishmentId" value={lead.establishmentId} /><button type="submit" className="button-ghost button-sm">Derivar domínio/presença</button></form><span className="footnote">Enriquecimento separado; sem coleta automática de dados pessoais.</span></div></td><td data-label="Ações"><div className="table-actions"><Link href={`/dashboard/companies/${encodeURIComponent(lead.cnpj)}`} className="button-ghost button-sm">Ver ficha</Link>{lead.listId ? <form action={removeEstablishmentFromListAction}><input type="hidden" name="establishmentId" value={lead.establishmentId} /><button type="submit" className="button-ghost button-sm">Remover da lista</button></form> : null}<LeadToggleForm establishmentId={lead.establishmentId} isSaved size="sm" /></div><span className="footnote">Salvo em {formatDateTime(lead.savedAt)}</span></td></tr>)}</tbody></table></div>}</section>
    </>
  );
}

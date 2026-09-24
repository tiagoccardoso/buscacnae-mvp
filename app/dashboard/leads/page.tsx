import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/server";
import { createDbClient } from "@/lib/db-client";
import { EmptyState } from "@/components/empty-state";
import { LeadToggleForm } from "@/components/lead-toggle-form";
import { formatCnpj, formatDateTime, formatMoney } from "@/lib/format";
import { extractSingleObject } from "@/lib/utils";
import {
  assignSavedLeadListAction,
  createSavedLeadListAction,
  deleteSavedLeadListAction
} from "@/app/dashboard/actions";
import { buildDisplayEstablishment } from "@/lib/establishment-presenter";

type LeadsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type SavedListRecord = {
  id: string;
  name: string;
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
  capitalSocial: number;
  status: string;
  listId: string;
  listName: string;
  score: number;
};

function readStatusMessage(status: string) {
  if (status === "lista-criada") return "Lista salva criada com sucesso.";
  if (status === "lead-vinculado") return "Lead vinculado à lista salva.";
  if (status === "lista-excluida") return "Lista salva excluída com sucesso.";
  return "";
}

function readErrorMessage(error: string) {
  if (error === "lista-sem-nome") return "Informe um nome para a lista salva.";
  if (error === "lista-duplicada") return "Já existe uma lista salva com esse nome.";
  if (error === "lista-vinculo") return "Não foi possível vincular o lead à lista.";
  if (error === "lista-invalida") return "Lista salva inválida.";
  if (error === "lista-exclusao") return "Não foi possível excluir a lista salva.";
  if (error === "lead-invalido") return "Lead inválido para operação.";
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

function buildLeadScore(record: ReturnType<typeof buildDisplayEstablishment>) {
  let score = 0;
  if (String(record.email ?? "").trim()) score += 30;
  if (String(record.phone ?? "").trim()) score += 25;
  if (String(record.website ?? "").trim()) score += 15;
  if (String(record.address_line ?? "").trim()) score += 10;
  if (String(record.registration_status ?? "").toUpperCase().includes("ATIVA")) score += 10;

  const capital = toCapital(record.capital_social);
  if (capital >= 1000000) score += 25;
  else if (capital >= 250000) score += 18;
  else if (capital >= 50000) score += 10;

  const companySize = String(record.company_size ?? "").toLowerCase();
  if (companySize.includes("grande")) score += 12;
  else if (companySize.includes("medio") || companySize.includes("médio")) score += 8;
  else if (companySize.includes("pequeno")) score += 5;

  return score;
}

function rankingLabel(type: "promising" | "capital" | "contact") {
  if (type === "promising") return "Melhor potencial comercial";
  if (type === "capital") return "Maior capital social";
  return "Mais canais de contato";
}

function rankingDescription(type: "promising" | "capital" | "contact") {
  if (type === "promising") return "Pontuação baseada em contato, capital, status e presença digital.";
  if (type === "capital") return "Empresas salvas com maior capital social declarado.";
  return "Leads com maior densidade de canais comerciais disponíveis.";
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const user = await getCurrentUser();
  const db = createDbClient();

  if (!user) {
    return null;
  }

  const params = searchParams ? await searchParams : {};
  const selectedListId = typeof params.list === "string" ? params.list : "";
  const status = typeof params.status === "string" ? params.status : "";
  const error = typeof params.error === "string" ? params.error : "";
  const statusMessage = readStatusMessage(status);
  const errorMessage = readErrorMessage(error);

  const [{ data: listRows }, { data: rows }] = await Promise.all([
    db.from("saved_lead_lists").select("id,name,created_at").eq("profile_id", user.id).order("name", { ascending: true }),
    db
      .from("saved_establishments")
      .select("created_at, notes, list_id, saved_lead_lists(id,name), establishments(*)")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false })
  ]);

  const savedLists = (listRows ?? []) as SavedListRecord[];
  const leads = (rows ?? [])
    .map((row) => {
      const establishment = extractSingleObject(row.establishments);
      const list = extractSingleObject(row.saved_lead_lists);
      if (!establishment) return null;
      const display = buildDisplayEstablishment(establishment);
      return {
        savedAt: row.created_at,
        establishmentId: String(establishment.id),
        cnpj: String(display.cnpj ?? ""),
        companyName: String(display.company_name ?? "-"),
        tradeName: String(display.trade_name ?? ""),
        cityName: String(display.city_name ?? "-"),
        stateCode: String(display.state_code ?? "-"),
        email: String(display.email ?? "").trim(),
        phone: String(display.phone ?? "").trim(),
        website: String(display.website ?? "").trim(),
        companySize: String(display.company_size ?? "").trim(),
        capitalSocial: toCapital(display.capital_social),
        status: String(display.registration_status ?? "").trim(),
        listId: String(row.list_id ?? list?.id ?? ""),
        listName: String(list?.name ?? ""),
        score: buildLeadScore(display)
      } satisfies LeadView;
    })
    .filter((item): item is LeadView => Boolean(item));

  const filteredLeads = selectedListId ? leads.filter((item) => item.listId === selectedListId) : leads;

  if (leads.length === 0) {
    return (
      <EmptyState
        title="Nenhum lead salvo"
        description="Salve empresas a partir dos resultados das buscas para montar carteiras por nicho, região e potencial de prospecção."
        ctaHref="/dashboard/search"
        ctaLabel="Buscar empresas"
      />
    );
  }

  const topPromising = [...filteredLeads].sort((a, b) => b.score - a.score).slice(0, 3);
  const topCapital = [...filteredLeads].sort((a, b) => b.capitalSocial - a.capitalSocial).slice(0, 3);
  const topContact = [...filteredLeads]
    .sort((a, b) => (Number(Boolean(b.email)) + Number(Boolean(b.phone)) + Number(Boolean(b.website))) - (Number(Boolean(a.email)) + Number(Boolean(a.phone)) + Number(Boolean(a.website))))
    .slice(0, 3);

  const rankingGroups = [
    { type: "promising" as const, items: topPromising },
    { type: "capital" as const, items: topCapital },
    { type: "contact" as const, items: topContact }
  ];

  return (
    <>
      {statusMessage || errorMessage ? (
        <div className="stack-sm">
          {statusMessage ? <div className="notice success" role="status">{statusMessage}</div> : null}
          {errorMessage ? <div className="notice danger" role="alert">{errorMessage}</div> : null}
        </div>
      ) : null}

      <section className="section" aria-labelledby="leads-title">
        <div className="section-header-row">
          <div className="section-header">
            <span className="eyebrow">Leads salvos</span>
            <h2 id="leads-title" className="title-1">Carteira comercial e listas internas</h2>
            <p className="section-copy">
              Organize leads em listas como “Indústrias SP” ou “Contabilidade PR” e separe carteiras por campanha.
            </p>
          </div>

          <form action={createSavedLeadListAction} className="inline-form" data-analytics-event="saved_list_created">
            <label htmlFor="new-lead-list" className="sr-only">Nome da nova lista</label>
            <input id="new-lead-list" name="name" className="input" placeholder="Nova lista, ex.: Indústrias SP" />
            <button type="submit" className="button-secondary">Criar lista</button>
          </form>
        </div>

        <nav className="list-filter" aria-label="Filtrar por lista salva">
          <Link href="/dashboard/leads" className={`pill${selectedListId ? "" : " pill-active"}`} aria-current={selectedListId ? undefined : "page"}>
            Todas ({leads.length})
          </Link>
          {savedLists.map((list) => {
            const count = leads.filter((item) => item.listId === list.id).length;
            const active = selectedListId === list.id;
            return (
              <div key={list.id} className="list-filter-item">
                <Link
                  href={`/dashboard/leads?list=${encodeURIComponent(list.id)}`}
                  className={`pill${active ? " pill-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {list.name} ({count})
                </Link>
                <form action={deleteSavedLeadListAction}>
                  <input type="hidden" name="listId" value={list.id} />
                  <button type="submit" className="button-icon list-filter-remove" aria-label={`Excluir lista ${list.name}`} title="Excluir lista">
                    <span aria-hidden="true">×</span>
                  </button>
                </form>
              </div>
            );
          })}
        </nav>
      </section>

      <section className="rank-grid" aria-label="Rankings da carteira">
        {rankingGroups.map((group) => (
          <div key={group.type} className="stack-sm">
            <div className="section-header">
              <h3 className="title-3">{rankingLabel(group.type)}</h3>
              <p className="footnote">{rankingDescription(group.type)}</p>
            </div>
            {group.items.length > 0 ? (
              <ol className="rank-list">
                {group.items.map((item) => (
                  <li key={`${group.type}-${item.establishmentId}`}>
                    <span className="rank-name">
                      <strong title={item.companyName}>{item.companyName}</strong>
                      <span>{item.cityName}/{item.stateCode}</span>
                    </span>
                    <span className="rank-value">
                      {group.type === "promising" ? `Score ${item.score}` : null}
                      {group.type === "capital" ? formatMoney(item.capitalSocial) : null}
                      {group.type === "contact" ? `${[item.email, item.phone, item.website].filter(Boolean).length} canais` : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="footnote">Sem leads suficientes para este ranking.</p>
            )}
          </div>
        ))}
      </section>

      <section className="section" aria-labelledby="leads-table-title">
        <div className="section-header">
          <span className="eyebrow">Carteira filtrada</span>
          <h2 id="leads-table-title" className="title-2">Leads prontos para organização e próxima ação</h2>
          <p className="section-copy">
            Filtre por lista salva, reclassifique leads e mantenha uma carteira operacional de prospecção dentro do dashboard.
          </p>
        </div>

        <div className="table-wrap">
          <table className="table table-responsive">
            <caption className="sr-only">Leads salvos na carteira</caption>
            <thead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col">CNPJ</th>
                <th scope="col">Localidade</th>
                <th scope="col">Ranking</th>
                <th scope="col">Lista salva</th>
                <th scope="col">Contato</th>
                <th scope="col" className="cell-num">Capital</th>
                <th scope="col">Salvo em</th>
                <th scope="col" className="cell-actions">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.establishmentId}>
                  <td data-label="Empresa">
                    <div className="cell-stack">
                      <strong>{lead.companyName}</strong>
                      <span className="muted">{lead.tradeName || "Nome fantasia não informado"}</span>
                    </div>
                  </td>
                  <td data-label="CNPJ" className="cell-nowrap">{formatCnpj(lead.cnpj)}</td>
                  <td data-label="Localidade" className="cell-nowrap">{lead.cityName}/{lead.stateCode}</td>
                  <td data-label="Ranking">
                    <div className="cell-stack">
                      <span className="cell-strong">Score {lead.score}</span>
                      <span className="muted">{lead.companySize || "Porte não informado"}</span>
                    </div>
                  </td>
                  <td data-label="Lista salva">
                    <form action={assignSavedLeadListAction} className="cell-form" data-analytics-event="saved_lead_list_updated">
                      <input type="hidden" name="establishmentId" value={lead.establishmentId} />
                      <select name="listId" defaultValue={lead.listId} className="input" aria-label={`Lista salva de ${lead.companyName}`}>
                        <option value="">Sem lista</option>
                        {savedLists.map((list) => (
                          <option key={list.id} value={list.id}>{list.name}</option>
                        ))}
                      </select>
                      <input name="newListName" className="input" placeholder="Nova lista (opcional)" aria-label={`Criar nova lista para ${lead.companyName}`} />
                      <button type="submit" className="button-secondary button-sm">Salvar</button>
                    </form>
                  </td>
                  <td data-label="Contato">
                    <div className="cell-stack">
                      <span className={lead.email ? undefined : "subtle"}>{lead.email || "Sem e-mail"}</span>
                      <span className={lead.phone ? undefined : "subtle"}>{lead.phone || "Sem telefone"}</span>
                      <span className={lead.website ? undefined : "subtle"}>{lead.website || "Sem site"}</span>
                    </div>
                  </td>
                  <td data-label="Capital" className="cell-num">{lead.capitalSocial > 0 ? formatMoney(lead.capitalSocial) : "—"}</td>
                  <td data-label="Salvo em" className="cell-nowrap">{formatDateTime(lead.savedAt)}</td>
                  <td data-label="" className="cell-actions">
                    <div className="table-actions">
                      <Link href={`/dashboard/companies/${encodeURIComponent(lead.cnpj)}`} className="button-ghost button-sm">
                        Ver ficha
                      </Link>
                      <LeadToggleForm establishmentId={lead.establishmentId} isSaved size="sm" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

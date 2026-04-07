import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

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
    supabase.from("saved_lead_lists").select("id,name,created_at").eq("profile_id", user.id).order("name", { ascending: true }),
    supabase
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

  return (
    <div className="stack">
      {statusMessage ? <div className="notice success">{statusMessage}</div> : null}
      {errorMessage ? <div className="notice danger">{errorMessage}</div> : null}

      <div className="surface-premium card-lg stack">
        <div className="lead-lists-toolbar">
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">Leads salvos</span>
            <h2 className="section-title">Carteira comercial e listas internas</h2>
            <p className="section-copy">
              Organize leads em listas como “Indústrias SP” ou “Contabilidade PR”, mantenha atalhos de prospecção e separe carteiras por campanha.
            </p>
          </div>

          <form action={createSavedLeadListAction} className="lead-list-create-form" data-analytics-event="saved_list_created">
            <input name="name" className="input input-premium" placeholder="Ex.: Indústrias SP" />
            <button type="submit" className="button">Criar lista</button>
          </form>
        </div>

        <div className="lead-list-pills">
          <Link href="/dashboard/leads" className={`pill${selectedListId ? "" : " pill-active"}`}>
            Todas ({leads.length})
          </Link>
          {savedLists.map((list) => {
            const count = leads.filter((item) => item.listId === list.id).length;
            return (
              <div key={list.id} className="lead-list-pill-item">
                <Link href={`/dashboard/leads?list=${encodeURIComponent(list.id)}`} className={`pill${selectedListId === list.id ? " pill-active" : ""}`}>
                  {list.name} ({count})
                </Link>
                <form action={deleteSavedLeadListAction}>
                  <input type="hidden" name="listId" value={list.id} />
                  <button type="submit" className="button-ghost lead-list-delete-button">Excluir</button>
                </form>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ranking-grid">
        {[
          { type: "promising" as const, items: topPromising },
          { type: "capital" as const, items: topCapital },
          { type: "contact" as const, items: topContact }
        ].map((group) => (
          <div key={group.type} className="surface-premium card-lg stack">
            <span className="eyebrow">Ranking</span>
            <h3 className="section-title" style={{ fontSize: "1.15rem" }}>{rankingLabel(group.type)}</h3>
            <p className="section-copy">{rankingDescription(group.type)}</p>
            <div className="stack" style={{ gap: 10 }}>
              {group.items.length > 0 ? (
                group.items.map((item, index) => (
                  <div key={`${group.type}-${item.establishmentId}`} className="signal-card">
                    <span className="kicker">#{index + 1}</span>
                    <strong>{item.companyName}</strong>
                    <span className="muted">{item.cityName}/{item.stateCode}</span>
                    {group.type === "promising" ? <span className="pill">Score {item.score}</span> : null}
                    {group.type === "capital" ? <span className="pill">{formatMoney(item.capitalSocial)}</span> : null}
                    {group.type === "contact" ? <span className="pill">{[item.email, item.phone, item.website].filter(Boolean).length} canais</span> : null}
                  </div>
                ))
              ) : (
                <span className="muted">Sem leads suficientes para este ranking.</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="surface-premium card-lg stack">
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Carteira filtrada</span>
          <h2 className="section-title">Leads prontos para organização e próxima ação</h2>
          <p className="section-copy">
            Filtre por lista salva, reclassifique leads e mantenha uma carteira operacional de prospecção dentro do dashboard.
          </p>
        </div>

        <div className="table-wrap">
          <table className="table table-premium table-glow">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Localidade</th>
                <th>Ranking</th>
                <th>Lista salva</th>
                <th>Contato</th>
                <th>Capital</th>
                <th>Quando salvou</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.establishmentId}>
                  <td>
                    <div className="stack" style={{ gap: 6 }}>
                      <strong>{lead.companyName}</strong>
                      <span className="muted">{lead.tradeName || "Nome fantasia não informado"}</span>
                    </div>
                  </td>
                  <td>{formatCnpj(lead.cnpj)}</td>
                  <td>{lead.cityName}/{lead.stateCode}</td>
                  <td>
                    <div className="stack" style={{ gap: 6 }}>
                      <span className="pill">Score {lead.score}</span>
                      <span className="muted">{lead.companySize || "Porte não informado"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="stack" style={{ gap: 8 }}>
                      <span className="muted">{lead.listName || "Sem lista"}</span>
                      <form action={assignSavedLeadListAction} className="lead-list-assign-form" data-analytics-event="saved_lead_list_updated">
                        <input type="hidden" name="establishmentId" value={lead.establishmentId} />
                        <select name="listId" defaultValue={lead.listId} className="input input-premium" aria-label="Escolher lista salva">
                          <option value="">Sem lista</option>
                          {savedLists.map((list) => (
                            <option key={list.id} value={list.id}>{list.name}</option>
                          ))}
                        </select>
                        <input name="newListName" className="input input-premium" placeholder="Nova lista (opcional)" />
                        <button type="submit" className="button-secondary">Salvar</button>
                      </form>
                    </div>
                  </td>
                  <td>
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="muted">{lead.email || "Sem e-mail"}</span>
                      <span className="muted">{lead.phone || "Sem telefone"}</span>
                      <span className="muted">{lead.website || "Sem site"}</span>
                    </div>
                  </td>
                  <td>{lead.capitalSocial > 0 ? formatMoney(lead.capitalSocial) : "-"}</td>
                  <td>{formatDateTime(lead.savedAt)}</td>
                  <td>
                    <div className="inline-actions">
                      <Link href={`/dashboard/companies/${encodeURIComponent(lead.cnpj)}`} className="button-ghost">
                        Ver ficha
                      </Link>
                      <LeadToggleForm establishmentId={lead.establishmentId} isSaved />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

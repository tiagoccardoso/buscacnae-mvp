import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { LeadToggleForm } from "@/components/lead-toggle-form";
import { formatCnpj, formatDateTime } from "@/lib/format";
import { extractSingleObject } from "@/lib/utils";

export default async function LeadsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: rows } = await supabase
    .from("saved_establishments")
    .select("created_at, notes, establishments(*)")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="Nenhum lead salvo"
        description="Salve empresas a partir do resultado da busca para montar sua lista comercial com a mesma linguagem premium do restante da plataforma."
        ctaHref="/dashboard/search"
        ctaLabel="Buscar empresas"
      />
    );
  }

  return (
    <div className="surface-premium card-lg stack">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Leads premium</span>
        <h2 className="section-title">Estabelecimentos salvos</h2>
        <p className="section-copy">
          Sua shortlist comercial fica organizada em uma visão premium, pronta para navegação, remoção e consulta de ficha completa.
        </p>
      </div>

      <div className="table-wrap">
        <table className="table table-premium table-glow">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>CNPJ</th>
              <th>Localidade</th>
              <th>Quando salvou</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const establishment = extractSingleObject(row.establishments);
              if (!establishment) return null;

              const cnpj = String(establishment.cnpj ?? "");
              const establishmentId = String(establishment.id);

              return (
                <tr key={establishmentId}>
                  <td>
                    <div className="stack" style={{ gap: 6 }}>
                      <strong>{String(establishment.company_name ?? "-")}</strong>
                      <span className="muted">{String(establishment.trade_name ?? "")}</span>
                    </div>
                  </td>
                  <td>{formatCnpj(cnpj)}</td>
                  <td>
                    {String(establishment.city_name ?? "-")}/{String(establishment.state_code ?? "-")}
                  </td>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>
                    <div className="inline-actions">
                      <Link href={`/dashboard/companies/${encodeURIComponent(cnpj)}`} className="button-ghost">
                        Ver ficha
                      </Link>
                      <LeadToggleForm establishmentId={establishmentId} isSaved />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

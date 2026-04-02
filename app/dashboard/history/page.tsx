import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/format";

export default async function HistoryPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: searches } = await supabase
    .from("search_queries")
    .select("*")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!searches || searches.length === 0) {
    return (
      <EmptyState
        title="Nenhuma busca registrada"
        description="Quando você executar consultas, elas aparecerão aqui com o total de resultados, cidade, CNAE e informação de cache em uma visão histórica mais executiva."
        ctaHref="/dashboard/search"
        ctaLabel="Fazer primeira busca"
      />
    );
  }

  return (
    <div className="surface-premium card-lg stack">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Histórico operacional</span>
        <h2 className="section-title">Consultas executadas</h2>
        <p className="section-copy">
          Acompanhe volume, localidade, resultado e origem da consulta em uma tabela desenhada para leitura comercial.
        </p>
      </div>

      <div className="table-wrap">
        <table className="table table-premium table-glow">
          <thead>
            <tr>
              <th>Quando</th>
              <th>CNAE</th>
              <th>Localidade</th>
              <th>Resultados</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {searches.map((search) => (
              <tr key={search.id}>
                <td>{formatDateTime(search.created_at)}</td>
                <td>{search.cnae_code}</td>
                <td>
                  {search.city_name}/{search.state_code}
                </td>
                <td>{search.total_results}</td>
                <td>{search.cached ? "cache" : "consulta"}</td>
                <td>
                  <Link href={`/dashboard/search/${search.id}`} className="button-ghost">
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

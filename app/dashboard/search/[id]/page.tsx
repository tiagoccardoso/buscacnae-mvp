import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { LeadToggleForm } from "@/components/lead-toggle-form";
import { formatCnpj, formatDateTime } from "@/lib/format";
import { extractSingleObject } from "@/lib/utils";

type SearchResultPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SearchResultPage({ params }: SearchResultPageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const search = await supabase
    .from("search_queries")
    .select("*")
    .eq("id", id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!search.data) {
    notFound();
  }

  const { data: rows } = await supabase
    .from("search_results")
    .select("position, establishment_id, establishments(*)")
    .eq("search_query_id", id)
    .eq("profile_id", user.id)
    .order("position", { ascending: true });

  const establishmentIds = (rows ?? []).map((row) => row.establishment_id);
  const { data: savedRows } = establishmentIds.length
    ? await supabase
        .from("saved_establishments")
        .select("establishment_id")
        .eq("profile_id", user.id)
        .in("establishment_id", establishmentIds)
    : { data: [] as Array<{ establishment_id: string }> };

  const savedSet = new Set((savedRows ?? []).map((item) => item.establishment_id));

  return (
    <div className="stack">
      <div className="surface-premium card-lg stack">
        <div className="inline-actions" style={{ justifyContent: "space-between" }}>
          <div className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">Resultado da busca</span>
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              CNAE {search.data.cnae_code} · {search.data.city_name}/{search.data.state_code}
            </h2>
            <span className="muted">
              {search.data.total_results} resultados · {search.data.cached ? "cache" : "consulta nova"} · {" "}
              {formatDateTime(search.data.created_at)}
            </span>
          </div>
          <Link href="/dashboard/search" className="button-ghost">
            Nova busca
          </Link>
        </div>
      </div>

      {!rows || rows.length === 0 ? (
        <EmptyState
          title="Nenhum estabelecimento retornado"
          description="Tente outro CNAE, outro município ou revise o provedor configurado. O visual premium continua preservando clareza mesmo quando a busca volta vazia."
          ctaHref="/dashboard/search"
          ctaLabel="Voltar ao formulário"
        />
      ) : (
        <div className="surface-premium card-lg stack">
          <div className="stack" style={{ gap: 8 }}>
            <span className="eyebrow">Lista retornada</span>
            <p className="section-copy">
              Navegue pelos estabelecimentos encontrados, abra a ficha completa ou salve os melhores para o pipeline comercial.
            </p>
          </div>
          <div className="result-card-grid">
            {rows.map((row) => {
              const establishment = extractSingleObject(row.establishments);
              if (!establishment) return null;

              const establishmentId = String(establishment.id);
              const companyName = String(establishment.company_name ?? "-");
              const cnpj = String(establishment.cnpj ?? "");
              const cityName = String(establishment.city_name ?? "-");
              const stateCode = String(establishment.state_code ?? "-");
              const status = String(establishment.registration_status ?? "-");

              return (
                <article key={establishmentId} className="result-card-premium">
                  <div className="result-card-index">#{row.position}</div>
                  <div className="stack" style={{ gap: 6 }}>
                    <strong className="result-card-title">{companyName}</strong>
                    <span className="muted">{String(establishment.trade_name ?? "") || "Nome fantasia não informado"}</span>
                  </div>
                  <div className="result-card-meta">
                    <span><strong>CNPJ:</strong> {formatCnpj(cnpj)}</span>
                    <span><strong>Cidade:</strong> {cityName}/{stateCode}</span>
                    <span><strong>Status:</strong> {status}</span>
                  </div>
                  <div className="inline-actions result-card-actions">
                    <Link href={`/dashboard/companies/${encodeURIComponent(cnpj)}`} className="button-ghost">
                      Ver ficha
                    </Link>
                    <LeadToggleForm establishmentId={establishmentId} isSaved={savedSet.has(establishmentId)} />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

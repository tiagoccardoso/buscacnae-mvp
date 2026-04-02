import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCnpj, formatMoney } from "@/lib/format";

type CompanyPageProps = {
  params: Promise<{ cnpj: string }>;
};

export default async function CompanyPage({ params }: CompanyPageProps) {
  const { cnpj } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const normalizedCnpj = decodeURIComponent(cnpj);

  const { data } = await supabase
    .from("establishments")
    .select("*")
    .eq("cnpj", normalizedCnpj)
    .maybeSingle();

  if (!data) {
    notFound();
  }

  return (
    <div className="stack">
      <div className="surface-premium card-lg stack">
        <span className="eyebrow">Ficha do estabelecimento</span>
        <h2 className="section-title" style={{ fontSize: "2.1rem", marginBottom: 0 }}>
          {data.company_name}
        </h2>
        <span className="muted">
          {formatCnpj(data.cnpj)} · {data.city_name}/{data.state_code}
        </span>
      </div>

      <div className="grid-2">
        <div className="surface-premium card-lg stack">
          <strong>Dados principais</strong>
          <span className="muted">Nome fantasia: {data.trade_name || "-"}</span>
          <span className="muted">Status cadastral: {data.registration_status || "-"}</span>
          <span className="muted">CNAE principal: {data.primary_cnae_code || "-"}</span>
          <span className="muted">Descrição CNAE: {data.primary_cnae_description || "-"}</span>
          <span className="muted">Abertura: {data.opened_at || "-"}</span>
          <span className="muted">Capital social: {formatMoney(data.capital_social)}</span>
        </div>

        <div className="surface-premium card-lg stack">
          <strong>Contato e endereço</strong>
          <span className="muted">Email: {data.email || "-"}</span>
          <span className="muted">Telefone: {data.phone || "-"}</span>
          <span className="muted">Site: {data.website || "-"}</span>
          <span className="muted">CEP: {data.cep || "-"}</span>
          <span className="muted">Bairro: {data.neighborhood || "-"}</span>
          <span className="muted">
            Endereço: {data.address_line || "-"}, {data.address_number || "s/n"} {data.complement || ""}
          </span>
        </div>
      </div>

      <div className="surface-premium card-lg stack">
        <strong>Payload bruto do provedor</strong>
        <pre className="code-block">{JSON.stringify(data.provider_payload ?? {}, null, 2)}</pre>
      </div>
    </div>
  );
}

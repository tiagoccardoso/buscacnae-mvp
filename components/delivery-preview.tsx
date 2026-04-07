import Link from "next/link";
import { deliveryPreviewColumns } from "@/lib/site-content";

const previewRows = [
  {
    company: "Alpha Distribuidora Ltda",
    cnpj: "12.345.678/0001-90",
    city: "Curitiba/PR",
    status: "Ativa",
    phone: "(41) 3333-4444",
    email: "contato@alpha.com.br"
  },
  {
    company: "Comercial Beta ME",
    cnpj: "98.765.432/0001-10",
    city: "Campinas/SP",
    status: "Ativa",
    phone: "(19) 98888-0000",
    email: "—"
  },
  {
    company: "Serviços Gama Ltda",
    cnpj: "45.678.123/0001-55",
    city: "Belo Horizonte/MG",
    status: "Ativa",
    phone: "—",
    email: "vendas@gama.com.br"
  }
];

export function DeliveryPreview() {
  return (
    <section className="surface-premium card-lg stack">
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">O que você recebe</span>
        <h2 className="section-title">Exemplo visual da lista liberada</h2>
        <p className="section-copy">
          A composição exata depende do que foi encontrado na busca, mas a entrega segue a mesma lógica mostrada abaixo.
        </p>
      </div>

      <div className="panel-grid two delivery-preview-grid">
        <div className="table-wrap">
          <table className="table table-premium table-glow">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Cidade</th>
                <th>Status</th>
                <th>Telefone</th>
                <th>E-mail</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.cnpj}>
                  <td>{row.company}</td>
                  <td>{row.cnpj}</td>
                  <td>{row.city}</td>
                  <td>{row.status}</td>
                  <td>{row.phone}</td>
                  <td>{row.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stack">
          <div className="inline-list">
            {deliveryPreviewColumns.map((item) => (
              <span key={item} className="pill">{item}</span>
            ))}
          </div>
          <div className="signal-card">
            <span className="kicker">Prévia antes do checkout</span>
            <strong>Amostra, composição do lote e valor total</strong>
            <span className="muted">Você não compra no escuro. A tela de checkout mostra a amostra da lista, a composição por tipo de lead e o total do pedido.</span>
          </div>
          <div className="signal-card">
            <span className="kicker">Entrega</span>
            <strong>Liberação online e download em XLSX</strong>
            <span className="muted">Depois do pagamento, a lista fica disponível na tela e no arquivo de download dentro da mesma jornada.</span>
          </div>
          <div className="inline-actions">
            <Link href="/pricing" className="button-secondary">
              Ver preços
            </Link>
            <Link href="/onboarding" className="button-ghost">
              Ver fluxo completo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

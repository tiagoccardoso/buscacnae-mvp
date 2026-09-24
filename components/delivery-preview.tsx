import Link from "next/link";
import { deliveryPreviewColumns } from "@/lib/site-content";
import { SectionHeader } from "@/components/ui/section-header";

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
    <section className="section section-spaced" aria-labelledby="delivery-preview-title">
      <SectionHeader
        id="delivery-preview-title"
        eyebrow="O que você recebe"
        title="Exemplo visual da lista liberada"
        copy="A composição exata depende do que foi encontrado na busca, mas a entrega segue a mesma lógica mostrada abaixo."
      />

      <div className="tile">
        <div className="table-wrap">
          <table className="table table-in-tile">
            <caption className="sr-only">Exemplo ilustrativo de registros da lista</caption>
            <thead>
              <tr>
                <th scope="col">Empresa</th>
                <th scope="col">CNPJ</th>
                <th scope="col">Cidade</th>
                <th scope="col">Status</th>
                <th scope="col">Telefone</th>
                <th scope="col">E-mail</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.cnpj}>
                  <td className="cell-strong">{row.company}</td>
                  <td className="cell-nowrap">{row.cnpj}</td>
                  <td className="cell-nowrap">{row.city}</td>
                  <td>
                    <span className="pill success">{row.status}</span>
                  </td>
                  <td className="cell-nowrap">{row.phone}</td>
                  <td>{row.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="split">
        <div className="stack-sm">
          <span className="kicker">Campos da entrega</span>
          <ul className="check-list">
            {deliveryPreviewColumns.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="stack-lg">
          <div className="feature">
            <strong>Amostra, composição do lote e valor total</strong>
            <p>Você não compra no escuro. A tela de checkout mostra a amostra da lista, a composição por tipo de lead e o total do pedido.</p>
          </div>
          <div className="feature">
            <strong>Liberação online e download em XLSX</strong>
            <p>Depois do pagamento, a lista fica disponível na tela e no arquivo de download dentro da mesma jornada.</p>
          </div>
          <div className="cluster">
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

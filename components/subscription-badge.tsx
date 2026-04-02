import { SubscriptionStatus } from "@/lib/types";

export function SubscriptionBadge({ status }: { status?: SubscriptionStatus | null }) {
  if (!status) {
    return <span className="pill warning">Sem assinatura</span>;
  }

  if (status === "active" || status === "trialing") {
    return <span className="pill success">{status === "active" ? "Assinatura ativa" : "Período de trial"}</span>;
  }

  if (status === "past_due") {
    return <span className="pill warning">Pagamento pendente</span>;
  }

  return <span className="pill danger">{status}</span>;
}

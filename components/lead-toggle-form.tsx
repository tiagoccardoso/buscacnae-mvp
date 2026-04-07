import { toggleSavedEstablishmentAction } from "@/app/dashboard/actions";

type LeadToggleFormProps = {
  establishmentId: string;
  isSaved: boolean;
};

export function LeadToggleForm({ establishmentId, isSaved }: LeadToggleFormProps) {
  return (
    <form action={toggleSavedEstablishmentAction} data-analytics-event={isSaved ? "saved_lead_removed" : "saved_lead_added"}>
      <input type="hidden" name="establishmentId" value={establishmentId} />
      <input type="hidden" name="intent" value={isSaved ? "remove" : "save"} />
      <button className={isSaved ? "button-danger" : "button-secondary"} type="submit">
        {isSaved ? "Remover da carteira" : "Salvar na carteira"}
      </button>
    </form>
  );
}

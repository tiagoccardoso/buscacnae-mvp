import { toggleSavedEstablishmentAction } from "@/app/dashboard/actions";

type LeadToggleFormProps = {
  establishmentId: string;
  isSaved: boolean;
};

export function LeadToggleForm({ establishmentId, isSaved }: LeadToggleFormProps) {
  return (
    <form action={toggleSavedEstablishmentAction}>
      <input type="hidden" name="establishmentId" value={establishmentId} />
      <input type="hidden" name="intent" value={isSaved ? "remove" : "save"} />
      <button className={isSaved ? "button-danger" : "button-secondary"} type="submit">
        {isSaved ? "Remover" : "Salvar lead"}
      </button>
    </form>
  );
}

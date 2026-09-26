/**
 * Mensagens exibidas após uma ação do CRM. A página só mostra o `detail` vindo da
 * URL se ele corresponder a uma mensagem conhecida — um link forjado não consegue
 * injetar texto arbitrário no dashboard.
 */

export const CRM_STATUS: Record<string, string> = {
  "deal-criado": "Empresa adicionada ao CRM.",
  "deal-existente": "Esta empresa já está no CRM deste workspace.",
  "lista-enviada": "Lista enviada ao CRM.",
  "deal-atualizado": "Negócio atualizado.",
  "deal-removido": "Negócio removido do CRM. A empresa continua na base e nas suas listas.",
  "nota-criada": "Nota registrada no histórico.",
  "tarefa-criada": "Tarefa criada.",
  "tarefa-atualizada": "Tarefa atualizada.",
  "contato-criado": "Contato cadastrado.",
  "contato-removido": "Contato excluído.",
  "pipeline-salvo": "Pipeline atualizado.",
  "equipe-criada": "Equipe criada. Você é o proprietário.",
  "membro-adicionado": "Membro adicionado à equipe.",
  "membro-nao-encontrado": "Nenhuma conta BuscaCNAE encontrada com esse e-mail. A pessoa precisa criar a conta antes.",
  "membro-atualizado": "Equipe atualizada.",
  "workspace-trocado": "Workspace alterado."
};

export const CRM_ERROR: Record<string, string> = {
  forbidden: "Você não tem permissão para esta ação neste workspace.",
  not_found: "Registro não encontrado neste workspace.",
  invalid: "Dados inválidos. Revise os campos e tente novamente.",
  conflict: "Conflito ao salvar. Recarregue a página e tente novamente.",
  unavailable: "Não foi possível concluir agora. Confirme que a migração sql/neon_crm.sql foi aplicada e tente novamente."
};

const KNOWN_DETAIL_PREFIXES = [
  "O pipeline precisa",
  "Use no máximo",
  "Mantenha ao menos",
  "Toda etapa precisa",
  "Etapa duplicada",
  "Tipo inválido",
  "Use apenas uma etapa",
  "Etapa não encontrada",
  "Escolha para qual etapa",
  "Etapa inválida",
  "Somente ",
  "Você não pode",
  "O responsável da tarefa",
  "Contato inválido",
  "O CRM pessoal",
  "Sem permissão",
  "Informe ",
  "Valor inválido",
  "E-mail inválido",
  "Nenhuma empresa",
  "Configure ao menos"
];

export function isKnownCrmDetail(detail: string) {
  return detail.length <= 200 && KNOWN_DETAIL_PREFIXES.some((prefix) => detail.startsWith(prefix));
}

export function readCrmFeedback(params: Record<string, string | string[] | undefined>) {
  const status = typeof params.status === "string" ? CRM_STATUS[params.status] ?? "" : "";
  const errorCode = typeof params.error === "string" ? params.error : "";
  const detail = typeof params.detail === "string" && isKnownCrmDetail(params.detail) ? params.detail : "";
  const error = errorCode ? detail || CRM_ERROR[errorCode] || CRM_ERROR.invalid : "";
  return { status, error };
}

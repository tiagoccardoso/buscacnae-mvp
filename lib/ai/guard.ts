import { foldText } from "@/lib/analytics/dimensions";
import type { UnsupportedReason } from "@/lib/ai/plan";

/**
 * Primeira barreira (antes de qualquer modelo): tamanho, caracteres de controle e pedidos
 * que o assistente nunca atende — escrita/alteração de dados, SQL, extração do prompt ou
 * de segredos. É uma barreira ADICIONAL: a proteção real é estrutural (o modelo só
 * escolhe ferramentas de leitura com argumentos validados; não existe caminho de escrita).
 */

export const MAX_QUESTION_LENGTH = 500;

export type GuardResult = { ok: true; question: string } | { ok: false; reason: UnsupportedReason | "empty" | "too_long"; message: string };

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|ignora|ignorar|desconsidere|esqueca|esqueça|forget|disregard)\b.{0,40}\b(instruc|instruç|regras|rules|prompt|anteriores|previous|acima|above|sistema|system)/,
  /\b(system prompt|prompt do sistema|prompt de sistema|suas instrucoes|suas instruções|your instructions|developer mode|modo desenvolvedor|jailbreak|dan mode)\b/,
  /\b(revele|mostre|imprima|print|reveal|show|repita|repeat)\b.{0,30}\b(prompt|instrucoes|instruções|instructions|configuracao|configuração)\b/,
  /\b(api[_ -]?key|chave (da|de) api|openai_api_key|database_url|token de acesso|senha do banco|variaveis de ambiente|variáveis de ambiente|env vars?|\.env)\b/,
  /<\s*\/?\s*(system|assistant|developer|tool)\s*>/,
  /\b(voce agora e|você agora é|you are now|finja ser|pretend to be|aja como|act as)\b/
];

const SQL_PATTERNS: RegExp[] = [
  /\b(drop|truncate|alter|create|grant|revoke)\s+(table|database|schema|index|user|role|view)\b/,
  /\b(delete\s+from|insert\s+into|update\s+\w+\s+set|merge\s+into|copy\s+\w+\s+(from|to))\b/,
  /;\s*(select|drop|delete|insert|update|alter|--)/,
  /\bunion\s+(all\s+)?select\b/,
  /\bselect\b[\s\S]{1,120}\bfrom\b\s+[a-z_]+/,
  /\b(pg_sleep|information_schema|pg_catalog|pg_user|xp_cmdshell)\b/,
  /'\s*or\s*'?\d*'?\s*=\s*'?\d*/
];

const WRITE_PATTERNS: RegExp[] = [
  /\b(apague|apagar|exclua|excluir|delete|deletar|remova|remover|altere|alterar|edite|editar|atualize|atualizar|modifique|modificar|insira|inserir|cadastre|cadastrar|salve|salvar|grave|gravar)\b.{0,40}\b(do banco|da base|no banco|na base|o cadastro|do cadastro|os registros|o registro|os dados|permanentemente|definitivamente)\b/,
  /\b(apague|apagar|exclua|excluir|delete|deletar|cadastre|cadastrar|insira|inserir)\b.{0,30}\b(empresa|empresas|cnpj|cnpjs)\b/
];

const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(liste|listar|quero|me passe|passe|envie|mande|mostre|exporte|extraia|copie)\s+(todos\s+)?(os|as)?\s*(telefones|celulares|whatsapps?|e-?mails|contatos|cpfs?|socios|sócios)\b/,
  /\b(qual|quais)\s+(e|é|sao|são)?\s*(o|os|a|as)?\s*(telefone|telefones|celular|whatsapp|e-?mail|e-?mails|contato|contatos|cpf|socios|sócios)\s+(d[aoe]s?|dess[ae]s?|dest[ae]s?)\b/
];

/** Remove caracteres invisíveis/controle e normaliza espaços; preserva acentos e caixa. */
export function cleanQuestion(input: unknown) {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function guardQuestion(input: unknown): GuardResult {
  const question = cleanQuestion(input);
  if (!question) return { ok: false, reason: "empty", message: "Escreva uma pergunta sobre as empresas desta busca." };
  if (question.length > MAX_QUESTION_LENGTH) {
    return { ok: false, reason: "too_long", message: `A pergunta tem ${question.length} caracteres; o limite é ${MAX_QUESTION_LENGTH}. Resuma em uma frase.` };
  }
  const lowered = question.toLowerCase();
  const folded = foldText(question);
  const test = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(lowered) || pattern.test(folded));

  if (test(INJECTION_PATTERNS)) {
    return {
      ok: false,
      reason: "injection",
      message:
        "Não posso alterar minhas regras nem revelar configurações internas. Posso responder perguntas sobre as empresas desta busca — por exemplo, “Quais municípios têm mais empresas?”."
    };
  }
  if (test(SQL_PATTERNS)) {
    return {
      ok: false,
      reason: "write",
      message:
        "Não executo SQL nem comandos de banco. As consultas são somente leitura e passam por ferramentas fixas. Descreva o que quer saber em português — por exemplo, “Quantas empresas ativas há em Curitiba?”."
    };
  }
  if (test(WRITE_PATTERNS)) {
    return {
      ok: false,
      reason: "write",
      message: "O assistente só consulta e analisa: não apaga, altera nem cadastra empresas. Posso filtrar, contar, comparar ou mostrar no mapa."
    };
  }
  if (test(SENSITIVE_PATTERNS)) {
    return {
      ok: false,
      reason: "sensitive",
      message:
        "O assistente não lista telefones, e-mails ou dados pessoais. Posso contar quantas empresas têm telefone ou e-mail; os contatos ficam na aba Empresas e na ficha, conforme a liberação da lista."
    };
  }
  return { ok: true, question };
}

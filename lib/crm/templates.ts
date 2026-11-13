/**
 * Modelos de mensagem comercial (WhatsApp).
 *
 * - Variáveis entre chaves: {nome_contato}, {nome_empresa}, {nome_usuario}, {cidade}.
 * - `renderTemplate` substitui pelos dados disponíveis. Quando um dado não existe,
 *   a variável é removida e a pontuação ao redor é ajustada ("Olá, {nome_contato}!"
 *   sem nome vira "Olá!") — a mensagem final nunca sai com placeholder.
 * - Nada é enviado automaticamente: o texto só pré-preenche o WhatsApp do usuário.
 */

export const TEMPLATE_VARIABLES = {
  nome_contato: "Nome do contato",
  nome_empresa: "Nome da empresa",
  nome_usuario: "Seu nome",
  cidade: "Cidade"
} as const;

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;
export type TemplateValues = Partial<Record<TemplateVariable, string | null | undefined>>;

export type MessageTemplate = { id: string; name: string; body: string; isDefault: boolean; createdBy: string | null };

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: "default:primeiro-contato",
    name: "Primeiro contato",
    body: "Olá, {nome_contato}! Tudo bem?\nMeu nome é {nome_usuario}. Gostaria de apresentar uma solução que pode ajudar a {nome_empresa}.\nPodemos conversar?",
    isDefault: true,
    createdBy: null
  },
  {
    id: "default:retomada",
    name: "Retomada de negociação",
    body: "Olá, {nome_contato}! Tudo bem?\nEstou entrando em contato para dar continuidade à nossa conversa sobre a proposta apresentada.",
    isDefault: true,
    createdBy: null
  },
  {
    id: "default:proposta",
    name: "Envio de proposta",
    body: "Olá, {nome_contato}!\nPreparei uma proposta comercial para {nome_empresa}. Gostaria de compartilhar com você.",
    isDefault: true,
    createdBy: null
  }
];

const VARIABLE_PATTERN = /\{\s*([a-z_]+)\s*\}/g;
/** Qualquer expressão entre chaves (maiúsculas, espaços, hífen, malformadas…). */
const ANY_BRACE_PATTERN = /\{[^{}\n]{0,60}\}/g;

/**
 * Expressões entre chaves que NÃO são uma variável conhecida bem escrita. Usado para
 * recusar o modelo ao salvar e bloquear a abertura do WhatsApp com texto quebrado.
 */
export function findInvalidBraces(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(ANY_BRACE_PATTERN)) {
    const inner = match[0].slice(1, -1).trim();
    if (!isVariable(inner)) found.add(match[0]);
  }
  // Chave solta ("{nome_contato" ou "nome}") também é placeholder quebrado.
  const stripped = text.replace(ANY_BRACE_PATTERN, "");
  if (/[{}]/.test(stripped)) found.add(stripped.includes("{") ? "{" : "}");
  return [...found];
}

export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_BODY_MAX = 2000;

function isVariable(name: string): name is TemplateVariable {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_VARIABLES, name);
}

/** Variáveis conhecidas que ainda aparecem no texto (ex.: o usuário digitou à mão). */
export function findUnresolvedVariables(text: string): TemplateVariable[] {
  const found = new Set<TemplateVariable>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) if (isVariable(match[1])) found.add(match[1]);
  return [...found];
}

/** Variáveis desconhecidas em um modelo (erro de digitação ao salvar). */
export function findUnknownVariables(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) if (!isVariable(match[1])) found.add(match[1]);
  return [...found];
}

function clean(value: string | null | undefined) {
  // Valores vêm do CRM (dado do usuário ou da base): sem quebras e sem chaves,
  // para que um nome como "{cidade}" não reintroduza variáveis.
  return String(value ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** Texto neutro usado quando o dado não existe e removê-lo deixaria a frase quebrada. */
const FALLBACK: Partial<Record<TemplateVariable, string>> = { nome_empresa: "sua empresa", cidade: "sua cidade" };

export function renderTemplate(body: string, values: TemplateValues) {
  const missing = new Set<TemplateVariable>();
  let text = body.replace(VARIABLE_PATTERN, (whole, name: string) => {
    if (!isVariable(name)) return whole;
    const value = clean(values[name]);
    if (value) return value;
    missing.add(name);
    return FALLBACK[name] ?? "\u0000";
  });
  // Remove o marcador de valor ausente e a pontuação/espaço que só fazia sentido com ele.
  text = text
    .replace(/[ \t]*,[ \t]*\u0000(?=[ \t]*[!?.,;:])/g, "")
    .replace(/[ \t]*,[ \t]*\u0000/g, "")
    .replace(/\u0000[ \t]*,[ \t]*/g, "")
    .replace(/[ \t]*\u0000/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([!?.,;:])/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
  return { text, missing: [...missing] };
}

export function validateTemplate(input: { name: unknown; body: unknown }) {
  const name = String(input.name ?? "").trim().slice(0, TEMPLATE_NAME_MAX);
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!name) return { ok: false as const, error: "Informe o nome do modelo." };
  if (!body) return { ok: false as const, error: "Informe o texto do modelo." };
  if (body.length > TEMPLATE_BODY_MAX) return { ok: false as const, error: `Use no máximo ${TEMPLATE_BODY_MAX} caracteres no modelo.` };
  const invalid = findInvalidBraces(body);
  if (invalid.length) return { ok: false as const, error: `Variável desconhecida no modelo: ${invalid[0]}. Use só ${Object.keys(TEMPLATE_VARIABLES).map((key) => `{${key}}`).join(", ")}.` };
  return { ok: true as const, name, body };
}

"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WhatsAppIcon } from "@/components/crm/whatsapp-link";
import { TEMPLATE_VARIABLES, findInvalidBraces, findUnresolvedVariables, renderTemplate, type MessageTemplate, type TemplateValues } from "@/lib/crm/templates";
import { WHATSAPP_MESSAGE_MAX, WHATSAPP_REASON_LABEL, buildWhatsappUrl, normalizeWhatsappNumber } from "@/lib/whatsapp";

export type ComposerRecipient = { id: string; label: string; phone: string; contactName: string | null };

type LogResult = { ok: boolean; error?: string };

type Props = {
  dealId: string;
  recipients: ComposerRecipient[];
  templates: Array<Pick<MessageTemplate, "id" | "name" | "body">>;
  /** Valores comuns (empresa, usuário, cidade). O nome do contato vem do destinatário. */
  values: Omit<TemplateValues, "nome_contato">;
  /** Registro explícito no histórico, feito somente se o usuário clicar. */
  logAction?: (dealId: string, summary: string) => Promise<LogResult>;
  triggerLabel?: string;
  /** Destinatário pré-selecionado (ex.: botão ao lado de um contato). */
  initialRecipientId?: string;
  compact?: boolean;
};

const NO_TEMPLATE = "";

/**
 * Compositor de mensagem para o WhatsApp.
 *
 * - Escolher modelo → texto preenchido com os dados do CRM → editável.
 * - "Abrir WhatsApp" usa o link oficial wa.me em nova aba (app no celular, Web no desktop).
 * - Nada é enviado nem registrado sozinho: abrir o WhatsApp não comprova envio. Depois de
 *   abrir, o usuário PODE registrar o contato no histórico com um clique explícito.
 */
export function WhatsAppComposer({ dealId, recipients, templates, values, logAction, triggerLabel = "WhatsApp", initialRecipientId, compact }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const router = useRouter();
  const valid = recipients.filter((recipient) => normalizeWhatsappNumber(recipient.phone).ok);
  const [recipientId, setRecipientId] = useState(initialRecipientId && valid.some((item) => item.id === initialRecipientId) ? initialRecipientId : valid[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);
  const [message, setMessage] = useState("");
  const [opened, setOpened] = useState(false);
  const [summary, setSummary] = useState("");
  const [logState, setLogState] = useState<{ status: "idle" | "done" | "error"; error?: string }>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const recipient = valid.find((item) => item.id === recipientId) ?? null;
  // Variável conhecida não substituída OU qualquer outra expressão entre chaves bloqueia a abertura.
  const unresolved = useMemo(() => [...findUnresolvedVariables(message).map((name) => `{${name}}`), ...findInvalidBraces(message)], [message]);
  const href = recipient && !unresolved.length ? buildWhatsappUrl(recipient.phone, message) : null;
  const plainHref = recipient ? buildWhatsappUrl(recipient.phone) : null;
  const tooLong = message.trim().length > WHATSAPP_MESSAGE_MAX;

  if (!valid.length) {
    const reason = recipients[0] ? normalizeWhatsappNumber(recipients[0].phone) : null;
    return (
      <span className="footnote muted" title={reason && !reason.ok ? WHATSAPP_REASON_LABEL[reason.reason] : undefined}>
        {recipients.length ? "Telefone sem formato válido para WhatsApp" : "Sem telefone para WhatsApp"}
      </span>
    );
  }

  function applyTemplate(nextTemplateId: string, nextRecipientId = recipientId) {
    setTemplateId(nextTemplateId);
    const template = templates.find((item) => item.id === nextTemplateId);
    const target = valid.find((item) => item.id === nextRecipientId) ?? null;
    if (!template) {
      setMessage("");
      return;
    }
    setMessage(renderTemplate(template.body, { ...values, nome_contato: target?.contactName ?? null }).text);
  }

  const missingForTemplate = (() => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return [];
    return renderTemplate(template.body, { ...values, nome_contato: recipient?.contactName ?? null }).missing;
  })();

  function open() {
    setOpened(false);
    setLogState({ status: "idle" });
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  function markOpened(withMessage: boolean) {
    setOpened(true);
    // O texto da mensagem NÃO é copiado para o histórico (pode conter dado pessoal);
    // o usuário escreve um resumo se quiser.
    // Texto neutro: abrir o WhatsApp não prova envio; o usuário confirma ao clicar em Registrar.
    setSummary(withMessage ? "Contato iniciado pelo WhatsApp (com mensagem)" : "Contato iniciado pelo WhatsApp");
  }

  function logContact() {
    if (!logAction) return;
    startTransition(async () => {
      const result = await logAction(dealId, summary.trim());
      if (result.ok) {
        setLogState({ status: "done" });
        router.refresh();
      } else {
        setLogState({ status: "error", error: result.error ?? "Não foi possível registrar agora." });
      }
    });
  }

  return (
    <>
      <button type="button" className={`button-secondary${compact ? " button-sm" : ""} wa-trigger`} onClick={open}>
        <WhatsAppIcon />
        <span>{triggerLabel}</span>
      </button>
      <dialog ref={dialogRef} className="wa-dialog" aria-labelledby={titleId} onClose={() => setOpened(false)}>
        <div className="wa-dialog-body stack-sm">
          <div className="cluster cluster-between">
            <h2 id={titleId} className="headline">Conversar pelo WhatsApp</h2>
            <button type="button" className="button-ghost button-sm" onClick={close} aria-label="Fechar">Fechar</button>
          </div>

          {valid.length > 1 ? (
            <label className="field">
              <span className="field-label">Para</span>
              <select
                className="input"
                value={recipientId}
                onChange={(event) => {
                  setRecipientId(event.target.value);
                  if (templateId) applyTemplate(templateId, event.target.value);
                }}
              >
                {valid.map((item) => {
                  const number = normalizeWhatsappNumber(item.phone);
                  return <option key={item.id} value={item.id}>{item.label} · {number.ok ? number.display : item.phone}</option>;
                })}
              </select>
            </label>
          ) : (
            <p className="footnote">Para: <strong>{recipient?.label}</strong> · <span className="numeric">{(() => { const n = normalizeWhatsappNumber(recipient?.phone); return n.ok ? n.display : ""; })()}</span></p>
          )}

          <label className="field">
            <span className="field-label">Modelo</span>
            <select className="input" value={templateId} onChange={(event) => applyTemplate(event.target.value)}>
              <option value={NO_TEMPLATE}>Sem modelo (escrever ou abrir sem mensagem)</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Mensagem</span>
            <textarea
              className="textarea"
              rows={6}
              value={message}
              maxLength={WHATSAPP_MESSAGE_MAX + 200}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Escreva a mensagem ou escolha um modelo. Você pode editar antes de abrir."
            />
            <span className={`field-help${tooLong ? " field-error" : ""}`}>{message.trim().length}/{WHATSAPP_MESSAGE_MAX} caracteres</span>
          </label>

          {missingForTemplate.length ? (
            <p className="notice info" role="status">
              Sem dado para {missingForTemplate.map((name) => TEMPLATE_VARIABLES[name].toLowerCase()).join(", ")}: o trecho foi ajustado. Revise o texto antes de abrir.
            </p>
          ) : null}
          {unresolved.length ? (
            <p className="notice warning" role="alert">
              Substitua {unresolved.join(", ")} pelo texto real antes de abrir.
            </p>
          ) : null}

          <div className="cluster cluster-end wa-actions">
            {plainHref ? (
              <a className="button-ghost button-sm" href={plainHref} target="_blank" rel="noopener noreferrer" onClick={() => markOpened(false)}>
                Abrir sem mensagem
              </a>
            ) : null}
            {href && message.trim() && !tooLong ? (
              <a className="button button-sm wa-open" href={href} target="_blank" rel="noopener noreferrer" onClick={() => markOpened(true)}>
                <WhatsAppIcon />
                <span>Abrir WhatsApp com a mensagem</span>
              </a>
            ) : (
              <button type="button" className="button button-sm" disabled>
                <WhatsAppIcon />
                <span>Abrir WhatsApp com a mensagem</span>
              </button>
            )}
          </div>
          <p className="caption">A mensagem não é enviada pelo BuscaCNAE. O WhatsApp abre em nova aba (ou no aplicativo, no celular) e o envio é feito por você.</p>

          {opened && logAction ? (
            <div className="wa-log stack-xs" role="region" aria-label="Registrar contato">
              <p className="footnote"><strong>Enviou a mensagem?</strong> Abrir o WhatsApp não confirma o envio. Registre no histórico só se a conversa aconteceu.</p>
              {logState.status === "done" ? (
                <p className="notice success" role="status">Contato por WhatsApp registrado no histórico.</p>
              ) : (
                <>
                  <label className="field">
                    <span className="field-label">Resumo (opcional)</span>
                    <input className="input" value={summary} maxLength={500} onChange={(event) => setSummary(event.target.value)} />
                  </label>
                  {logState.status === "error" ? <p className="notice danger" role="alert">{logState.error}</p> : null}
                  <div className="cluster cluster-end">
                    <button type="button" className="button-secondary button-sm" onClick={logContact} disabled={pending} aria-busy={pending}>
                      Registrar contato por WhatsApp
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

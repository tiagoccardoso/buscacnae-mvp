"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { checkProspectDuplicates, type DuplicateCheckResult, type ProspectFormState } from "@/app/dashboard/crm/prospect-actions";
import { formatCnpj } from "@/lib/format";
import { BR_STATES, PRIORITY_LABEL, PROSPECT_ORIGIN_LABEL, type ProspectKind } from "@/lib/crm/prospects";
import { WHATSAPP_REASON_LABEL, normalizeWhatsappNumber } from "@/lib/whatsapp";
import type { PipelineStage, ProspectRecord } from "@/lib/crm/types";

type Option = { value: string; label: string };

type Props = {
  mode: "create" | "edit";
  action: (state: ProspectFormState, formData: FormData) => Promise<ProspectFormState>;
  defaults?: Partial<ProspectRecord>;
  dealId?: string;
  from?: "crm" | "leads";
  cancelHref: string;
  stages?: PipelineStage[];
  owners?: Option[];
  defaultOwnerId?: string;
};

const REASON_LABEL = { document: "mesmo documento", phone: "mesmo telefone", email: "mesmo e-mail" } as const;

function formatDocumentDefault(defaults?: Partial<ProspectRecord>) {
  if (!defaults?.document) return "";
  return defaults.documentType === "cnpj" ? formatCnpj(defaults.document) : defaults.document;
}

/** Aviso inline do telefone para WhatsApp (sem bloquear a digitação). */
function PhoneHint({ value, required }: { value: string; required?: boolean }) {
  if (!value.trim()) return required ? null : null;
  const number = normalizeWhatsappNumber(value);
  if (number.ok) return <span className="field-help">WhatsApp: <span className="numeric">{number.display}</span></span>;
  return <span className="field-help">{WHATSAPP_REASON_LABEL[number.reason]} (o número será salvo como digitado)</span>;
}

/**
 * Cadastro/edição de prospect manual. Os dados informados ficam separados da base
 * oficial: se o CNPJ já existir no BuscaCNAE, o usuário escolhe vincular à ficha.
 * Possíveis duplicidades são só exibidas — nunca mescladas automaticamente.
 */
export function ProspectForm({ mode, action, defaults, dealId, from = "crm", cancelHref, stages = [], owners = [], defaultOwnerId }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [kind, setKind] = useState<ProspectKind>(defaults?.kind ?? "company");
  const [document, setDocument] = useState(formatDocumentDefault(defaults));
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(defaults?.whatsapp ?? "");
  const [phoneSecondary, setPhoneSecondary] = useState(defaults?.phoneSecondary ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [check, setCheck] = useState<DuplicateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [linkEstablishment, setLinkEstablishment] = useState(true);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);

  const runCheck = useCallback(async () => {
    const payload = { kind, document, phones: [phone, whatsapp, phoneSecondary], email, ignoreDealProspectId: defaults?.id ?? null };
    if (!payload.document.trim() && !payload.email.trim() && !payload.phones.some((value) => value.replace(/\D/g, "").length >= 8)) {
      setCheck(null);
      return;
    }
    const request = ++requestRef.current;
    setChecking(true);
    const result = await checkProspectDuplicates(payload).catch(() => ({ ok: false as const, error: "Não foi possível verificar duplicidades agora." }));
    if (request === requestRef.current) {
      setCheck(result);
      setChecking(false);
    }
  }, [kind, document, phone, whatsapp, phoneSecondary, email, defaults?.id]);

  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  const report = check?.ok ? check.report : null;
  const establishment = mode === "create" && kind === "company" ? report?.establishment ?? null : null;
  const linking = Boolean(establishment && !establishment.dealId && linkEstablishment);

  return (
    <form action={formAction} className="prospect-form stack-lg" noValidate={false}>
      {dealId ? <input type="hidden" name="dealId" value={dealId} /> : null}
      <input type="hidden" name="from" value={from} />
      {linking && establishment ? <input type="hidden" name="linkEstablishmentId" value={establishment.id} /> : null}

      {state.error ? (
        <div ref={errorRef} tabIndex={-1} className="notice danger" role="alert">{state.error}</div>
      ) : null}

      <fieldset className="prospect-section stack-sm">
        <legend className="headline">Identificação</legend>
        <div className="segmented prospect-kind" role="radiogroup" aria-label="Tipo de prospect">
          {(["company", "person"] as const).map((value) => (
            <label key={value} className="segmented-item" data-checked={kind === value ? "true" : undefined}>
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => {
                  setKind(value);
                  setDocument("");
                  setCheck(null);
                }}
                className="sr-only"
              />
              {value === "company" ? "Empresa" : "Pessoa física"}
            </label>
          ))}
        </div>
        <div className="grid-2 crm-grid-tight">
          <label className="field">
            <span className="field-label">{kind === "company" ? "Razão social ou nome *" : "Nome completo *"}</span>
            <input name="name" className="input" required maxLength={160} defaultValue={defaults?.name ?? ""} autoComplete="off" />
          </label>
          {kind === "company" ? (
            <label className="field">
              <span className="field-label">Nome fantasia</span>
              <input name="tradeName" className="input" maxLength={160} defaultValue={defaults?.tradeName ?? ""} autoComplete="off" />
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">{kind === "company" ? "CNPJ (opcional)" : "CPF (opcional)"}</span>
            <input
              name="document"
              className="input numeric"
              inputMode={kind === "company" ? "text" : "numeric"}
              maxLength={20}
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              onBlur={runCheck}
              autoComplete="off"
              aria-describedby="document-help"
            />
            <span id="document-help" className={`field-help${check?.ok && check.documentError ? " field-error" : ""}`}>
              {check?.ok && check.documentError
                ? check.documentError
                : kind === "company"
                  ? "Se o CNPJ já estiver na base BuscaCNAE, você poderá vincular à ficha oficial."
                  : "Dado pessoal: informe só se for necessário para a negociação."}
            </span>
          </label>
          <label className="field">
            <span className="field-label">Origem *</span>
            <select name="origin" className="input" defaultValue={defaults?.origin ?? "manual"}>
              {Object.entries(PROSPECT_ORIGIN_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Detalhe da origem</span>
            <input name="originDetail" className="input" maxLength={160} defaultValue={defaults?.originDetail ?? ""} placeholder="Ex.: indicação do cliente X, feira Y" />
          </label>
          <label className="field">
            <span className="field-label">Segmento de atuação</span>
            <input name="segment" className="input" maxLength={120} defaultValue={defaults?.segment ?? ""} placeholder="Ex.: Contabilidade, Varejo" />
          </label>
          <div className="grid-2 crm-grid-tight prospect-city">
            <label className="field">
              <span className="field-label">Cidade</span>
              <input name="cityName" className="input" maxLength={120} defaultValue={defaults?.cityName ?? ""} />
            </label>
            <label className="field">
              <span className="field-label">UF</span>
              <select name="stateCode" className="input" defaultValue={defaults?.stateCode ?? ""}>
                <option value="">—</option>
                {BR_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field-label">Endereço</span>
            <input name="address" className="input" maxLength={300} defaultValue={defaults?.address ?? ""} autoComplete="off" />
          </label>
        </div>
      </fieldset>

      <fieldset className="prospect-section stack-sm">
        <legend className="headline">Contato</legend>
        <div className="grid-2 crm-grid-tight">
          {kind === "company" ? (
            <>
              <label className="field">
                <span className="field-label">Nome do responsável</span>
                <input name="contactName" className="input" maxLength={120} defaultValue={defaults?.contactName ?? ""} autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">Cargo ou função</span>
                <input name="contactRole" className="input" maxLength={120} defaultValue={defaults?.contactRole ?? ""} autoComplete="off" />
              </label>
            </>
          ) : (
            <label className="field">
              <span className="field-label">Profissão ou função</span>
              <input name="contactRole" className="input" maxLength={120} defaultValue={defaults?.contactRole ?? ""} autoComplete="off" />
            </label>
          )}
          <label className="field">
            <span className="field-label">WhatsApp</span>
            <input name="whatsapp" type="tel" inputMode="tel" className="input numeric" maxLength={40} value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} onBlur={runCheck} placeholder="(41) 99999-8888" autoComplete="off" />
            <PhoneHint value={whatsapp} />
          </label>
          <label className="field">
            <span className="field-label">Telefone principal</span>
            <input name="phone" type="tel" inputMode="tel" className="input numeric" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} onBlur={runCheck} autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Telefone adicional</span>
            <input name="phoneSecondary" type="tel" inputMode="tel" className="input numeric" maxLength={40} value={phoneSecondary} onChange={(event) => setPhoneSecondary(event.target.value)} onBlur={runCheck} autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">E-mail</span>
            <input name="email" type="email" className="input" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} onBlur={runCheck} autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Site</span>
            <input name="website" className="input" maxLength={300} defaultValue={defaults?.website ?? ""} placeholder="www.empresa.com.br" autoComplete="off" />
          </label>
        </div>
        <p className="caption">Números internacionais: use + e o código do país (ex.: +351 912 345 678). Telefones são guardados como digitados.</p>
      </fieldset>

      <section className="prospect-duplicates" aria-live="polite" aria-busy={checking}>
        {checking ? <p className="footnote">Verificando cadastros parecidos…</p> : null}
        {check && !check.ok ? <p className="notice warning">{check.error}</p> : null}
        {establishment ? (
          establishment.dealId ? (
            <div className="notice info stack-2xs">
              <strong>Esta empresa já está no seu CRM.</strong>
              <span>{establishment.companyName} · {formatCnpj(establishment.cnpj)}</span>
              <Link href={`/dashboard/crm/${establishment.dealId}`} className="text-link">Abrir o negócio existente →</Link>
            </div>
          ) : (
            <div className="notice info stack-xs">
              <strong>Encontramos esta empresa na base BuscaCNAE</strong>
              <span>{establishment.companyName} · {formatCnpj(establishment.cnpj)}{establishment.cityName ? ` · ${establishment.cityName}/${establishment.stateCode}` : ""}</span>
              <label className="checkbox-inline">
                <input type="checkbox" checked={linkEstablishment} onChange={(event) => setLinkEstablishment(event.target.checked)} />
                Vincular à ficha oficial (recomendado). Os dados cadastrais vêm da base; o responsável, telefones e e-mail informados viram um contato do CRM.
              </label>
            </div>
          )
        ) : null}
        {report?.matches.length ? (
          <div className="notice warning stack-xs">
            <strong>Possíveis duplicidades neste workspace</strong>
            <ul className="prospect-dup-list">
              {report.matches.map((match) => (
                <li key={match.dealId}>
                  <Link href={`/dashboard/crm/${match.dealId}`} className="text-link" target="_blank" rel="noopener">{match.name}</Link>
                  <span className="caption"> · {match.reasons.map((reason) => REASON_LABEL[reason]).join(", ")}</span>
                </li>
              ))}
            </ul>
            <span className="caption">Nada é mesclado automaticamente. Abra o registro existente para aproveitá-lo, ou salve se for outro prospect.</span>
          </div>
        ) : null}
      </section>

      {mode === "create" ? (
        <fieldset className="prospect-section stack-sm">
          <legend className="headline">Gestão comercial</legend>
          <div className="grid-2 crm-grid-tight">
            <label className="field">
              <span className="field-label">Etapa inicial</span>
              <select name="stageId" className="input" defaultValue={stages.find((stage) => stage.kind === "open")?.id ?? stages[0]?.id}>
                {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Responsável comercial</span>
              <select name="ownerProfileId" className="input" defaultValue={defaultOwnerId}>
                {owners.map((owner) => <option key={owner.value} value={owner.value}>{owner.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Valor estimado (R$)</span>
              <input name="amount" className="input numeric" inputMode="decimal" placeholder="0,00" />
            </label>
            <label className="field">
              <span className="field-label">Previsão de fechamento</span>
              <input name="expectedCloseDate" type="date" className="input" />
            </label>
            <label className="field">
              <span className="field-label">Prioridade</span>
              <select name="priority" className="input" defaultValue="normal">
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Próximo contato</span>
              <input name="nextContactAt" type="datetime-local" className="input" />
            </label>
          </div>
          {!linking ? (
            <label className="field">
              <span className="field-label">Tags</span>
              <input name="tags" className="input" maxLength={400} defaultValue={(defaults?.tags ?? []).join(", ")} placeholder="Separe por vírgula: indicação, região-sul" />
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">Observações</span>
            <textarea name="notes" className="textarea" rows={3} maxLength={5000} placeholder="Contexto do primeiro contato, necessidades, objeções…" />
            <span className="field-help">Entra no histórico como a primeira nota do negócio.</span>
          </label>
        </fieldset>
      ) : (
        <fieldset className="prospect-section stack-sm">
          <legend className="headline">Classificação</legend>
          <label className="field">
            <span className="field-label">Tags</span>
            <input name="tags" className="input" maxLength={400} defaultValue={(defaults?.tags ?? []).join(", ")} placeholder="Separe por vírgula" />
          </label>
          <p className="caption">Etapa, responsável, valor, prioridade e próximo contato são editados na ficha do negócio.</p>
        </fieldset>
      )}

      <div className="cluster cluster-end prospect-actions">
        <Link href={cancelHref} className="button-ghost">Cancelar</Link>
        <button type="submit" className="button" disabled={pending} aria-busy={pending}>
          {mode === "create" ? (linking ? "Vincular e incluir no pipeline" : "Cadastrar prospect") : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toggleSavedEstablishmentAction } from "@/app/dashboard/actions";
import { formatCnpj, formatDate, formatMoney } from "@/lib/format";
import { PRECISION_LABELS, isPreciseLocation, type MapCompany } from "@/lib/map/types";

type CompanyMapPanelProps = {
  company: MapCompany;
  searchId: string;
  onClose(): void;
  onSavedChange(companyId: string, saved: boolean): void;
};

function formatCnae(code: string | null) {
  const digits = (code ?? "").replace(/\D/g, "");
  if (digits.length !== 7) return code ?? "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 5)}/${digits.slice(5)}`;
}

/**
 * Resumo da empresa selecionada no mapa. "Ver empresa" abre a ficha existente
 * (/dashboard/companies/[cnpj]); salvar na carteira usa a mesma server action da lista.
 */
export function CompanyMapPanel({ company, searchId, onClose, onSavedChange }: CompanyMapPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [saved, setSaved] = useState(company.saved);
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState("");

  // O painel é remontado a cada empresa (key no componente pai); aqui só movemos o foco.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const location = company.location;
  const approximate = location ? !isPreciseLocation(location.precision) : false;
  const place = [company.cityName, company.stateCode].filter(Boolean).join(" / ");

  function toggleSaved() {
    const nextSaved = !saved;
    const formData = new FormData();
    formData.set("establishmentId", company.id);
    formData.set("intent", nextSaved ? "save" : "remove");
    setSaveError("");
    startTransition(async () => {
      try {
        await toggleSavedEstablishmentAction(formData);
        setSaved(nextSaved);
        onSavedChange(company.id, nextSaved);
      } catch {
        setSaveError("Não foi possível atualizar a carteira agora.");
      }
    });
  }

  return (
    <section className="map-company-panel glass-thick" aria-labelledby="map-company-title">
      <div className="map-company-panel-head">
        <div className="stack-xs">
          <span className="eyebrow">Empresa selecionada</span>
          <h3 id="map-company-title" className="title-3" ref={headingRef} tabIndex={-1}>
            {company.displayName}
          </h3>
          {company.tradeName && company.tradeName !== company.legalName ? (
            <p className="footnote">{company.legalName}</p>
          ) : null}
        </div>
        <button type="button" className="button-icon" onClick={onClose} aria-label="Fechar resumo da empresa">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>

      <dl className="map-company-facts">
        <div>
          <dt>CNPJ</dt>
          <dd className="numeric">{formatCnpj(company.cnpj)}</dd>
        </div>
        <div>
          <dt>Situação</dt>
          <dd>{company.status ? <span className="pill">{company.status}</span> : <span className="is-missing">Não informada</span>}</dd>
        </div>
        <div className="map-company-facts-wide">
          <dt>CNAE principal</dt>
          <dd>
            {company.primaryCnaeCode ? (
              <>
                <span className="numeric">{formatCnae(company.primaryCnaeCode)}</span>
                {company.primaryCnaeDescription ? ` · ${company.primaryCnaeDescription}` : ""}
              </>
            ) : (
              <span className="is-missing">Não informado</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Município / UF</dt>
          <dd>{place || <span className="is-missing">Não informado</span>}</dd>
        </div>
        <div>
          <dt>Capital social</dt>
          <dd className="numeric">{company.capitalSocial !== null ? formatMoney(company.capitalSocial) : <span className="is-missing">Não informado</span>}</dd>
        </div>
        <div>
          <dt>Abertura</dt>
          <dd>{company.openedAt ? formatDate(company.openedAt) : <span className="is-missing">Não informada</span>}</dd>
        </div>
      </dl>

      {location ? (
        <p className={`map-precision-note${approximate ? " is-approximate" : ""}`}>
          <span className="map-legend-swatch" data-variant={approximate ? "approximate" : "precise"} aria-hidden="true" />
          {approximate
            ? `Localização aproximada (${PRECISION_LABELS[location.precision].toLowerCase()}). O ponto não indica o endereço exato.`
            : PRECISION_LABELS[location.precision]}
        </p>
      ) : (
        <p className="map-precision-note">Sem localização suficiente para exibir no mapa.</p>
      )}

      {saveError ? (
        <p className="field-error" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="map-company-actions">
        <Link
          href={`/dashboard/companies/${encodeURIComponent(company.cnpj)}?from=mapa&search=${encodeURIComponent(searchId)}`}
          className="button"
        >
          Ver empresa
        </Link>
        <button
          type="button"
          className={saved ? "button-danger" : "button-secondary"}
          onClick={toggleSaved}
          aria-busy={pending || undefined}
          disabled={pending}
        >
          {saved ? "Remover da carteira" : "Salvar na carteira"}
        </button>
      </div>
    </section>
  );
}

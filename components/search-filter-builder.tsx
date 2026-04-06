"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatCnaeCode, normalizeCnaeCode } from "@/lib/cnae-utils";
import { type PickerOption } from "@/lib/filter-options";
import { CnaeAssistantChat } from "@/components/cnae-assistant-chat";

type CityOption = {
  cityName: string;
  stateCode: string;
  value: string;
  label: string;
};

type SearchFilterBuilderProps = {
  defaultCnaes?: string[];
  defaultStateCodes?: string[];
  defaultCitySelections?: Array<{ cityName: string; stateCode: string }>;
  defaultStateWide?: boolean;
  defaultRequireEmail?: boolean;
  defaultRequireAddress?: boolean;
  defaultRequirePhone?: boolean;
  defaultMobileOnly?: boolean;
  defaultCompanySizes?: string[];
  defaultSimplesOnly?: boolean;
  defaultCapitalSocialMin?: string;
  defaultCapitalSocialMax?: string;
  defaultActivityStartYear?: string;
};

function normalizeText(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeCode(value: string) {
  return normalizeCnaeCode(value);
}

function fallbackCnaeOption(value: string, label?: string): PickerOption {
  const code = normalizeCode(value);
  return {
    value: code,
    label: label || `${formatCnaeCode(code)} · CNAE selecionado`
  };
}

function fallbackStateOption(value: string) {
  const stateCode = value.trim().toUpperCase();
  return {
    value: stateCode,
    label: `${stateCode} · Estado selecionado`
  };
}

function uniqueByValue<T extends { value: string }>(items: T[]) {
  const unique = new Map<string, T>();
  for (const item of items) {
    if (!item.value || unique.has(item.value)) continue;
    unique.set(item.value, item);
  }
  return Array.from(unique.values());
}

function splitMultiValue(value: string) {
  return value
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildDefaultCnaeOptions(values: string[]) {
  return uniqueByValue(values.map((item) => normalizeCode(item)).filter(Boolean).map((item) => fallbackCnaeOption(item)));
}

function buildDefaultStateOptions(values: string[]) {
  return uniqueByValue(values.map((item) => item.trim().toUpperCase()).filter(Boolean).map((item) => fallbackStateOption(item)));
}

function buildDefaultCityOptions(values: Array<{ cityName: string; stateCode: string }>) {
  return uniqueByValue(
    values
      .map((item) => ({
        cityName: item.cityName.trim(),
        stateCode: item.stateCode.trim().toUpperCase()
      }))
      .filter((item) => item.cityName && item.stateCode)
      .map((item) => ({
        ...item,
        value: `${normalizeText(item.cityName)}|${item.stateCode}`,
        label: `${item.cityName} / ${item.stateCode}`
      }))
  );
}

const COMPANY_SIZE_OPTIONS = [
  "Micro Empresa",
  "Empresa de Pequeno Porte",
  "Demais",
  "Médio Porte",
  "Grande Porte"
];

function splitOptionLabel(label: string) {
  const [primary, ...rest] = label.split(" · ");
  return {
    primary: primary?.trim() || label,
    secondary: rest.join(" · ").trim()
  };
}

function PickerField({
  id,
  label,
  placeholder,
  query,
  setQuery,
  suggestions,
  onAdd,
  selected,
  onRemove,
  disabled,
  emptyMessage,
  loading,
  extraAction,
  helper,
  keepOpenOnSelect = true,
  showDetailPreview = false,
  detailPreviewLabel = "Descrição em destaque"
}: {
  id: string;
  label: string;
  placeholder: string;
  query: string;
  setQuery: (value: string) => void;
  suggestions: PickerOption[];
  onAdd: (item: PickerOption) => void;
  selected: PickerOption[];
  onRemove: (value: string) => void;
  disabled?: boolean;
  emptyMessage: string;
  loading?: boolean;
  extraAction?: ReactNode;
  helper?: string;
  keepOpenOnSelect?: boolean;
  showDetailPreview?: boolean;
  detailPreviewLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeOptionValue, setActiveOptionValue] = useState("");
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const activeOption = useMemo(() => {
    if (suggestions.length === 0) return null;
    return suggestions.find((item) => item.value === activeOptionValue) ?? suggestions[0];
  }, [activeOptionValue, suggestions]);

  useEffect(() => {
    if (!open) return;
    if (suggestions.length === 0) {
      setActiveOptionValue("");
      return;
    }

    setActiveOptionValue((current) => {
      if (!current) return suggestions[0]?.value ?? "";
      return suggestions.some((item) => item.value === current) ? current : suggestions[0]?.value ?? "";
    });
  }, [open, suggestions]);

  useEffect(() => {
    if (!open || disabled) return;

    const updatePopoverPosition = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const maxWidth = Math.max(viewportWidth - 24, 280);
      const desiredWidth = Math.min(rect.width, maxWidth);
      const left = Math.min(Math.max(rect.left, 12), viewportWidth - desiredWidth - 12);

      setPopoverStyle({
        top: rect.bottom + 8,
        left,
        width: desiredWidth
      });
    };

    updatePopoverPosition();
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open, disabled, query, suggestions.length, loading]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleOpen() {
    if (!disabled) {
      setOpen(true);
    }
  }

  function addOption(option: PickerOption) {
    onAdd(option);
    setQuery("");
    if (keepOpenOnSelect) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        setOpen(true);
      });
    } else {
      setOpen(false);
    }
  }

  const popover = open && !disabled ? createPortal(
    <div
      ref={popoverRef}
      className={`picker-popover picker-popover-portal${showDetailPreview ? " picker-popover-detailed" : ""}`}
      style={popoverStyle}
    >
      {loading ? (
        <div className="picker-empty">Carregando opções...</div>
      ) : suggestions.length > 0 ? (
        <>
          <div className="picker-list" role="listbox" aria-label={`Sugestões para ${label}`}>
            {suggestions.map((option) => {
              const optionParts = splitOptionLabel(option.label);
              const isActive = activeOption?.value === option.value;

              return (
                <button
                  type="button"
                  key={option.value}
                  className={`picker-option${isActive ? " is-active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveOptionValue(option.value)}
                  onFocus={() => setActiveOptionValue(option.value)}
                  onClick={() => addOption(option)}
                >
                  {optionParts.secondary ? <span className="picker-option-code">{optionParts.primary}</span> : null}
                  <span className="picker-option-label">{optionParts.secondary || optionParts.primary}</span>
                </button>
              );
            })}
          </div>

          {showDetailPreview && activeOption ? (
            <div className="picker-preview" aria-live="polite">
              <span className="picker-preview-caption">{detailPreviewLabel}</span>
              <strong>{splitOptionLabel(activeOption.label).primary}</strong>
              <p>{splitOptionLabel(activeOption.label).secondary || splitOptionLabel(activeOption.label).primary}</p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="picker-empty">{emptyMessage}</div>
      )}
      {extraAction}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={wrapperRef} className={`field picker-column${open ? " is-open" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="picker-field">
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="input input-premium"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={handleOpen}
          onClick={handleOpen}
          disabled={disabled}
          autoComplete="off"
        />
        {popover}
      </div>
      {helper ? <span className="picker-helper">{helper}</span> : null}
      {selected.length > 0 ? (
        <div className="chip-list">
          {selected.map((item) => (
            <span className="chip" key={item.value}>
              <span>{item.label}</span>
              <button type="button" onClick={() => onRemove(item.value)} aria-label={`Remover ${item.label}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <span className="tiny">Nenhum item selecionado.</span>
      )}
    </div>
  );
}

export function SearchFilterBuilder({

  defaultCnaes = [],
  defaultStateCodes = [],
  defaultCitySelections = [],
  defaultStateWide = false,
  defaultRequireEmail = false,
  defaultRequireAddress = false,
  defaultRequirePhone = false,
  defaultMobileOnly = false,
  defaultCompanySizes = [],
  defaultSimplesOnly = false,
  defaultCapitalSocialMin = "",
  defaultCapitalSocialMax = "",
  defaultActivityStartYear = ""
}: SearchFilterBuilderProps) {
  const [selectedCnaes, setSelectedCnaes] = useState<PickerOption[]>(() => buildDefaultCnaeOptions(defaultCnaes));
  const [selectedStates, setSelectedStates] = useState<PickerOption[]>(() => buildDefaultStateOptions(defaultStateCodes));
  const [selectedCities, setSelectedCities] = useState<CityOption[]>(() => buildDefaultCityOptions(defaultCitySelections));
  const [cnaeQuery, setCnaeQuery] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [cnaeOptions, setCnaeOptions] = useState<PickerOption[]>([]);
  const [stateOptions, setStateOptions] = useState<PickerOption[]>([]);
  const [cityOptions, setCityOptions] = useState<CityOption[]>([]);
  const [cnaesLoading, setCnaesLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [stateWide, setStateWide] = useState(defaultStateWide);
  const [requireEmail, setRequireEmail] = useState(defaultRequireEmail);
  const [requireAddress, setRequireAddress] = useState(defaultRequireAddress);
  const [requirePhone, setRequirePhone] = useState(defaultRequirePhone || defaultMobileOnly);
  const [mobileOnly, setMobileOnly] = useState(defaultMobileOnly);
  const [selectedCompanySizes, setSelectedCompanySizes] = useState<string[]>(() => Array.from(new Set(defaultCompanySizes.filter(Boolean))));
  const [simplesOnly, setSimplesOnly] = useState(defaultSimplesOnly);
  const [capitalSocialMin, setCapitalSocialMin] = useState(defaultCapitalSocialMin);
  const [capitalSocialMax, setCapitalSocialMax] = useState(defaultCapitalSocialMax);
  const [activityStartYear, setActivityStartYear] = useState(defaultActivityStartYear);

  const filteredCnaes = useMemo(() => {
    const selectedValues = new Set(selectedCnaes.map((item) => item.value));
    return cnaeOptions.filter((item) => !selectedValues.has(item.value));
  }, [cnaeOptions, selectedCnaes]);

  const filteredStates = useMemo(() => {
    const selectedValues = new Set(selectedStates.map((item) => item.value));
    return stateOptions.filter((item) => !selectedValues.has(item.value));
  }, [selectedStates, stateOptions]);

  useEffect(() => {
    if (mobileOnly && !requirePhone) {
      setRequirePhone(true);
    }
  }, [mobileOnly, requirePhone]);

  useEffect(() => {
    const unresolved = selectedStates
      .filter((item) => item.label.endsWith(" · Estado selecionado"))
      .map((item) => item.value);
    if (unresolved.length === 0) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      ids: unresolved.join(","),
      limit: String(Math.max(unresolved.length, 1))
    });

    fetch(`/api/options/states?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar estados selecionados.");
        return response.json() as Promise<{ items?: PickerOption[] }>;
      })
      .then((payload) => {
        const byValue = new Map((Array.isArray(payload.items) ? payload.items : []).map((item) => [item.value, item]));
        setSelectedStates((current) => current.map((item) => byValue.get(item.value) ?? item));
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error(error);
      });

    return () => controller.abort();
  }, [selectedStates]);

  useEffect(() => {
    const unresolved = selectedCnaes
      .filter((item) => item.label.endsWith(" · CNAE selecionado"))
      .map((item) => item.value);
    if (unresolved.length === 0) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      ids: unresolved.join(","),
      limit: String(Math.max(unresolved.length, 1))
    });

    fetch(`/api/options/cnaes?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar CNAEs selecionados.");
        return response.json() as Promise<{ items?: PickerOption[] }>;
      })
      .then((payload) => {
        const byValue = new Map((Array.isArray(payload.items) ? payload.items : []).map((item) => [item.value, item]));
        setSelectedCnaes((current) => current.map((item) => byValue.get(item.value) ?? item));
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error(error);
      });

    return () => controller.abort();
  }, [selectedCnaes]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: cnaeQuery.trim(),
      limit: cnaeQuery.trim() ? "40" : "30"
    });

    setCnaesLoading(true);

    fetch(`/api/options/cnaes?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar catálogo de CNAEs.");
        return response.json() as Promise<{ items?: PickerOption[] }>;
      })
      .then((payload) => setCnaeOptions(Array.isArray(payload.items) ? payload.items : []))
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setCnaeOptions([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCnaesLoading(false);
      });

    return () => controller.abort();
  }, [cnaeQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      q: stateQuery.trim(),
      limit: "27"
    });

    setStatesLoading(true);

    fetch(`/api/options/states?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar estados.");
        return response.json() as Promise<{ items?: PickerOption[] }>;
      })
      .then((payload) => setStateOptions(Array.isArray(payload.items) ? payload.items : []))
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setStateOptions([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatesLoading(false);
      });

    return () => controller.abort();
  }, [stateQuery]);

  useEffect(() => {
    const allowedStates = new Set(selectedStates.map((item) => item.value));
    setSelectedCities((current) => current.filter((item) => allowedStates.has(item.stateCode)));
  }, [selectedStates]);

  useEffect(() => {
    if (stateWide) {
      setSelectedCities([]);
      setCityQuery("");
      setCityOptions([]);
      return;
    }

    const stateCodes = selectedStates.map((item) => item.value);
    if (stateCodes.length === 0) {
      setSelectedCities([]);
      setCityOptions([]);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      states: stateCodes.join(","),
      q: cityQuery.trim(),
      limit: cityQuery.trim() ? "40" : "20"
    });

    setCitiesLoading(true);

    fetch(`/api/options/cities?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar cidades.");
        return response.json() as Promise<{ items?: CityOption[] }>;
      })
      .then((payload) => setCityOptions(Array.isArray(payload.items) ? payload.items : []))
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setCityOptions([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCitiesLoading(false);
      });

    return () => controller.abort();
  }, [cityQuery, selectedStates, stateWide]);

  function addCnae(option: PickerOption) {
    setSelectedCnaes((current) => uniqueByValue([...current, option]));
  }

  function addManualCnae() {
    const digits = normalizeCode(cnaeQuery);
    if (!digits) return;
    addCnae(fallbackCnaeOption(digits));
    setCnaeQuery("");
  }

  function addState(option: PickerOption) {
    setSelectedStates((current) => uniqueByValue([...current, option]));
  }

  function addCity(option: PickerOption) {
    setSelectedCities((current) => uniqueByValue([...current, option as CityOption]));
  }

  function addSuggestionFromChat(suggestion: { code: string; label: string }) {
    const normalizedCode = normalizeCode(suggestion.code);
    if (!normalizedCode) return;
    addCnae(fallbackCnaeOption(normalizedCode, suggestion.label));
  }

  const normalizedCnaeQuery = normalizeCode(cnaeQuery);
  const canAddManualCnae =
    normalizedCnaeQuery.length > 0 &&
    !selectedCnaes.some((item) => item.value === normalizedCnaeQuery) &&
    !filteredCnaes.some((item) => item.value === normalizedCnaeQuery);

  const citySelectionsValue = JSON.stringify(
    selectedCities.map((item) => ({
      cityName: item.cityName,
      stateCode: item.stateCode
    }))
  );

  const cnaeValue = selectedCnaes.map((item) => item.value).join("\n");
  const stateValue = selectedStates.map((item) => item.value).join("\n");
  const companySizesValue = selectedCompanySizes.join("\n");
  const importedCnaes = splitMultiValue(cnaeQuery).map((item) => normalizeCode(item)).filter(Boolean);

  return (
    <div className="search-builder-stack search-builder-stack-premium">
      <div className="search-builder-headline">
        <div className="search-builder-headline-copy">
          <span className="eyebrow">Pesquisa imersiva</span>
          <strong>Combine múltiplos CNAEs, estados e cidades em uma mesma operação.</strong>
          <span className="muted">
            Cada bloco aceita múltiplas seleções e foi desenhado para manter leitura clara mesmo com vários filtros ao mesmo tempo.
          </span>
        </div>

        <div className="search-selection-stats">
          <div className="selection-stat-pill">
            <span>CNAEs</span>
            <strong>{selectedCnaes.length}</strong>
          </div>
          <div className="selection-stat-pill">
            <span>Estados</span>
            <strong>{selectedStates.length}</strong>
          </div>
          <div className="selection-stat-pill">
            <span>Cidades</span>
            <strong>{selectedCities.length}</strong>
          </div>
        </div>
      </div>

      <CnaeAssistantChat
        selectedCodes={selectedCnaes.map((item) => item.value)}
        onAddSuggestion={addSuggestionFromChat}
      />

      <input type="hidden" name="cnae" value={cnaeValue} />
      <input type="hidden" name="stateCode" value={stateValue} />
      <input type="hidden" name="citySelection" value={citySelectionsValue} />
      <input type="hidden" name="companySizes" value={companySizesValue} />

      <div className="search-builder-grid search-builder-grid-immersive">
        <PickerField
          id="cnaePicker"
          label="CNAE"
          showDetailPreview
          detailPreviewLabel="Descrição do CNAE selecionado"
          helper="Clique no campo para abrir a lista. Ao passar o mouse sobre um item, a descrição completa aparece logo abaixo para facilitar a leitura."
          placeholder="Digite o código ou a descrição"
          query={cnaeQuery}
          setQuery={setCnaeQuery}
          suggestions={filteredCnaes}
          loading={cnaesLoading}
          onAdd={addCnae}
          selected={selectedCnaes}
          onRemove={(value) => setSelectedCnaes((current) => current.filter((item) => item.value !== value))}
          emptyMessage="Nenhum CNAE encontrado."
          extraAction={
            canAddManualCnae || importedCnaes.length > 1 ? (
              <div className="picker-footer">
                {importedCnaes.length > 1 ? (
                  <button
                    type="button"
                    className="button-secondary picker-footer-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const options = importedCnaes.map((item) => fallbackCnaeOption(item));
                      setSelectedCnaes((current) => uniqueByValue([...current, ...options]));
                      setCnaeQuery("");
                    }}
                  >
                    Adicionar todos os CNAEs digitados
                  </button>
                ) : null}
                {canAddManualCnae ? (
                  <button
                    type="button"
                    className="button-secondary picker-footer-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={addManualCnae}
                  >
                    Adicionar {formatCnaeCode(normalizedCnaeQuery)} manualmente
                  </button>
                ) : null}
              </div>
            ) : null
          }
        />

        <PickerField
          id="statePicker"
          label="Estado"
          helper="Escolha uma ou várias UFs para expandir o recorte territorial."
          placeholder="Digite a UF ou o nome do estado"
          query={stateQuery}
          setQuery={setStateQuery}
          suggestions={filteredStates}
          loading={statesLoading}
          onAdd={addState}
          selected={selectedStates}
          onRemove={(value) => setSelectedStates((current) => current.filter((item) => item.value !== value))}
          emptyMessage="Nenhum estado encontrado."
        />

        <PickerField
          id="cityPicker"
          label="Cidade"
          helper="Inclua múltiplas cidades dentro dos estados escolhidos ou use a busca estadual."
          placeholder={selectedStates.length > 0 ? "Digite o nome da cidade" : "Selecione primeiro ao menos um estado"}
          query={cityQuery}
          setQuery={setCityQuery}
          suggestions={cityOptions}
          onAdd={addCity}
          selected={selectedCities}
          onRemove={(value) => setSelectedCities((current) => current.filter((item) => item.value !== value))}
          disabled={stateWide || selectedStates.length === 0}
          emptyMessage={
            selectedStates.length === 0
              ? "Escolha um estado antes de selecionar cidades."
              : "Nenhuma cidade encontrada para os estados selecionados."
          }
          loading={citiesLoading}
        />
      </div>

      <div className="search-builder-footer">
        <label className="filter-switch filter-switch-premium">
          <input
            type="checkbox"
            name="stateWide"
            value="on"
            checked={stateWide}
            onChange={(event) => setStateWide(event.target.checked)}
          />
          <span>Pesquisar o estado inteiro quando não quiser filtrar por cidade</span>
        </label>

        <div className="field" style={{ marginTop: 0 }}>
          <label>Filtros avançados</label>
          <div className="checkbox-grid compact">
            <label className="filter-check filter-check-premium">
              <input type="checkbox" name="requireEmail" checked={requireEmail} onChange={(event) => setRequireEmail(event.target.checked)} />
              <span>Com e-mail</span>
            </label>
            <label className="filter-check filter-check-premium">
              <input type="checkbox" name="requireAddress" checked={requireAddress} onChange={(event) => setRequireAddress(event.target.checked)} />
              <span>Com endereço</span>
            </label>
            <label className="filter-check filter-check-premium">
              <input type="checkbox" name="requirePhone" checked={requirePhone} onChange={(event) => setRequirePhone(event.target.checked)} />
              <span>Com telefone</span>
            </label>
            <label className="filter-check filter-check-premium">
              <input type="checkbox" name="mobileOnly" checked={mobileOnly} onChange={(event) => setMobileOnly(event.target.checked)} />
              <span>Apenas celular</span>
            </label>
            <label className="filter-check filter-check-premium">
              <input type="checkbox" name="simplesOnly" checked={simplesOnly} onChange={(event) => setSimplesOnly(event.target.checked)} />
              <span>Simples Nacional</span>
            </label>
          </div>

          <div className="grid-2" style={{ marginTop: 14, alignItems: "end", gridTemplateColumns: "minmax(0, max-content) minmax(0, 1fr)", gap: 12 }}>
            <div className="field" style={{ marginTop: 0, width: "fit-content" }}>
              <label htmlFor="activityStartYear">Ano mínimo de início da atividade</label>
              <input
                id="activityStartYear"
                name="activityStartYear"
                type="number"
                inputMode="numeric"
                className="input input-premium"
                placeholder="2024"
                min="1900"
                max={new Date().getFullYear()}
                value={activityStartYear}
                onChange={(event) => setActivityStartYear(event.target.value)}
                style={{ width: "9ch", minWidth: 0 }}
              />
            </div>
            <span className="tiny" style={{ alignSelf: "center" }}>
              Informe um ano mínimo. Ex.: 2024 busca empresas de 2024 em diante.
            </span>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label>Porte da empresa</label>
            <div className="checkbox-grid compact">
              {COMPANY_SIZE_OPTIONS.map((option) => {
                const checked = selectedCompanySizes.includes(option);
                return (
                  <label key={option} className="filter-check filter-check-premium">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedCompanySizes((current) =>
                          event.target.checked ? Array.from(new Set([...current, option])) : current.filter((item) => item !== option)
                        );
                      }}
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 14 }}>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="capitalSocialMin">Capital social mínimo</label>
              <input
                id="capitalSocialMin"
                name="capitalSocialMin"
                type="text"
                inputMode="decimal"
                className="input input-premium"
                placeholder="Ex.: 50000"
                value={capitalSocialMin}
                onChange={(event) => setCapitalSocialMin(event.target.value)}
              />
            </div>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="capitalSocialMax">Capital social máximo</label>
              <input
                id="capitalSocialMax"
                name="capitalSocialMax"
                type="text"
                inputMode="decimal"
                className="input input-premium"
                placeholder="Ex.: 500000"
                value={capitalSocialMax}
                onChange={(event) => setCapitalSocialMax(event.target.value)}
              />
            </div>
          </div>

          <span className="tiny">
            {stateWide
              ? "Com busca estadual ativa, as cidades são ignoradas e a consulta roda em todos os municípios dos estados escolhidos."
              : "Use o assistente para encontrar CNAEs relacionados à atividade da empresa ou escolha manualmente pela lista. Se não informar ano mínimo, a pesquisa considera empresas de todos os anos."}
          </span>
        </div>
      </div>
    </div>
  );
}

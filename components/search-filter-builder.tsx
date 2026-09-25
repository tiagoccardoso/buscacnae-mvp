"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatCnaeCode, normalizeCnaeCode } from "@/lib/cnae-utils";
import { type PickerOption } from "@/lib/filter-options";
import { CnaeAssistantChat } from "@/components/cnae-assistant-chat";
import { SearchIcon, SparkleIcon } from "@/components/ui/icons";

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
  defaultActivityStartYear?: string;
  defaultActivityStartYearExact?: boolean;
};

/** Evita uma requisição por tecla nos combos de CNAE e cidade (a anterior já é abortada). */
const QUERY_DEBOUNCE_MS = 220;

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

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
  const listboxId = useId();
  const helperId = useId();
  const optionIdPrefix = useId();

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

  function moveActive(step: number) {
    if (suggestions.length === 0) return;
    const currentIndex = activeOption ? suggestions.findIndex((item) => item.value === activeOption.value) : -1;
    const nextIndex = (currentIndex + step + suggestions.length) % suggestions.length;
    const nextValue = suggestions[nextIndex]?.value ?? "";
    setActiveOptionValue(nextValue);
    requestAnimationFrame(() => {
      document.getElementById(`${optionIdPrefix}-${nextIndex}`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        handleOpen();
        return;
      }
      moveActive(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open) moveActive(-1);
      return;
    }

    if (event.key === "Enter" && open && !loading && activeOption) {
      event.preventDefault();
      addOption(activeOption);
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "Backspace" && !query && selected.length > 0) {
      onRemove(selected[selected.length - 1].value);
    }
  }

  const activeIndex = activeOption ? suggestions.findIndex((item) => item.value === activeOption.value) : -1;

  const popover = open && !disabled ? createPortal(
    <div
      ref={popoverRef}
      className={`picker-popover picker-popover-portal glass-thick${showDetailPreview ? " picker-popover-detailed" : ""}`}
      style={popoverStyle}
    >
      {loading ? (
        <div className="picker-empty" role="status">
          <span className="spinner" aria-hidden="true" /> <span className="sr-only">Carregando opções...</span>
        </div>
      ) : suggestions.length > 0 ? (
        <>
          <div className="picker-list" role="listbox" id={listboxId} aria-label={`Sugestões para ${label}`}>
            {suggestions.map((option, index) => {
              const optionParts = splitOptionLabel(option.label);
              const isActive = activeOption?.value === option.value;

              return (
                <button
                  type="button"
                  key={option.value}
                  id={`${optionIdPrefix}-${index}`}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
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
        <div className="picker-empty" role="status">{emptyMessage}</div>
      )}
      {extraAction}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={wrapperRef} className={`field picker-column${open ? " is-open" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="picker-field">
        <SearchIcon className="picker-search-icon" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="input"
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={handleOpen}
          onClick={handleOpen}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && !disabled}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined}
          aria-describedby={helper ? helperId : undefined}
        />
        {popover}
      </div>
      {helper ? <span id={helperId} className="field-help">{helper}</span> : null}
      {selected.length > 0 ? (
        <div className="chip-list" aria-label={`${label}: itens selecionados`}>
          {selected.map((item) => (
            <span className="chip" key={item.value}>
              <span title={item.label}>{item.label}</span>
              <button type="button" onClick={() => onRemove(item.value)} aria-label={`Remover ${item.label}`}>
                <span aria-hidden="true">×</span>
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SearchFilterBuilder({

  defaultCnaes = [],
  defaultStateCodes = [],
  defaultCitySelections = [],
  defaultStateWide: _defaultStateWide = false,
  defaultActivityStartYear = "",
  defaultActivityStartYearExact = false
}: SearchFilterBuilderProps) {
  const [selectedCnaes, setSelectedCnaes] = useState<PickerOption[]>(() => buildDefaultCnaeOptions(defaultCnaes));
  const [selectedStates, setSelectedStates] = useState<PickerOption[]>(() => buildDefaultStateOptions(defaultStateCodes));
  const [selectedCities, setSelectedCities] = useState<CityOption[]>(() => buildDefaultCityOptions(defaultCitySelections));
  const [cnaeQuery, setCnaeQuery] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const debouncedCnaeQuery = useDebouncedValue(cnaeQuery, QUERY_DEBOUNCE_MS);
  const debouncedCityQuery = useDebouncedValue(cityQuery, QUERY_DEBOUNCE_MS);
  const [cnaeOptions, setCnaeOptions] = useState<PickerOption[]>([]);
  const [stateOptions, setStateOptions] = useState<PickerOption[]>([]);
  const [cityOptions, setCityOptions] = useState<CityOption[]>([]);
  const [cnaesLoading, setCnaesLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const stateWide = false;
  const [activityStartYear, setActivityStartYear] = useState(defaultActivityStartYear);
  const [activityStartYearExact, setActivityStartYearExact] = useState(defaultActivityStartYearExact);

  const filteredCnaes = useMemo(() => {
    const selectedValues = new Set(selectedCnaes.map((item) => item.value));
    return cnaeOptions.filter((item) => !selectedValues.has(item.value));
  }, [cnaeOptions, selectedCnaes]);

  const filteredStates = useMemo(() => {
    const selectedValues = new Set(selectedStates.map((item) => item.value));
    return stateOptions.filter((item) => !selectedValues.has(item.value));
  }, [selectedStates, stateOptions]);

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
      q: debouncedCnaeQuery.trim(),
      limit: debouncedCnaeQuery.trim() ? "40" : "30"
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
  }, [debouncedCnaeQuery]);

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
      q: debouncedCityQuery.trim(),
      limit: debouncedCityQuery.trim() ? "40" : "20"
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
  }, [debouncedCityQuery, selectedStates, stateWide]);

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
  const importedCnaes = splitMultiValue(cnaeQuery).map((item) => normalizeCode(item)).filter(Boolean);

  const selectionSummary = [
    `${selectedCnaes.length} ${selectedCnaes.length === 1 ? "CNAE" : "CNAEs"}`,
    `${selectedStates.length} ${selectedStates.length === 1 ? "estado" : "estados"}`,
    `${selectedCities.length} ${selectedCities.length === 1 ? "cidade" : "cidades"}`
  ].join(" · ");

  return (
    <div className="search-builder">
      <input type="hidden" name="cnae" value={cnaeValue} />
      <input type="hidden" name="stateCode" value={stateValue} />
      <input type="hidden" name="citySelection" value={citySelectionsValue} />

      <div className="search-fields">
        <PickerField
          id="cnaePicker"
          label="CNAE"
          showDetailPreview
          detailPreviewLabel="Descrição do CNAE selecionado"
          helper="Busque por código ou descrição. Aceita vários CNAEs."
          placeholder="Código ou descrição da atividade"
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
                    className="button-secondary button-sm"
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
                    className="button-secondary button-sm"
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
          helper="Uma ou várias UFs."
          placeholder="UF ou nome do estado"
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
          helper={selectedStates.length > 0 ? "Cidades dentro dos estados escolhidos." : "Escolha um estado para liberar as cidades."}
          placeholder={selectedStates.length > 0 ? "Nome da cidade" : "Selecione um estado antes"}
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

      <details className="assistant">
        <summary>
          <span className="assistant-badge" aria-hidden="true">
            <SparkleIcon />
          </span>
          <span className="assistant-summary-copy">
            <strong>Não sabe qual CNAE usar?</strong>
            <span>Descreva o negócio e o assistente sugere CNAEs para adicionar com um clique.</span>
          </span>
        </summary>
        <div className="assistant-body">
          <CnaeAssistantChat
            selectedCodes={selectedCnaes.map((item) => item.value)}
            onAddSuggestion={addSuggestionFromChat}
          />
        </div>
      </details>

      <div className="search-options">
        <div className="field">
          <label htmlFor="activityStartYear">Ano mínimo da empresa ativa</label>
          <input
            id="activityStartYear"
            name="activityStartYear"
            type="number"
            inputMode="numeric"
            className="input"
            placeholder="Todos os anos"
            min="1900"
            max={new Date().getFullYear()}
            value={activityStartYear}
            onChange={(event) => setActivityStartYear(event.target.value)}
            aria-describedby="activityStartYearHelp"
          />
        </div>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            name="activityStartYearExact"
            checked={activityStartYearExact}
            onChange={(event) => setActivityStartYearExact(event.target.checked)}
            disabled={!activityStartYear}
          />
          Buscar somente no ano informado
        </label>
        <p id="activityStartYearHelp" className="field-help">
          {!activityStartYear
            ? "Sem ano informado, a pesquisa considera empresas de todos os períodos."
            : activityStartYearExact
              ? "A pesquisa considera apenas empresas ativas no ano informado."
              : "A pesquisa considera empresas ativas a partir do ano informado."}
        </p>
      </div>

      <p className="search-summary" aria-live="polite">
        Seleção atual: <strong>{selectionSummary}</strong>
      </p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { type PickerOption } from "@/lib/filter-options";

type CityOption = {
  cityName: string;
  stateCode: string;
  value: string;
  label: string;
};

type DashboardSearchFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

function splitOptionLabel(label: string) {
  const [primary, ...rest] = label.split(" · ");
  return {
    primary: primary?.trim() || label,
    secondary: rest.join(" · ").trim()
  };
}

function SinglePickerField({
  id,
  label,
  placeholder,
  query,
  setQuery,
  suggestions,
  onSelect,
  onInputChange,
  disabled,
  emptyMessage,
  helper,
  loading,
  showCodePill = true
}: {
  id: string;
  label: string;
  placeholder: string;
  query: string;
  setQuery: (value: string) => void;
  suggestions: PickerOption[];
  onSelect: (item: PickerOption) => void;
  onInputChange: (value: string) => void;
  disabled?: boolean;
  emptyMessage: string;
  helper?: string;
  loading?: boolean;
  showCodePill?: boolean;
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

  const popover = open && !disabled ? createPortal(
    <div
      ref={popoverRef}
      className="picker-popover picker-popover-detailed picker-popover-portal"
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
                  onClick={() => {
                    onSelect(option);
                    setQuery(option.label);
                    setOpen(false);
                  }}
                >
                  {showCodePill && optionParts.secondary ? <span className="picker-option-code">{optionParts.primary}</span> : null}
                  <span className="picker-option-label">{optionParts.secondary || optionParts.primary}</span>
                </button>
              );
            })}
          </div>

          {activeOption ? (
            <div className="picker-preview" aria-live="polite">
              <span className="picker-preview-caption">Item em destaque</span>
              <strong>{splitOptionLabel(activeOption.label).primary}</strong>
              <p>{splitOptionLabel(activeOption.label).secondary || splitOptionLabel(activeOption.label).primary}</p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="picker-empty">{emptyMessage}</div>
      )}
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
          onChange={(event) => {
            const nextValue = event.target.value;
            setQuery(nextValue);
            onInputChange(nextValue);
          }}
          onFocus={handleOpen}
          onClick={handleOpen}
          disabled={disabled}
          autoComplete="off"
        />
        {popover}
      </div>
      {helper ? <span className="picker-helper">{helper}</span> : null}
    </div>
  );
}

export function DashboardSearchForm({ action }: DashboardSearchFormProps) {
  const [cnaeQuery, setCnaeQuery] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [selectedCnae, setSelectedCnae] = useState<PickerOption | null>(null);
  const [selectedState, setSelectedState] = useState<PickerOption | null>(null);
  const [selectedCity, setSelectedCity] = useState<CityOption | null>(null);
  const [cnaeOptions, setCnaeOptions] = useState<PickerOption[]>([]);
  const [stateOptions, setStateOptions] = useState<PickerOption[]>([]);
  const [cityOptions, setCityOptions] = useState<CityOption[]>([]);
  const [cnaesLoading, setCnaesLoading] = useState(false);
  const [statesLoading, setStatesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);

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
    if (!selectedState?.value) {
      setCityOptions([]);
      setSelectedCity(null);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      states: selectedState.value,
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
  }, [cityQuery, selectedState]);

  return (
    <form action={action} className="stack dashboard-search-picker-form">
      <input type="hidden" name="cnae" value={selectedCnae?.value ?? ""} />
      <input type="hidden" name="stateCode" value={selectedState?.value ?? ""} />
      <input type="hidden" name="cityName" value={selectedCity?.cityName ?? ""} />
      <input type="hidden" name="cityIbge" value="" />

      <div className="form-grid dashboard-form-grid dashboard-search-picker-grid">
        <SinglePickerField
          id="cnae"
          label="Subclasse CNAE"
          placeholder="Clique e pesquise pelo código ou descrição"
          query={cnaeQuery}
          setQuery={setCnaeQuery}
          suggestions={cnaeOptions}
          onSelect={(option) => setSelectedCnae(option)}
          onInputChange={() => setSelectedCnae(null)}
          loading={cnaesLoading}
          emptyMessage="Nenhum CNAE encontrado."
          helper="Clique no campo para abrir a lista e selecione um CNAE da busca assistida."
        />

        <SinglePickerField
          id="stateCode"
          label="UF"
          placeholder="Clique e selecione o estado"
          query={stateQuery}
          setQuery={setStateQuery}
          suggestions={stateOptions}
          onSelect={(option) => {
            setSelectedState(option);
            setSelectedCity(null);
            setCityQuery("");
          }}
          onInputChange={() => {
            setSelectedState(null);
            setSelectedCity(null);
            setCityQuery("");
          }}
          loading={statesLoading}
          emptyMessage="Nenhum estado encontrado."
          helper="Ao escolher a UF, a lista de cidades é carregada automaticamente."
        />

        <SinglePickerField
          id="cityName"
          label="Cidade"
          placeholder={selectedState ? "Clique e selecione a cidade" : "Selecione primeiro a UF"}
          query={cityQuery}
          setQuery={setCityQuery}
          suggestions={cityOptions}
          onSelect={(option) => setSelectedCity(option as CityOption)}
          onInputChange={() => setSelectedCity(null)}
          disabled={!selectedState}
          loading={citiesLoading}
          emptyMessage={selectedState ? "Nenhuma cidade encontrada para a UF selecionada." : "Selecione primeiro uma UF."}
          helper="A cidade só é exibida depois que a UF for definida."
          showCodePill={false}
        />

        <div className="field">
          <label htmlFor="cityIbgeHint">Código IBGE da cidade</label>
          <input id="cityIbgeHint" className="input input-premium" value={selectedCity ? "Preenchido automaticamente pela seleção da cidade" : "Opcional"} readOnly />
          <span className="picker-helper">Nesta tela a seleção da cidade é feita pela lista, então não é necessário digitar o código IBGE.</span>
        </div>
      </div>

      <div className="notice">
        Clique nos campos para abrir as listas. A busca usa o CNAE, a UF e a cidade escolhidos na seleção acima.
      </div>

      <button type="submit" className="button button-lg">
        Buscar estabelecimentos
      </button>
    </form>
  );
}

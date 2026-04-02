import { normalizeText } from "@/lib/utils";

type IbgeCity = {
  id: number;
  nome: string;
};

export async function resolveCityIbge({
  cityName,
  stateCode
}: {
  cityName: string;
  stateCode: string;
}) {
  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateCode.toUpperCase()}/municipios`,
    {
      headers: {
        Accept: "application/json"
      },
      next: {
        revalidate: 60 * 60 * 24 * 30
      }
    }
  );

  if (!response.ok) {
    throw new Error("Falha ao consultar municípios no IBGE.");
  }

  const cities = (await response.json()) as IbgeCity[];
  const normalizedTarget = normalizeText(cityName);

  const exact = cities.find((item) => normalizeText(item.nome) === normalizedTarget);
  if (exact) {
    return String(exact.id);
  }

  const partial = cities.find((item) => normalizeText(item.nome).includes(normalizedTarget));
  if (partial) {
    return String(partial.id);
  }

  throw new Error(`Não foi possível resolver o código IBGE para ${cityName}/${stateCode}.`);
}

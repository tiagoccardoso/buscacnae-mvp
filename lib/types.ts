export type DiscoveryProvider = "hybrid" | "cnpjws" | "casadosdados";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused"
  | "not_started";

export type DiscoverySearchInput = {
  profileId: string;
  cnae: string;
  cityName: string;
  stateCode: string;
  cityIbge?: string;
  requireEmail?: boolean;
  requireAddress?: boolean;
  requirePhone?: boolean;
  mobileOnly?: boolean;
};

export type DiscoverySearchOutput = {
  provider: DiscoveryProvider;
  raw: unknown;
  normalized: NormalizedEstablishment[];
};

export type NormalizedEstablishment = {
  cnpj: string;
  cnpjRoot?: string | null;
  companyName: string;
  tradeName?: string | null;
  registrationStatus?: string | null;
  openedAt?: string | null;
  primaryCnaeCode?: string | null;
  primaryCnaeDescription?: string | null;
  secondaryCnaes?: unknown;
  legalNatureCode?: string | null;
  legalNatureDescription?: string | null;
  companySize?: string | null;
  simplesOptIn?: boolean | null;
  meiOptIn?: boolean | null;
  capitalSocial?: number | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  stateCode?: string | null;
  cityName?: string | null;
  cityIbge?: string | null;
  neighborhood?: string | null;
  cep?: string | null;
  addressLine?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  providerPayload?: unknown;
};

export type ServiceResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

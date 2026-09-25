export type ProspectingStage = "new" | "researching" | "qualified" | "lead" | "discarded";

export type ProvenanceValue<T> = {
  value: T;
  source: string;
  collectedAt: string;
  confidence: number | null;
  dataClass: "company" | "personal" | "inferred";
};

export type ScoreCriteria = {
  targetStates: string[];
  targetCnaeCodes: string[];
  targetCompanySizes: string[];
  minYearsActive: number | null;
  weights: {
    activeStatus: number;
    companySize: number;
    location: number;
    cnae: number;
    tenure: number;
    digitalPresence: number;
  };
};

export type ScoreInput = {
  registrationStatus?: string | null;
  companySize?: string | null;
  stateCode?: string | null;
  primaryCnaeCode?: string | null;
  openedAt?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type ScoreBreakdownItem = {
  key: keyof ScoreCriteria["weights"];
  label: string;
  points: number;
  maxPoints: number;
  reason: string;
};

export type LeadScore = {
  score: number;
  breakdown: ScoreBreakdownItem[];
};

export type ResearchClaim = ProvenanceValue<string> & {
  key: string;
};

export type ResearchBrief = {
  summary: string;
  commercialProfile: ProvenanceValue<string>;
  claims: ResearchClaim[];
  limitations: string[];
};

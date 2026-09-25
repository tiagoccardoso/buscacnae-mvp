-- Mapa Empresarial: cache de coordenadas por CEP.
-- Opcional. Sem esta tabela o mapa funciona (fallback pela sede do município);
-- com ela, cada CEP geocodificado é consultado no máximo uma vez.
CREATE TABLE IF NOT EXISTS postal_code_locations (
  cep TEXT PRIMARY KEY CHECK (cep ~ '^[0-9]{8}$'),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  status TEXT NOT NULL CHECK (status IN ('found', 'not_found')),
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT postal_code_locations_coordinates CHECK (
    (status = 'found' AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
    OR (status = 'not_found')
  )
);

CREATE INDEX IF NOT EXISTS postal_code_locations_fetched_at_idx ON postal_code_locations (fetched_at);

-- Mapa Empresarial (Fase 2): cache de coordenadas POR EMPRESA.
-- Opcional. Guarda apenas coordenadas de ponto: "exact" (verificada) ou "address"
-- (geocodificação de endereço). Sem esta tabela o mapa usa CEP → município → UF.
CREATE TABLE IF NOT EXISTS establishment_locations (
  cnpj TEXT PRIMARY KEY CHECK (cnpj ~ '^[0-9A-Z]{14}$'),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  precision TEXT NOT NULL CHECK (precision IN ('exact', 'address')),
  source TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

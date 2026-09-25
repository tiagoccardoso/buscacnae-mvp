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

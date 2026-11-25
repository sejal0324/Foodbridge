-- Up Migration
-- Extensions are created idempotently so the same migration works on a fresh
-- Docker database and on managed PostgreSQL providers that pre-install PostGIS.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

-- Maintains updated_at on every UPDATE.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Makes ledgers and logs append-only.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

-- Down Migration
DROP FUNCTION IF EXISTS forbid_mutation();
DROP FUNCTION IF EXISTS set_updated_at();
-- Extensions are intentionally left installed: other objects (e.g. the PostGIS
-- image's tiger geocoder) may depend on them.

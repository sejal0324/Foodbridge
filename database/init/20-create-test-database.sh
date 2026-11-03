#!/bin/sh
# Runs once, when the Docker volume is first initialised.
# Creates the separate database used by automated tests so that tests never
# touch development data. Schema is created by migrations, not here.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE DATABASE "${POSTGRES_TEST_DB}" OWNER "${POSTGRES_USER}";
EOSQL

#!/bin/sh
# Applies pending migrations (forward-only) when RUN_MIGRATIONS=true, then starts the API.
set -e
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  node dist/db/migrate.js up
fi
exec node dist/server.js

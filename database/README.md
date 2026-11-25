# Database

PostgreSQL 18 with PostGIS 3.6 (Docker image `postgis/postgis:18-3.6`).

| Path | Contents |
|---|---|
| `docker-compose.yml` | Local database service, included by the root `docker-compose.yml`. Bound to `127.0.0.1:5433` |
| `init/20-create-test-database.sh` | Creates the separate `foodbridge_test` database on first start |
| `migrations/` | Plain-SQL migrations (`-- Up Migration` / `-- Down Migration`), run by `node-pg-migrate` from the backend. **Authoritative schema** |
| `seeds/demo-data.json` | Development-only demo organisations used by `npm run db:seed` (refused in production) |
| `schema/schema.sql` | Generated `pg_dump --schema-only` snapshot for reference |

## Commands (from the repository root)

```bash
npm run db:up        # start PostgreSQL + PostGIS and wait until healthy
npm run db:migrate   # apply pending migrations
npm run db:seed      # load demo data into an empty database (development only)
npm run db:reset     # DEVELOPMENT ONLY: all migrations down, then up, then demo seed
npm run db:down      # stop the database (data is kept in the "pgdata" volume)
```

`npm --prefix backend run db:migrate:down` rolls back one migration (development only; production is forward-only).
The backend test suite rebuilds `foodbridge_test` from scratch on every run (all migrations down, then up), so
every down migration is exercised continuously.

Design, constraints, concurrency strategy and state machines: [docs/DATABASE_DESIGN.md](../docs/DATABASE_DESIGN.md).
ER diagrams: [docs/ER_DIAGRAM.md](../docs/ER_DIAGRAM.md).

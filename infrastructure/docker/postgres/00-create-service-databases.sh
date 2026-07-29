#!/usr/bin/env bash
set -euo pipefail

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO
  \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${IDENTITY_DB_USER}') THEN
      CREATE ROLE ${IDENTITY_DB_USER} LOGIN PASSWORD '${IDENTITY_DB_PASSWORD}';
    END IF;
  END
  \$\$;
SQL

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO
  \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${INTEGRATION_DB_USER}') THEN
      CREATE ROLE ${INTEGRATION_DB_USER} LOGIN PASSWORD '${INTEGRATION_DB_PASSWORD}';
    END IF;
  END
  \$\$;
SQL
if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --command \
  "SELECT 1 FROM pg_database WHERE datname = '${INTEGRATION_DB_NAME}'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner "$INTEGRATION_DB_USER" "$INTEGRATION_DB_NAME"
fi

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$INTEGRATION_DB_NAME" <<-SQL
  GRANT CONNECT ON DATABASE ${INTEGRATION_DB_NAME} TO ${INTEGRATION_DB_USER};
  GRANT USAGE, CREATE ON SCHEMA public TO ${INTEGRATION_DB_USER};
SQL

if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --command \
  "SELECT 1 FROM pg_database WHERE datname = '${IDENTITY_DB_NAME}'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner "$IDENTITY_DB_USER" "$IDENTITY_DB_NAME"
fi

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$IDENTITY_DB_NAME" <<-SQL
  GRANT CONNECT ON DATABASE ${IDENTITY_DB_NAME} TO ${IDENTITY_DB_USER};
  GRANT USAGE, CREATE ON SCHEMA public TO ${IDENTITY_DB_USER};
SQL

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO
  \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${CASE_DB_USER}') THEN
      CREATE ROLE ${CASE_DB_USER} LOGIN PASSWORD '${CASE_DB_PASSWORD}';
    END IF;
  END
  \$\$;
SQL

if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --command \
  "SELECT 1 FROM pg_database WHERE datname = '${CASE_DB_NAME}'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner "$CASE_DB_USER" "$CASE_DB_NAME"
fi

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$CASE_DB_NAME" <<-SQL
  GRANT CONNECT ON DATABASE ${CASE_DB_NAME} TO ${CASE_DB_USER};
  GRANT USAGE, CREATE ON SCHEMA public TO ${CASE_DB_USER};
SQL

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO
  \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${EVIDENCE_DB_USER}') THEN
      CREATE ROLE ${EVIDENCE_DB_USER} LOGIN PASSWORD '${EVIDENCE_DB_PASSWORD}';
    END IF;
  END
  \$\$;
SQL

if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --command \
  "SELECT 1 FROM pg_database WHERE datname = '${EVIDENCE_DB_NAME}'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner "$EVIDENCE_DB_USER" "$EVIDENCE_DB_NAME"
fi

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$EVIDENCE_DB_NAME" <<-SQL
  GRANT CONNECT ON DATABASE ${EVIDENCE_DB_NAME} TO ${EVIDENCE_DB_USER};
  GRANT USAGE, CREATE ON SCHEMA public TO ${EVIDENCE_DB_USER};
SQL

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO
  \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${WORKFLOW_DB_USER}') THEN
      CREATE ROLE ${WORKFLOW_DB_USER} LOGIN PASSWORD '${WORKFLOW_DB_PASSWORD}';
    END IF;
  END
  \$\$;
SQL

if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --command \
  "SELECT 1 FROM pg_database WHERE datname = '${WORKFLOW_DB_NAME}'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner "$WORKFLOW_DB_USER" "$WORKFLOW_DB_NAME"
fi

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$WORKFLOW_DB_NAME" <<-SQL
  GRANT CONNECT ON DATABASE ${WORKFLOW_DB_NAME} TO ${WORKFLOW_DB_USER};
  GRANT USAGE, CREATE ON SCHEMA public TO ${WORKFLOW_DB_USER};
SQL

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO
  \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${AI_DB_USER}') THEN
      CREATE ROLE ${AI_DB_USER} LOGIN PASSWORD '${AI_DB_PASSWORD}';
    END IF;
  END
  \$\$;
SQL

if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --command \
  "SELECT 1 FROM pg_database WHERE datname = '${AI_DB_NAME}'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner "$AI_DB_USER" "$AI_DB_NAME"
fi

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$AI_DB_NAME" <<-SQL
  GRANT CONNECT ON DATABASE ${AI_DB_NAME} TO ${AI_DB_USER};
  GRANT USAGE, CREATE ON SCHEMA public TO ${AI_DB_USER};
SQL

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO
  \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${LEDGER_DB_USER}') THEN
      CREATE ROLE ${LEDGER_DB_USER} LOGIN PASSWORD '${LEDGER_DB_PASSWORD}';
    END IF;
  END
  \$\$;
SQL

if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --command \
  "SELECT 1 FROM pg_database WHERE datname = '${LEDGER_DB_NAME}'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner "$LEDGER_DB_USER" "$LEDGER_DB_NAME"
fi

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$LEDGER_DB_NAME" <<-SQL
  GRANT CONNECT ON DATABASE ${LEDGER_DB_NAME} TO ${LEDGER_DB_USER};
  GRANT USAGE, CREATE ON SCHEMA public TO ${LEDGER_DB_USER};
SQL

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname postgres <<-SQL
  DO
  \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${AUDIT_DB_USER}') THEN
      CREATE ROLE ${AUDIT_DB_USER} LOGIN PASSWORD '${AUDIT_DB_PASSWORD}';
    END IF;
  END
  \$\$;
SQL

if ! psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --command \
  "SELECT 1 FROM pg_database WHERE datname = '${AUDIT_DB_NAME}'" | grep -q 1; then
  createdb --username "$POSTGRES_USER" --owner "$AUDIT_DB_USER" "$AUDIT_DB_NAME"
fi

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$AUDIT_DB_NAME" <<-SQL
  GRANT CONNECT ON DATABASE ${AUDIT_DB_NAME} TO ${AUDIT_DB_USER};
  GRANT USAGE, CREATE ON SCHEMA public TO ${AUDIT_DB_USER};
SQL

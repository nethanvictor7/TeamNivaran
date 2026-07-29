#!/usr/bin/env bash
set -euo pipefail

psql --set ON_ERROR_STOP=on --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set source_reader="$DEMO_SOURCE_READER" --set source_password="$DEMO_SOURCE_PASSWORD" <<-'SQL'
  SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'source_reader', :'source_password')
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'source_reader') \gexec
  SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'source_reader', :'source_password') \gexec
  CREATE TABLE IF NOT EXISTS public.source_applications (
    id uuid PRIMARY KEY,
    application_reference text NOT NULL,
    customer_reference text NOT NULL,
    status text NOT NULL,
    requested_amount numeric(18,2) NOT NULL,
    updated_at timestamptz NOT NULL
  );
  INSERT INTO public.source_applications VALUES
    ('00000000-0000-0000-0000-000000000001','APP-1001','CUS-101','SUBMITTED',1250.10,'2026-07-23T08:00:00Z'),
    ('00000000-0000-0000-0000-000000000002','APP-1002','CUS-102','REFERRED',9200.00,'2026-07-23T08:00:00Z'),
    ('00000000-0000-0000-0000-000000000003','APP-1003','CUS-103','APPROVED',4300.00,'2026-07-23T09:00:00Z')
  ON CONFLICT (id) DO UPDATE SET
    application_reference = EXCLUDED.application_reference,
    customer_reference = EXCLUDED.customer_reference,
    status = EXCLUDED.status,
    requested_amount = EXCLUDED.requested_amount,
    updated_at = EXCLUDED.updated_at;
  SELECT format('GRANT CONNECT ON DATABASE cdep_source_demo TO %I', :'source_reader') \gexec
  SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'source_reader') \gexec
  SELECT format('GRANT SELECT ON public.source_applications TO %I', :'source_reader') \gexec
  SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'source_reader') \gexec
SQL

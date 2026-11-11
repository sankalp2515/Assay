CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS entities (
  tenant_id uuid NOT NULL, kind text NOT NULL, id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,kind,id)
);
CREATE INDEX IF NOT EXISTS entities_batch_idx ON entities(tenant_id,kind,(body->>'batch_id'));
CREATE TABLE IF NOT EXISTS commands (
  tenant_id uuid NOT NULL, scope text NOT NULL, request_key text NOT NULL,
  body_hash text NOT NULL, entity_id uuid NOT NULL, PRIMARY KEY(tenant_id,scope,request_key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, target text NOT NULL, path text NOT NULL, body jsonb NOT NULL,
  state text NOT NULL DEFAULT 'READY' CHECK(state IN ('READY','SENDING','DONE','DEAD')),
  attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, next_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_ready_idx ON outbox(state,next_at);
CREATE TABLE IF NOT EXISTS audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL, action text NOT NULL, digest text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT,INSERT,UPDATE ON entities,commands,outbox TO app_runtime;
GRANT SELECT,INSERT ON audit TO app_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE commands FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit FORCE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['entities','commands','outbox','audit'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='tenant_scope') THEN
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id::text=current_setting(''app.tenant_id'',true))',t);
 END IF;
END LOOP; END $$;
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;

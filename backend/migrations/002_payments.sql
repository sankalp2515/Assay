CREATE TABLE IF NOT EXISTS money_accounts (
 tenant_id uuid NOT NULL,batch_id uuid NOT NULL,captured bigint NOT NULL DEFAULT 0,
 refunded bigint NOT NULL DEFAULT 0,reserved_refund bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,batch_id),CHECK(captured>=0 AND refunded>=0 AND reserved_refund>=0 AND refunded+reserved_refund<=captured)
);
CREATE TABLE IF NOT EXISTS unit_settlements (
 tenant_id uuid NOT NULL,unit_id uuid NOT NULL,batch_id uuid NOT NULL,operation_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0),PRIMARY KEY(tenant_id,unit_id)
);
GRANT SELECT,INSERT,UPDATE ON money_accounts,unit_settlements TO app_runtime;
ALTER TABLE money_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE unit_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_settlements FORCE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['money_accounts','unit_settlements'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='tenant_scope') THEN
 EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id::text=current_setting(''app.tenant_id'',true))',t);
 END IF;
END LOOP; END $$;
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS financial_journal (
 tenant_id uuid NOT NULL, operation_id uuid NOT NULL, operation_kind text NOT NULL DEFAULT 'operation' CHECK(operation_kind='operation'),
 event_kind text NOT NULL CHECK(event_kind IN ('CAPTURE','REFUND','VOID')),
 amount_minor bigint NOT NULL CHECK(amount_minor>=0),currency char(3) NOT NULL CHECK(currency='USD'),
 provider_reference text NOT NULL,resource_digest text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,operation_id,event_kind),
 FOREIGN KEY(tenant_id,operation_kind,operation_id) REFERENCES entities(tenant_id,kind,id)
);
GRANT SELECT,INSERT ON financial_journal TO app_runtime;
ALTER TABLE financial_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_journal FORCE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='financial_journal' AND policyname='tenant_scope') THEN
CREATE POLICY tenant_scope ON financial_journal USING(tenant_id::text=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
END IF; END $$;

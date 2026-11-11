-- Bounded operational scans and webhook lookups must not depend on the first page.
CREATE INDEX IF NOT EXISTS entities_provider_reference_idx
  ON entities(tenant_id,kind,(body->>'provider_id')) WHERE kind='operation';
CREATE INDEX IF NOT EXISTS entities_operation_state_idx
  ON entities(tenant_id,kind,(body->>'state'),updated_at) WHERE kind='operation';
INSERT INTO schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;

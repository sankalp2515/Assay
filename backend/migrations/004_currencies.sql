-- A batch may be priced in any currency PayPal partial capture supports here.
-- One batch still has exactly one currency; amounts are minor units of that currency.
ALTER TABLE financial_journal DROP CONSTRAINT IF EXISTS financial_journal_currency_check;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='financial_journal_currency_allowed') THEN
ALTER TABLE financial_journal ADD CONSTRAINT financial_journal_currency_allowed CHECK(currency IN ('USD','EUR','GBP','CAD','AUD','JPY'));
END IF; END $$;
INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;

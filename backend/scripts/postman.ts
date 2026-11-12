// The Assay merchant API as a runnable Postman collection: the integration walk-through a
// merchant follows, with tests that check the money and access rules on every run.
// Written by `npm run export:api`; run headless with `npm run postman:run` (Newman).
type Item = Record<string, unknown>;
const js = (...lines: string[]) => [{ listen: "test", script: { type: "text/javascript", exec: lines } }];
const pre = (...lines: string[]) => [{ listen: "prerequest", script: { type: "text/javascript", exec: lines } }];
const auth = (v: string) => [{ key: "Authorization", value: "Bearer {{" + v + "}}" }];
const json = (body: unknown) => ({ mode: "raw", raw: JSON.stringify(body, null, 2), options: { raw: { language: "json" } } });
const post = (name: string, url: string, token: string | null, body: unknown, key: string, tests: string[], extra: Item = {}): Item => ({
  name,
  ...extra,
  request: {
    method: "POST",
    url: "{{base_url}}" + url,
    header: [
      ...(token ? auth(token) : []),
      { key: "Content-Type", value: "application/json" },
      { key: "Idempotency-Key", value: key },
    ],
    body: json(body),
  },
  event: [...((extra.event as unknown[]) ?? []), ...js(...tests)],
});
const get = (name: string, url: string, token: string | null, tests: string[]): Item => ({
  name,
  request: { method: "GET", url: "{{base_url}}" + url, header: token ? auth(token) : [] },
  event: js(...tests),
});

export function merchantCollection() {
  return {
    info: {
      name: "Assay merchant API",
      description:
        "Recover AI-video clips that were made but never arrived, and settle through PayPal for exactly what the buyer can open.\n\n" +
        "Run the folders in order. Sandbox only. Folder 3 creates a PayPal order; approving it is a buyer step in a browser (open `approval_url`, sign in with a PayPal Sandbox personal account), then run folder 4.\n\n" +
        "Tests check the rules a merchant relies on: replays return the first result, a changed payload under the same key is refused, an integration key can never approve money, a buyer token opens only its own batch, a capture never exceeds the authorization, and money is always in the batch currency.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "run", value: "" },
      { key: "api_key", value: "" },
      { key: "integration_key", value: "" },
      { key: "integration_key_id", value: "" },
      { key: "buyer_id", value: "" },
      { key: "batch_id", value: "" },
      { key: "contract_hash", value: "" },
      { key: "ceiling_minor", value: "" },
      { key: "currency", value: "EUR" },
      { key: "buyer_token", value: "" },
      { key: "approval_url", value: "" },
    ],
    event: pre(
      "if (!pm.collectionVariables.get('run')) pm.collectionVariables.set('run', Date.now().toString(36));",
    ),
    item: [
      {
        name: "0 · Public",
        item: [
          get("PayPal button configuration", "/v1/paypal/config", null, [
            "pm.test('public, Sandbox, authorize intent', () => { const b = pm.response.json(); pm.expect(b.environment).to.eql('sandbox'); pm.expect(b.intent).to.eql('authorize'); pm.expect(b.currencies).to.include('JPY'); });",
          ]),
          get("Statement verification keys", "/v1/statements/keys", null, [
            "pm.test('Ed25519 keys published', () => { const b = pm.response.json(); pm.expect(b.alg).to.eql('EdDSA'); pm.expect(b.keys.length).to.be.above(0); });",
          ]),
          get("No key, no access", "/v1/batches", null, ["pm.test('401 without a key', () => pm.response.to.have.status(401));"]),
        ],
      },
      {
        name: "1 · Sign up and keys",
        item: [
          post(
            "Sign up (needs SIGNUP_MODE open or invite)",
            "/v1/signup",
            null,
            { merchant_name: "Postman Studio", email: "postman-{{run}}@example.com", invite_code: "{{invite_code}}" },
            "signup-{{run}}",
            [
              "pm.test('account created, key shown once', () => { pm.response.to.have.status(201); const b = pm.response.json(); pm.expect(b.api_key).to.match(/^assay_sk_[0-9a-f]{32}_/); pm.collectionVariables.set('api_key', b.api_key); });",
            ],
          ),
          get("Account", "/v1/account", "api_key", [
            "pm.test('own tenant, operator', () => { pm.response.to.have.status(200); pm.expect(pm.response.json().role).to.eql('operator'); });",
          ]),
          post("Create an integration key", "/v1/api-keys", "api_key", { name: "worker", scope: "integration" }, "key-{{run}}", [
            "pm.test('integration key', () => { const b = pm.response.json(); pm.expect(b.scope).to.eql('integration'); pm.collectionVariables.set('integration_key', b.api_key); pm.collectionVariables.set('integration_key_id', b.id); });",
          ]),
          get("Key list never shows secrets", "/v1/api-keys", "api_key", [
            "pm.test('prefixes only', () => { const t = pm.response.text(); pm.expect(t).not.to.include(pm.collectionVariables.get('api_key')); pm.expect(t).not.to.include(pm.collectionVariables.get('integration_key')); });",
          ]),
        ],
      },
      {
        name: "2 · Open a batch",
        item: [
          post(
            "Open a 10-clip batch at 5.00 (integration key)",
            "/v1/batches",
            "integration_key",
            { buyer_id: "{{buyer_id}}", unit_count: 10, unit_price_minor: 500, currency: "{{currency}}", prompt: "Ten 5-second clips of a quiet coastline at dawn" },
            "order-{{run}}",
            [
              "pm.test('immutable contract, ceiling 10 x 5.00', () => { const b = pm.response.json(); pm.expect(b.ceiling_minor).to.eql(5000); pm.expect(b.currency).to.eql(pm.collectionVariables.get('currency')); pm.expect(b.contract_hash).to.match(/^[0-9a-f]{64}$/); pm.collectionVariables.set('batch_id', b.id); pm.collectionVariables.set('contract_hash', b.contract_hash); pm.collectionVariables.set('ceiling_minor', b.ceiling_minor); });",
            ],
            {
              event: pre(
                "if (!pm.collectionVariables.get('buyer_id')) pm.collectionVariables.set('buyer_id', require('uuid').v4());",
              ),
            },
          ),
          post(
            "Same key, same order: returns the first batch",
            "/v1/batches",
            "integration_key",
            { buyer_id: "{{buyer_id}}", unit_count: 10, unit_price_minor: 500, currency: "{{currency}}", prompt: "Ten 5-second clips of a quiet coastline at dawn" },
            "order-{{run}}",
            ["pm.test('idempotent replay', () => pm.expect(pm.response.json().id).to.eql(pm.collectionVariables.get('batch_id')));"],
          ),
          post(
            "Same key, different price: refused",
            "/v1/batches",
            "integration_key",
            { buyer_id: "{{buyer_id}}", unit_count: 10, unit_price_minor: 600, currency: "{{currency}}", prompt: "Ten 5-second clips of a quiet coastline at dawn" },
            "order-{{run}}",
            ["pm.test('409 on a changed payload', () => pm.response.to.have.status(409));"],
          ),
          post(
            "An integration key cannot approve money",
            "/v1/batches/{{batch_id}}/approve",
            "integration_key",
            { proposal_id: "00000000-0000-4000-a000-000000000000", approval_digest: "0".repeat(64) },
            "approve-{{run}}",
            ["pm.test('403 for integration scope', () => pm.response.to.have.status(403));"],
          ),
        ],
      },
      {
        name: "3 · Buyer approves the PayPal hold",
        item: [
          post("Buyer session for this batch", "/v1/buyer-sessions", "api_key", { batch_id: "{{batch_id}}", buyer_id: "{{buyer_id}}" }, "bs-{{run}}", [
            "pm.test('30-minute buyer token', () => { const b = pm.response.json(); pm.expect(b.buyer_token).to.match(/^assay_bt_/); pm.collectionVariables.set('buyer_token', b.buyer_token); });",
          ]),
          get("A buyer token cannot list batches", "/v1/batches", "buyer_token", ["pm.test('403', () => pm.response.to.have.status(403));"]),
          post("Buyer accepts the contract", "/v1/batches/{{batch_id}}/consent", "buyer_token", { contract_hash: "{{contract_hash}}" }, "consent-{{run}}", [
            "pm.test('consented', () => pm.response.to.have.status(200));",
          ]),
          post("Create the PayPal order (AUTHORIZE, ceiling only)", "/v1/batches/{{batch_id}}/paypal/order", "buyer_token", {}, "paypal-order-{{run}}", [
            "pm.test('order for the ceiling; nothing charged', () => { pm.response.to.have.status(200); const b = pm.response.json(); pm.expect(b.amount_minor).to.eql(Number(pm.collectionVariables.get('ceiling_minor'))); if (b.approval_url) pm.collectionVariables.set('approval_url', b.approval_url); });",
          ]),
        ],
      },
      {
        name: "4 · After approval: authorize and settle",
        description: "Open {{approval_url}} as the Sandbox buyer and approve first.",
        item: [
          post("Authorize the hold", "/v1/batches/{{batch_id}}/paypal/authorize", "buyer_token", {}, "paypal-auth-{{run}}", [
            // Against a real Sandbox deployment the buyer approves in PayPal by hand. Without that
            // approval PayPal refuses the authorization and Assay must not claim a hold.
            "if (pm.response.code === 200) pm.test('authorized for the ceiling, not charged', () => pm.expect(pm.response.json().state).to.eql('AUTHORIZED')); else pm.test('no buyer approval yet: no hold is claimed', () => { pm.expect([409, 422]).to.include(pm.response.code); pm.expect(pm.response.json().state).not.to.eql('AUTHORIZED'); });",
          ]),
          post("Hosted demo only: simulate the provider", "/v1/demo/batches/{{batch_id}}/simulate-provider", "api_key", {}, "demo-{{run}}", [
            "pm.test('labeled simulation or not enabled', () => { if (pm.response.code === 200) pm.expect(pm.response.json().simulated).to.eql(true); else pm.expect([404, 409]).to.include(pm.response.code); });",
          ]),
          post("Investigate (AI reads, rules decide)", "/v1/batches/{{batch_id}}/investigate", "api_key", {}, "investigate-{{run}}", [
            "pm.test('accepted', () => pm.expect([200, 409]).to.include(pm.response.code));",
          ]),
          post("Exact settlement preview", "/v1/batches/{{batch_id}}/closure-preview", "api_key", {}, "preview-{{run}}", [
            "if (pm.response.code === 200) { const b = pm.response.json(); pm.test('never more than authorized, batch currency', () => { pm.expect(b.amount_minor).to.be.at.most(Number(pm.collectionVariables.get('ceiling_minor'))); pm.expect(b.currency).to.eql(pm.collectionVariables.get('currency')); pm.expect(['CAPTURE','VOID']).to.include(b.action); }); }",
          ]),
          get("Signed delivery statement", "/v1/batches/{{batch_id}}/statement", "buyer_token", [
            "if (pm.response.code === 200 && pm.response.json().signed) pm.test('signed after PayPal read-back', () => pm.expect(pm.response.json().jws.split('.').length).to.eql(3));",
          ]),
          get("External playback proof (KERNEL)", "/v1/batches/{{batch_id}}/playback", "buyer_token", [
            "pm.test('no replay link for buyers', () => pm.response.json().probes.forEach(p => pm.expect(p).not.to.have.property('replay_view_url')));",
          ]),
        ],
      },
      {
        name: "5 · Rotate keys",
        item: [
          post("Revoke the integration key", "/v1/api-keys/{{integration_key_id}}/revoke", "api_key", {}, "revoke-{{run}}", [
            "pm.test('revoked', () => pm.expect(pm.response.json().revoked_at).to.be.a('string'));",
          ]),
          get("A revoked key stops at once", "/v1/batches/{{batch_id}}", "integration_key", ["pm.test('401', () => pm.response.to.have.status(401));"]),
        ],
      },
    ],
  };
}

export function environment(name: string, baseUrl: string) {
  return {
    name,
    _postman_variable_scope: "environment",
    values: [
      { key: "base_url", value: baseUrl, enabled: true },
      { key: "invite_code", value: "", type: "secret", enabled: true },
    ],
  };
}

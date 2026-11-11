# Development workflow

Read root AGENTS.md, current backend architecture and product/IMPLEMENTATION_STATUS.md before changing scope. Preserve the earlier starter and private configuration. Frontend is excluded unless explicitly requested. Never alter payment semantics to make a demo pass.

Implement one behavior with its failure cases, run type checking and relevant tests, inspect the actual diff, then update API/operations documentation and ticket evidence. Use strict TypeScript and formatted code. Shared packages contain infrastructure/contracts; service data access stays private. Additive versioned SQL and a separate migration role are required for deployed databases. Do not modify an applied migration to change production history.

Use actual interfaces for PayPal, Gemini and provider clients. Fixture dependencies are supplied explicitly only by the test harness. Do not add a runtime flag that lets fixtures satisfy a sandbox proof. Preserve unknown writes and original operation identity through retries. Require evidence, current approval and correct merchant/currency before financial execution. Read-back remains possible during a model outage.

Commands: npm run typecheck, npm test, npm run build, npm run export:api, npm audit. The local HTTP smoke requires npm run dev in another terminal. Integration commands can contact configured external APIs; read their documented scope and never send paid generation without explicit enabled budget. Do not copy tokens into the command history for shared terminals.

Review checklist: exact contract and buyer binding; correct service identity/tenant; SQL/state constraints; no network in local transactions; idempotency/reservation; output URL/media limits; no secrets in logs; observable uncertainty; updated tests and actual-versus-fixture evidence. Security review must state limits. No cloud deployment, production-scale or commercial claim without corresponding evidence.

# Workflow component rules

Quiet ledger remains the selected visual system. Read root DESIGN.md for primitives and ui/workflows.css for these task-specific surfaces. These rules extend the existing system; they do not introduce a second palette or a new product.

## Form elements

Use native inputs, selects, checkboxes and buttons. Labels name the input; helper text has aria-describedby. Validate integer clip bounds and use usdMinor for exact cents. An invalid amount renders no estimate, never a fabricated zero. Agreement preview is informational and never payment authority. Mobile repeats the exact ceiling immediately before creation controls. The production brief stays private to the provider workflow; it is not a buyer-visible creative-quality guarantee.

## Navigation

ProductShell owns global navigation, route context and page titles. Settings uses an actual tablist with roving focus, ArrowLeft/Right, Home/End, aria-selected and labeled panels. Mobile global navigation has 56px targets at narrow widths. Links navigate; buttons act. Keep keyboard navigation instant and preserve the existing reduced-motion path.

## Data display

Status defaults to neutral, with explicit success/warning tones. Never infer paid from Closed, pending states, connection availability or an order-level status. delivery-view.js maps source states to task labels; unknown states stay in Needs attention. Search and counts are explicitly scoped to the loaded page, with a live result count and a reset action. Do not pad sparse real records with fabricated clients, revenue, activity, charts or savings.

## Workflow composition

Delivery register answers what to open next. Agreement editor groups details, buyer/pricing and fixed terms, with a supporting exact-ceiling inspector. AuthorizationHandoff is restricted to known pre-authorization states with zero published artifacts; it replaces premature unavailable-media/error UI. Keep existing files accessible through outages. Merchant and buyer copy/actions differ. Opening a buyer preview does not grant buyer financial authority.

## Settings and connections

Workspace settings leads with merchant identity, currency and fixed delivery defaults. Technical session references and merchant references use disclosures. Connection rows describe the customer job and actual configuration availability. A fixture environment may still contain a real hosted AI response: environment is not per-operation provenance. Inspect actual receipts/assessment provenance before claiming real provider, AI or PayPal execution. Do not add fake editable profiles or unsupported Connect/Save controls.

## Review boundary

Use current, inspected screenshots of populated, empty, long-title, pending and narrow states. Build/tests do not establish visual quality, customer demand or production readiness. Preserve private artifacts, request identities, exact reviews and backend authority while improving presentation.

Development display controls are opt-in: add ?inspect=1 before the route hash on the local preview. They are absent from production assets and the normal product preview.

# PayPal contract review with the APIMatic Context Plugin

12 November 2026.

**What was used.** The APIMatic Context Plugin for PayPal (`paypaldev/server-sdk-context-plugin-preview`), installed for Claude Code with `npx context-plugins install … --targets claude`. Its skills direct the agent to the generated PayPal Server SDK's own source, rather than to a model's memory. Following the TypeScript skills, the review read `@paypal/paypal-server-sdk` 2.5.0 (`src/models`, `src/controllers`).

**Scope.** Assay's PayPal integration was already built and already has real Sandbox receipts. This is a review of that existing code against the SDK's request models. The integration was not built with the plugin.

| Assay call (`src/adapters/paypal.ts`) | SDK model checked | Result |
|---|---|---|
| Create order: `intent: AUTHORIZE`, `purchase_units[].payee.merchant_id`, `reference_id`, `custom_id`, `amount` | `OrderRequest`, `PurchaseUnitRequest`, `PayeeBase.merchantId` | Matches |
| `payment_source.paypal.experience_context`: `return_url`, `cancel_url`, `user_action: "CONTINUE"` | `PaypalWalletExperienceContext`, `PaypalExperienceUserAction.Continue` | Matches. `CONTINUE` is right for a hold the merchant captures later |
| Capture: `amount`, `final_capture: true`, `invoice_id`, `note_to_payer` | `CaptureRequest` | Matches. `note_to_payer` "appears in both the payer's transaction history and the emails", which is the purpose of Assay's per-clip note |
| Refund: `amount` on the original capture | `RefundRequest` | Matches. **Gap found:** `RefundRequest` also accepts `invoice_id` and `note_to_payer`, and Assay sends neither on refunds. A per-clip note on refunds would match the capture note |
| Headers `PayPal-Request-Id` (idempotency) and `PayPal-Auth-Assertion` (acting for a connected merchant) | `PaymentsController.captureAuthorizedPayment` / `refundCapturedPayment` | Matches. Both headers are on these operations |
| Disputes (`/v1/customer/disputes`) and partner referrals (`/v2/customer/partner-referrals`) | not in the Server SDK (it covers Orders, Payments, Vault, Subscriptions and Transaction Search) | **Not reviewable with this plugin.** Still fixture-tested only |

**Follow-up.** Add `note_to_payer` to refunds, so the buyer's PayPal record says which clips were refunded. This is a small adapter change.

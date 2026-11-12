# Response to the external Codex review

12 November 2026. Each point the review raised, whether we agree, and what changed.

| Review point | Agree? | Action and status |
|---|---|---|
| Lead with the failed delivery: clip 8 lost, the original recovered, the buyer can play it, $40 of $50 captured | Yes | That is the README's story and the "Start here" journey on the hosted build. The video should open on the broken clip and the $50 hold, and end on buyer playback and the $40 capture |
| Show it as one continuous run on the exact build judges receive | Yes, the most important gap | The hosted build is live and the public commit matches it. **Still needed:** one recorded run through the hosted UI with a real Sandbox buyer approval. It needs your Sandbox buyer sign-in |
| The demo clip was a synthetic test MP4 | Yes | The hosted demo provider now uses a real LTX-Video clip, a neutral lighthouse, served at `/demo-media/lighthouse-ltx.mp4`. Its provenance file records the prompt, the model and the one crop that removed a generated caption artifact |
| The dashboard test stalled or timed out | Partly | The cause was found: the harness's seeded fixtures lacked `stored_at`, so an assertion failed, and teardown then hung, which hid the failure. Fixed; the full suite now passes 70 of 70. The teardown-on-failure hang is still worth fixing |
| "Retrievable" is not "opened" | Yes | The README now says "verified as retrievable through their own authenticated route". Observed playback is a separate claim, backed by the KERNEL probe after hosting. It has been shown only on a public clip so far |
| Show Assay's statement and PayPal's capture as separate records | Yes | The README now separates them and says the per-clip PayPal note is fixture-tested, not yet seen in a real Sandbox buyer record |
| Impact totals are capped at 5,000 records | Yes | `/v1/operations/impact` reports `records_considered`, `truncated` and `basis` |
| Demo visitors shared a tenant and could reach payment controls and keys | Yes, a real defect | Fixed: each visitor gets an isolated workspace, and demo sessions are refused on controls, keys and account links. The two-visitor test is described in SECURITY_REVIEW S-27 |
| The dashboard turns read failures into zero | Yes | Fixed: unreadable sources are named in `unavailable`, and their fields are `null` |
| PayPal webhooks (implied by multi-tenant use) | Yes | Webhooks now map to the tenant that created the PayPal resource (S-28) |
| The single VM is a pilot, not scale | Yes | The README's limits say so. Streaming large clips, separating payment reconciliation from media work, load tests, and cross-database restore and failover remain open |
| Make the merchant integration tangible after the outcome | Yes | INTEGRATE.md, the SDK and the Postman collection exist. **Still needed:** show register-task → signed webhook in the video |
| Generic outcome billing is crowded; Assay's distinct claim is recovering an existing original and pricing from verified access | Yes | This is already the positioning in the README and REAL_USER_READINESS |
| Incident frequency and willingness to pay are unmeasured | Yes | Unchanged. MERCHANT_INTERVIEWS.md is the kit; no interviews have been done |
| Score 37/50, with presentation at 6 provisional | No position | A forecast, not evidence. The video and the hosted run are what move presentation and technical implementation |

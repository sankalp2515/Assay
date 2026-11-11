# Public sources

Evidence behind the problem statement. Each row says what the source shows and its limits. These are user reports and provider documentation, not a measured incident rate.

| ID | Source | What it shows | Limits |
|---|---|---|---|
| U1 | [HeyGen missing export and credits](https://www.reddit.com/r/AI_UGC_Marketing/comments/1siagpw/failed_video_renders_on_heygen_still_eat_your/) | 11 April 2026 report of no file despite apparent export completion | Self-report; subjective dissatisfaction mixed in; no ledger audit |
| U2 | [Google Flow queued/failure thread](https://discuss.ai.google.dev/t/google-flow-veo-stuck-in-queued-state-oops-something-went-wrong-failed-generations-deducting-credits-google-ai-ultra/173335) | July 2026 failed/stuck jobs, balance concern and later replies; some apparent errors reportedly succeeded | One thread is not multiple independent samples; screenshots not independently reconciled |
| U3 | [Venice unavailable video](https://www.reddit.com/r/VeniceAI/comments/1wyn51p/video_no_longer_available/) | Missing generated results and support delay | Full post read; conflicting relative-date metadata, no exact date asserted |
| U4 | [Venice credit-consuming failures](https://www.reddit.com/r/VeniceAI/comments/1w63dms/i_had_two_cases_where_i_was_charged_credits_to/) | Visible title and support replies | Body removed; partial record only |
| P1 | [Runway outputs](https://docs.dev.runwayml.com/assets/outputs/) | 24–48 hour result URL lifetime and developer-owned storage expectation | Documents integration behavior, not incidence or adoption |
| P2 | [Runway credit refunds](https://help.runwayml.com/hc/en-us/articles/34266159290003-Can-I-have-credits-refunded) | Existing error-credit returns; completed unsatisfactory generations remain chargeable | Counterevidence against a generic failed-render refund product |
| P3 | [HeyGen processing guidance](https://www.heygen.com/blog/heygen-video-processing-help) | States failed/canceled generations are not charged | Vendor guidance conflicts with user narratives; cannot infer systematic policy violation |
| P4 | [Runway API](https://docs.dev.runwayml.com/api/) and [usage guide](https://docs.dev.runwayml.com/guides/using-the-api/) | Task operations and result lookup support an adapter | Account/model access, idempotency/correlation limits need actual spike |
| P1 | [Gemini API Veo limitations](https://aistudio.google.com/docs/veo) | Generated videos stored for 2 days, then removed; developers must download | Integration behaviour, not incidence |
| P1 | [Replicate data retention](https://replicate.com/docs/topics/predictions/data-retention) | API prediction outputs and files removed after one hour by default | Integration behaviour, not incidence |

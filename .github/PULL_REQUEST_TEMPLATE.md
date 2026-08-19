## What does this change do, and why?

<!-- One or two sentences. Link an issue/ADR if relevant. -->

## Review checklist

See [CONTRIBUTING.md](../CONTRIBUTING.md#review-checklist) for the full
explanation of each item. Check off what applies; strike through
(`~~item~~`) whatever genuinely doesn't apply to this change.

- [ ] Architecture — respects existing layering, no new inward-dependency violations
- [ ] Security — new endpoints/inputs are validated, auth/rate-limited as appropriate
- [ ] Privacy — nothing new sent to the backend without a privacy-policy update
- [ ] Exception handling — no internal details leak to API clients
- [ ] Logging — no biometric values or secrets in log lines
- [ ] Test coverage — new logic has unit tests; new endpoints have an integration test
- [ ] Config — no hardcoded secrets/URLs/thresholds
- [ ] Scalability — new per-process state has a plan for horizontal scaling, or is documented as a known limitation
- [ ] Docs — model card / ADR / privacy policy updated if this changes a model, architecture decision, or privacy-relevant behavior

## Testing performed

<!-- What did you actually run? Paste relevant output if useful. -->

## Screenshots (if UI-facing)

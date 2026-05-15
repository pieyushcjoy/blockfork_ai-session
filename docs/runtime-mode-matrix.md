# Runtime Mode Matrix

This matrix defines expected verification behavior by runtime profile.

## Profiles

- Production profile: `NODE_ENV=production`
- Non-production profile: `NODE_ENV!=production`

## Verification coverage

| Check | Production profile | Non-production profile |
| --- | --- | --- |
| `runtime:verify` core health (`/health`, `/v1`, `/v1/session`, chat, responses) | Required | Required |
| `runtime:verify:integrity` auth boundaries | Required | Required |
| `runtime:verify:integrity` response shape checks | Required | Required |
| deterministic 429 probe (`x-blockfork-test-primary-failure: 429`) | Skipped unless `BLOCKFORK_FORCE_PRIMARY_429=1` | Expected |
| deterministic timeout probe (`x-blockfork-test-primary-failure: timeout`) | Skipped unless `BLOCKFORK_FORCE_PRIMARY_TIMEOUT=1` | Expected |
| deterministic upstream unauthorized override (`x-blockfork-test-upstream-key`) | Skipped unless `BLOCKFORK_ENABLE_TEST_UPSTREAM_KEY_OVERRIDE=1` | Optional; expected if explicitly enabled |
| fallback activation assertion from deterministic primary failure | Conditional; requires deterministic failure activation | Expected when fallback is enabled + configured |

## Gate policy

For stabilization sign-off:

1. Production profile must pass `runtime:verify` and `runtime:verify:integrity`.
2. Non-production profile must pass deterministic fallback drill coverage before changing routing/retry policy.
3. Any skipped deterministic check must be explicitly called out in run output and release notes.

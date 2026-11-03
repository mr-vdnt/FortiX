# Architecture Decision Record: FTX-AUTH-001 — Authentication, Remember-Me Sessions & Account Recovery

- **Status:** Accepted & Implemented
- **Module Scope:** `src/api/auth.ts`, `src/api/account.ts`, `src/auth/providers.ts`, `src/auth/recovery.ts`, `src/auth/sessions.ts`, `src/lib/auth-tokens.ts`, `src/lib/cors-csrf.ts`, `drizzle/0006_auth_sessions_and_recovery.sql`

## 1. Context

FortiX previously relied on single-duration JWT sessions and a legacy email-only reset token flow in `src/lib/auth-tokens.ts`. A security audit prior to `FTX-AUTH-001` identified four architectural gaps:

1. `refresh_tokens` existed in `src/db/schema.ts` and `0000_dizzy_moon_knight.sql` without rotation, family tracking, or active runtime integration.
2. `consumeAuthActionToken()` performed a non-atomic `SELECT` followed by `UPDATE`, permitting concurrent single-use token replay under race conditions.
3. `deliverAuthNotification()` invoked `fetch(AUTH_MAIL_WEBHOOK_URL)` without verifying `response.ok` (`2xx` HTTP status), allowing silent delivery failure while leaving reset tokens active.
4. No verified-phone prerequisite, OTP HMAC storage, resend cooldown, or multi-dimensional rate-limiting existed for email/SMS account recovery.

## 2. Decisions

### 2.1 Additive Schema Evolution (No Parallel Auth System)
- Extended `users` with `phone_e164` (`UNIQUE` on non-null E.164 values) and `phone_verified` (`BOOLEAN NOT NULL DEFAULT false`).
- Extended the existing `refresh_tokens` table with `family_id`, `replaced_by_id`, `remember_me`, `absolute_expires_at`, `last_used_at`, `reuse_detected_at`, `user_agent_hash`, and `ip_hash` rather than introducing a duplicate session table.
- Added `recovery_challenges` to track OTP HMAC digests, expiration (`10m`), failed verification attempts (`max_attempts = 5`), resend cooldown (`60s`), consumption timestamps, and explicit invalidation reasons.

### 2.2 Remember-Me & Rotating Refresh Token Families
- **Never store credentials in browser storage:** Passwords are never written to `localStorage`, `sessionStorage`, or cookies.
- **Unchecked (`rememberMe = false`):** Issues session-scoped `HttpOnly` cookies (cleared on browser exit) bounded server-side by `SESSION_SHORT_TTL_HOURS` (`12h` default).
- **Checked (`rememberMe = true`):** Issues a persistent `fortix_refresh` `HttpOnly` cookie (`Path=/api/auth`, `SESSION_REMEMBER_TTL_DAYS = 30d` default) paired with a short-lived (`1h`) access JWT (`fortix_session`).
- **Rotation & Reuse Detection:** Every `POST /api/auth/refresh` atomically marks the presented refresh token as replaced (`replaced_by_id`, `revoked_at`) and issues a successor within the same `family_id`, bounded by `absolute_expires_at`. Re-presenting any already-rotated refresh token triggers immediate family-wide revocation (`REFRESH_TOKEN_REUSED`).

### 2.3 Multi-Channel OTP Identity Verification & Anti-Enumeration
- **OTP Generation & Storage:** 6-digit codes are generated with `crypto.randomInt(0, 1_000_000)` and stored exclusively as keyed `HMAC-SHA256` digests (`OTP_HMAC_SECRET` or domain-separated key derivation).
- **Verified Phone Prerequisite:** SMS recovery OTPs are dispatched **only** when `users.phone_verified = true`.
- **Non-Enumerating Synthetic Challenges:** Requests for unknown emails, unknown phone numbers, or unverified phone numbers perform constant-work dummy HMAC computation and return an indistinguishable synthetic `challengeId` with the identical generic confirmation message.
- **Single-Use Reset Authorization:** Validating an OTP atomically transitions `consumed_at` (`WHERE consumed_at IS NULL AND invalidated_at IS NULL AND failed_attempts < max_attempts AND expires_at > NOW()`) and issues a 10-minute single-use `RESET_AUTHORIZATION` token consumed atomically by `POST /api/auth/reset-password`.

### 2.4 Explicit Notification Provider Contracts
- `EmailDeliveryProvider` and `SmsDeliveryProvider` inspect `response.ok` (`2xx`), enforce an 8-second `AbortController` timeout and `redirect: 'error'`, never log OTPs or tokens, and return structured `NotificationDeliveryResult` objects.
- If delivery fails, the associated `recovery_challenges` or `auth_action_tokens` record is immediately invalidated.

## 3. Rollback & Operational Safety
- Migration `0006_auth_sessions_and_recovery.sql` is purely additive (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), preserving backward compatibility with existing data and row-level security policies.

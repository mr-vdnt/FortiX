# FortiX B.Tech IT Project Report — UI Screenshot Audit & Final Capture Requirements

- **Audited Repository:** `https://github.com/mr-vdnt/FortiX` (`main` @ `a97c14fb53d0bd3c915016cfdfafe4524c288517`)
- **Capture Script Audited:** `scripts/report/capture-assets.ts`
- **Existing Screenshot Directory:** `docs/reports/screenshots/` (`scr01_login.png` – `scr15_settings_account.png`)

---

## 1. Forensic Audit of the 15 Existing Screenshots (`docs/reports/screenshots/`)

All 15 screenshots embedded in Chapter 4 (Figures 4.1–4.15) were captured programmatically via Playwright Chromium (`1440×900` @ `1.5x` device scale factor) against the live local FortiX server (`http://127.0.0.1:3000`) in `scripts/report/capture-assets.ts` (lines 1543–1703).

### 1.1 Provenance & Redaction Audit Table

| Figure | File (`docs/reports/screenshots/`) | Route Captured | React Component | Live State Seeded Before Capture | Secret / PII Redaction Status | Runtime Environment Caveat |
|---|---|---|---|---|---|---|
| **Fig 4.1** | `scr01_login.png` | `/login` | `src/components/Login.tsx` | Identifier pre-filled with synthetic `operator@example.edu`; `Remember me` checked. | Safe (`operator@example.edu`, password input empty, `redactSensitiveDom()` applied). | Valid for final report. |
| **Fig 4.2** | `scr02_register.png` | `/login` (Create Account mode) | `src/components/Login.tsx` | Toggled via `Create an account` button; synthetic `operator@example.edu`. | Safe (`operator@example.edu`, no real user PII). | Valid for final report. |
| **Fig 4.3** | `scr03_forgot_password.png` | `/forgot-password` | `src/pages/PasswordRecovery.tsx` | Identifier pre-filled with synthetic `operator@example.edu`. | Safe (synthetic `.edu` address). | Valid for final report. |
| **Fig 4.4** | `scr04_verify_otp.png` | `/verify-reset` | `src/pages/PasswordRecovery.tsx` | Triggered real `POST /api/auth/forgot-password`; Playwright route interceptor masked `devOtpCode` -> `••••••` and `destinationMasked` -> `op***@example.edu`. | Safe (OTP digits masked `••••••`; destination masked `op***@example.edu`). | Shows dev-outbox helper banner (`••••••`); production SMTP/SMS screenshot recommended if external webhook is configured. |
| **Fig 4.5** | `scr05_dashboard.png` | `/` | `src/pages/Dashboard.tsx` | Authenticated session; 6 `GET /proxy/:routeId/api/store/products` requests + 1 blocked SQLi request + 1 completed `latency` (`200 ms`) experiment. | Safe (`redactSensitiveDom()` hides raw `fx_live_*` keys and personal emails). | Captured in **Ephemeral Sandbox (`pg-mem` + `ioredis-mock`)** mode (`deploymentMode: ephemeral-sandbox`). |
| **Fig 4.6** | `scr06_api_studio.png` | `/studio` | `src/pages/ApiStudio.tsx` | Provisioned `Store Products API` (`template: 'products_100'`, `/api/store`, `v1`, `30 RPM`, WAF + SSRF enabled). | Safe (`fx_live_*` raw key redacted via `redactSensitiveDom()`). | Sandbox mode (`pg-mem` backing `studio_records`). |
| **Fig 4.7** | `scr07_protected_apis.png` | `/apis` | `src/pages/APIs.tsx` | Shows gateway route bound to `http://fortix-studio.internal/studio/<apiId>` and scoped API key metadata (`keyPrefix` only). | Safe (raw secret never returned on `GET /api/control/keys`; DOM redaction active). | Sandbox mode. |
| **Fig 4.8** | `scr08_security_policies.png` | `/security` | `src/pages/Security.tsx` | Shows route policy (`rateLimitRpm = 30`, `enableWaf = true`, `enableSsrf = true`). | Safe (no credentials displayed). | Sandbox mode. |
| **Fig 4.9** | `scr09_threats.png` | `/threats` | `src/pages/Threats.tsx` | Displays real blocked SQL injection event (`?q=' OR 1=1--` -> HTTP `403`) on Store Products route. | Safe (synthetic attack query only; no real user data). | Sandbox mode. |
| **Fig 4.10** | `scr10_experiments.png` | `/experiments` | `src/pages/Experiments.tsx` | Shows completed `latency` (`200 ms`, `2000 ms`) experiment run via local fallback runner. | Safe. | Executed via in-process sandbox experiment runner (`REDIS_URL` unset), not external BullMQ worker container. |
| **Fig 4.11** | `scr11_verifications.png` | `/verifications` | `src/pages/Verifications.tsx` | Displays deterministic verification verdict card (`BASELINE`, `INJECTION`, `RECOVERY` metrics). | Safe. | Sandbox mode; does not show the downloaded PDF viewer window itself. |
| **Fig 4.12** | `scr12_resilience.png` | `/resilience` | `src/pages/Resilience.tsx` | Displays computed route/project resilience score post-experiment. | Safe. | Sandbox mode. |
| **Fig 4.13** | `scr13_topology.png` | `/topology` | `src/pages/Topology.tsx` | Renders Client -> FortiX Gateway -> Store Products Studio Upstream graph. | Safe. | Sandbox mode. |
| **Fig 4.14** | `scr14_learning_center.png` | `/learning-center` | `src/pages/LearningCenter.tsx` | Displays seeded `FTX-LEARN-001` catalog grid, lifecycle stage filters (`PROTECT`–`IMPROVE`), and progress summary. | Safe. | Captures catalog overview (`/learning-center`), **not** the individual tutorial playback screen (`/learning-center/:slug`). |
| **Fig 4.15** | `scr15_settings_account.png` | `/settings?tab=account` | `src/pages/Settings.tsx` | Displays account profile, E.164 phone enrollment section, and active refresh session family list. | Safe (synthetic `Academic Evaluator` / redacted email). | Phone shown in unverified initial state before live SMS OTP confirmation. |

---

## 2. Mandatory Disclosure Applied in the Revised Report

In `FORTIX_BTECH_PROJECT_REPORT_REVISED.{docx,pdf}`, Section 4.1 and every authenticated screenshot source note (`Figures 4.5–4.15`) explicitly state that:
1. Screenshots were captured against the live local FortiX server running in **ephemeral sandbox mode (`pg-mem` + `ioredis-mock`)**.
2. Sensitive artifacts (`fx_live_*` raw API secrets, OTP codes, session cookies, and personal email addresses) were redacted prior to capture.

---

## 3. Checklist of Additional / Replacement Screenshots Required for Full Production-Environment Defense

If the student team wishes to claim **external multi-container production verification** (rather than sandbox runtime verification) during final university viva/submission, capture the following 7 screenshots from a running `docker compose up --build -d` stack backed by persistent **PostgreSQL 15** and **Redis 7**:

| Req ID | Target Screen / Artifact | Exact URL / View | Required Visual State to Capture | Redaction Rule |
|---|---|---|---|---|
| **SCR-REQ-01** | **Step 3 of Account Recovery (`Create a new password`)** | `/reset-password` + post-reset `/login` banner | Show `New password` and `Confirm new password` inputs after a valid `POST /api/auth/verify-reset-otp` transition, plus the password-reset confirmation notice on `/login`. *(Currently only Steps 1 & 2 — `scr03` and `scr04` — are captured.)* | Mask password fields (`••••••••••••`); use synthetic `@example.edu` identifier only. |
| **SCR-REQ-02** | **Tutorial Detail & Embedded Video Playback (`FTX-LEARN-001`)** | `/learning-center/fortix-platform-overview` (`src/pages/TutorialDetail.tsx`) | Show active HTML5 `<video>` playback (`/learning/videos/fortix-platform-overview.webm`), enabled WebVTT captions (`CC`), interactive step-by-step checklist, contextual `"Open Module"` button, and non-zero persisted watch progress (`Completed` or `Resume at 01:15`). *(Currently only the catalog grid `scr14_learning_center.png` is captured.)* | Ensure logged-in header email uses synthetic `@example.edu`. |
| **SCR-REQ-03** | **Contextual Help Drawer Inside Feature Screen** | `/studio` or `/security` with Contextual Tutorial Drawer open | Show the in-context `"How this works / Guided Tutorial"` drawer opened directly inside API Studio or Security Policies linking to the relevant lifecycle tutorial. | Redact any visible `fx_live_*` raw key banner. |
| **SCR-REQ-04** | **Persistent Docker Infrastructure Readiness Proof** | `/api/health/ready` JSON + Workspace Status Header on `/` | Capture `GET http://localhost:8080/api/health/ready` returning `"status": "ready"`, `"deploymentMode": "persistent"`, `"persistenceVerified": true`, `"postgresStorageMode": "persistent"`, `"redisStorageMode": "persistent"` alongside the Dashboard header without the sandbox warning banner. | Never display `DATABASE_URL` or `REDIS_URL` connection passwords. |
| **SCR-REQ-05** | **Rate-Limit Burst (`traffic_burst`) HTTP 429 Verification Detail** | `/verifications` (expanded detail drawer/card) | Run both a `latency` experiment AND a `traffic_burst` experiment against a 30 RPM route so `/verifications` displays observed `HTTP 429` throttling counts alongside `BASELINE` / `INJECTION` / `RECOVERY` P50/P95 latency metrics. | Redact any webhook URLs or signing secrets if shown. |
| **SCR-REQ-06** | **Generated Compliance PDF Artifact Preview** | Downloaded `verification-<id>.pdf` opened in PDF viewer | Capture page 1 of the generated PDFKit verification report showing the experiment UUID, 3-phase metrics table, `PASS`/`FAIL` verdict, and matching `X-FortiX-Artifact-SHA256` digest. | Use synthetic project/organization names only. |
| **SCR-REQ-07** | **Verified E.164 Phone & Multi-Session Revocation State** | `/settings?tab=account` | After confirming a test phone OTP (`phoneVerified: true`) and logging in from two browser contexts (`Remember me` vs standard session), capture two active refresh session families with device/expiry badges before clicking `Revoke`. | Mask phone digits (`+91******3210`); never show raw OTP or cookie strings. |

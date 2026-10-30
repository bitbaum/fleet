# Authentication parity: app × provider matrix (2026-10-30)

This is the inventory for the "Authentication parity" item in
`docs/package-remediation-checklist-2026-10-28.md` (status row D2 in
`docs/package-remediation-status.md`). It reports what was checked. It changes
no app code.

**How it was checked.** Source was read from each app's `origin` default branch
as fetched on 2026-10-30 (AOZ: `master`; every other app: `main`). The live
probes were run on 2026-10-30 and were read-only. No account was created and no
credential was submitted. Each probe did one of the following:

- loaded the sign-in and sign-up pages, both as served HTML and rendered in
  headless Chromium at 390px, and listed the visible buttons;
- for AccountKit / better-auth apps, sent
  `POST /api/auth/sign-in/social {"provider":"<id>","callbackURL":"/"}` with no
  credentials, for `orangecat`, `bitbaum-signin`, `google`, `github` and
  `twitter`, and recorded only whether it returned an authorize URL. AccountKit's
  OIDC buttons call `signIn.social` with the generic-OAuth provider id;
- for Auth.js apps, read `GET /api/auth/providers`, then fetched a CSRF token and
  sent `POST /api/auth/signin/<provider>` with no credentials. The redirect was
  recorded;
- requested the resulting IdP authorize URL with GET only and without following
  it. For OrangeCat, a 307 to `https://orangecat.ch/auth` means the client id,
  redirect URI, PKCE and scopes were accepted: `oauth/authorize/page.tsx`
  validates those before it hands a signed-out visitor to sign-in. For Google,
  the decoded `authError` was recorded.

"Working" therefore means **the authorize leg was accepted by the IdP**. No
probe completed a callback or a token exchange, because that needs a real
account. Those legs are **unverified** for every provider in every app. The
same holds for live mail delivery: no mail was sent, so delivery is
**unverified** everywhere. Where the table says mail is "on live", that is
inferred from the page. AccountKit's `signInMethods(env, mailConfigured)` shows
"Forgot your password?" and the sign-in link only when mail is configured.

## Matrix

Methods use these abbreviations: EP = email + password, ML = magic link, PK =
passkey, 2FA = TOTP second factor, OC = Sign in with OrangeCat, BR = the shared
bitbaum sign-in (`SIGNIN_*`).

| App | Live URL | Runtime (source) | Methods the code can offer, with the env each one needs | Providers shown live | Providers working (live authorize probe) | Account mail (verify / reset) | CI journey coverage |
|---|---|---|---|---|---|---|---|
| aoz-begleitung | aoz.orangecat.ch | Legacy runtime built on `jose` (`src/lib/auth/jwt.ts`). AccountKit `createAuthRuntime` is staged behind `AUTH_RUNTIME=accountkit` and is **off live**: `/api/auth/get-session` returns 404 `{"success":false}`. | EP and a staff/resident login code. Registration uses a code. The staged runtime adds AccountKit's methods, but per `package-plan.json` its account screens (passkeys, 2FA, sessions) are not built. No OAuth provider. Env: `BETTER_AUTH_SECRET` (staged), `RESEND_API_KEY`, `RESEND_FROM`. | None. The page shows EP, "Mit Code anmelden" and "Passwort vergessen?". | n/a | Wired. The legacy API has verify-email, resend-verification, forgot-password and reset-password routes, and the staged runtime has a mailer. Delivery unverified. | ci.yml `e2e-tests` runs `tests/auth.spec.ts` on the legacy runtime. The staged runtime is covered only by vitest (`accountkit-journeys.test.ts`, `accountkit-import.test.ts`). It does not use the shared-auth-journey. |
| biaslens | biaslens.orangecat.ch | AccountKit `createAuthRuntime` (`src/lib/auth.ts`) | EP, ML, PK, 2FA. BR and OC appear if `SIGNIN_*` or `ORANGECAT_OAUTH_*` is set; both are listed in `.env.example`. Mail goes through mail-kit (`RESEND_API_KEY`). | Passkey, EP, sign-in link, Forgot. No OIDC button. | `orangecat`, `bitbaum-signin`, `google`, `github`, `twitter` all return 404 `PROVIDER_NOT_FOUND`. No OIDC is configured, which matches the page. | Wired. On live: Forgot and the sign-in link are shown. | `browser-smoke.yml` calls the shared-auth-journey and also runs `browser:smoke`. |
| causius | causius.orangecat.ch | AccountKit `createAuthRuntime` (`lib/auth/index.ts`) | EP, ML, PK, 2FA, OC, BR (same env names as above). `onAccountCreated` adopts legacy OrangeCat matters. | "Continue with OrangeCat", passkey, EP, sign-in link, Forgot. The sign-up page shows OC and the link. | **OC accepted** (`client_id=causius`; OrangeCat answers 307 to `/auth`). `bitbaum-signin`, `google`, `github`, `twitter` return 404. | Wired. On live: Forgot and the link are shown. | shared-auth-journey (`/de/sign-in`). |
| diplodoctor | diplodoctor.orangecat.ch | AccountKit `createAuthRuntime` (`lib/auth/server.ts`) | EP, ML, PK, 2FA. BR and OC are in `.env.example`. | Passkey and EP only. **No Forgot and no sign-in link.** | All five provider ids return 404. Nothing is configured, which matches the page. | Wired in code (`lib/mail.ts`) but **not configured live**: recovery and the link are hidden. | shared-auth-journey (`/de/sign-in`). |
| evig | evig.orangecat.ch | **NextAuth 5.0.0-beta.32** with Credentials and `orangecatProvider` (`src/auth.ts`) | EP and OC (`ORANGECAT_OAUTH_*`). No PK, 2FA or ML: the Email provider is commented out. | "Mit OrangeCat anmelden", which is rendered client-side once Auth.js lists the provider, and "Mit E-Mail und Passwort anmelden". Register shows "Konto mit OrangeCat erstellen". | **OC accepted** (`client_id=evig`, 307 to `/auth`). | Wired: verify-code, verify-email, resend-code, forgot and reset routes. Transport is Resend, listmonk or SMTP (`EMAIL_*` / `RESEND_*`). Delivery unverified. | ci.yml `auth-smoke` runs `tests/e2e/auth-smoke.spec.ts` against prod **only when `AUTH_TEST_*` secrets exist**; whether they exist is unverified. No sign-up or recovery journey. |
| heidi | heidi.orangecat.ch | AccountKit `createAuthRuntime` + `createAuthMailer` (`lib/auth/index.ts`) | EP, ML, PK, 2FA, OC, BR. | "Weiter mit OrangeCat", "Mit Passkey anmelden", EP. **No Forgot and no link.** | **OC accepted** (`client_id=heidi`). `bitbaum-signin`, `google`, `github`, `twitter` return 404. | Wired (`createAuthMailer`) but **not configured live**. | shared-auth-journey (`/de/sign-in`). |
| hirnli | hirnli.orangecat.ch (platform), revamp-info.orangecat.ch (tenant) | AccountKit `createAuthRuntime` (`src/lib/auth/server.ts`) | The runtime exposes EP, PK and 2FA endpoints. The product's own `AuthForm` shows **EP only**. Mail is hard-coded off (`mail: { configured: false }`), so ML is unavailable. No OIDC env. | EP only, on both hosts. Sign-up also asks for a name. | All five provider ids return 404 on both hosts. | **Off by design** (`scripts/auth-journey.mjs`: "account mail is off on purpose"). **No password recovery.** | Its own `scripts/auth-journey.mjs` runs in `browser-smoke.yml`. |
| kivvi | kivvi.orangecat.ch (kivvi.ch and app.kivvi.ch were unreachable from the probe sandbox, so they are unverified) | **NextAuth 5.0.0-beta.32**, Credentials only (`apps/web/lib/auth.ts`) | EP only. `NEXTAUTH_SECRET`; `EMAIL_*` in `.env.example`. | EP and "Passwort vergessen?". | Providers list is `credentials` only. | Reset is wired (server action `requestPasswordResetAction`). **No email-verification flow** was found. Delivery unverified. | `browser-smoke.yml` runs `chatkit-smoke.spec.ts` only. **No auth journey.** |
| loki | loki.orangecat.ch | **NextAuth 5.0.0-beta.32** (`src/auth.ts`) with OC, GitHub, Google, X (OAuth 1.0a through the Credentials provider `x-1a` and `/api/x-login/*`), and Credentials `email-password`, `user-password` and `local`. | EP, OC (`ORANGECAT_OAUTH_*`), GitHub (`GITHUB_CLIENT_ID/SECRET`), Google (`GOOGLE_CLIENT_ID/SECRET`), X (`X1_CONSUMER_KEY/SECRET`). Each button is gated on its env (`src/lib/auth-providers.ts`). No PK or 2FA. GitHub and Google set `allowDangerousEmailAccountLinking: true`. | OrangeCat, **GitHub, Google, X**, EP, Forgot. | **OC accepted** (`client_id=loki`). **Google: redirect_uri_mismatch** (Google rejects `https://loki.orangecat.ch/api/auth/callback/google`). **X: `/api/x-login/start` redirects to `/sign-in?error=XLoginStart`.** GitHub: redirects to github.com with a client id, but the IdP response could not be read from the sandbox, so it is **unverified**. | Wired (mail-kit): verify-email page with resend, plus forgot and reset routes. Delivery unverified. | **None found.** The ci.yml browser steps cover widget and extension tests. |
| orangecat (IdP) | orangecat.ch | Supabase GoTrue (self-hosted) | EP, emailed sign-in code, anonymous start, and OAuth through GoTrue (`google`, `github`, `x`, `linkedin`, `facebook`, `apple` mapped in `oauth-provider-map.ts`). The button list comes from `/api/auth/oauth-providers`, which probes GoTrue. | Google, GitHub, EP, sign-in code, "Start instantly — no email", Forgot. | `/api/auth/oauth-providers` returns `["google","github"]`. X is flagged on in GoTrue but hidden by the probe. Its runbook dated 2026-07-28 says the credentials are broken. | GoTrue mail; Forgot is shown. Delivery unverified. | ci.yml `test:e2e:matrix:p0` (`@p0`, when fixture secrets exist). `e2e-auth.yml` runs `login-only.spec.ts` daily. |
| petvity | petvity.orangecat.ch | **NextAuth 5.0.0-beta.32** (`lib/auth/index.ts`) with OC, Google and Credentials | EP and OC. **Google is mounted unconditionally** with `GOOGLE_CLIENT_ID/SECRET` ("kept for any Google-linked account"). | "Sign in with OrangeCat" and EP. Google is **not shown**. | **OC accepted** (`client_id=petvity`). **Google: `client_id=undefined` and Google answers `invalid_client`.** | Forgot and reset are wired (`RESEND_API_KEY`). **No email-verification route.** | **None.** The only workflows are ci, deploy and auto-merge. |
| solon | solon.orangecat.ch | AccountKit `createAuthRuntime` + `createAuthMailer` (`src/lib/auth/index.ts`) | EP, ML, PK, 2FA, OC, BR. | "Continue with OrangeCat", passkey, EP. **No Forgot and no link.** | **OC accepted** (`client_id=solon`). `bitbaum-signin`, `google`, `github`, `twitter` return 404. | Wired but **not configured live**. | shared-auth-journey (`/de/sign-in`). |
| substrata | substrata.orangecat.ch | AccountKit `createAuthRuntime` (`lib/auth.ts`) | EP, PK, 2FA, OC, BR. Mail is hard-coded off ("Substrata sends no mail yet"), so there is no ML and no recovery. | **Unverified: the site answered 502** on every request on 2026-10-30. | **Unverified** (502). | **Off by design.** No password recovery. | `browser-smoke.yml` checks chart layout only. **No auth journey.** |
| surf-your-life | surf-your-life.orangecat.ch | **NextAuth 5.0.0-beta.32** (`lib/auth/index.ts`) with OC, Google (conditional) and Credentials | EP, OC, and Google only if `GOOGLE_CLIENT_ID/SECRET` is set. | "Mit OrangeCat anmelden", EP, Forgot. Sign-up shows "Konto mit OrangeCat erstellen". No Google button. | **OC accepted** (`client_id=surf-your-life`). Google is absent from `/api/auth/providers`, which matches the page. | Wired: verify-email, resend-verification, forgot, reset (`RESEND_*`). | **None.** The only workflows are ci, deploy and auto-merge. |
| vitareba | vita.orangecat.ch (vitareba.orangecat.ch redirects there) | **NextAuth 5.0.0-beta.32** (`lib/auth/index.ts`). AccountKit `createAuthRuntime` is staged behind `AUTH_RUNTIME=accountkit` and is **off live**: Auth.js answers `/api/auth/get-session` with 400 "Bad request." | EP, and Google only if `GOOGLE_CLIENT_ID/SECRET` is set. The staged runtime adds AccountKit's methods with legacy bcrypt. | EP, "Passwort vergessen?", Registrieren. | Providers list is `credentials` only. | Forgot and reset are wired (`RESEND_API_KEY`). **No email-verification route** on the live runtime. | Its own `scripts/browser-smoke.mjs` runs twice in `browser-smoke.yml`, once per runtime. It covers register, sign-out, wrong password, sign-in, recovery pages rendering, and import of an existing account. |

## Findings

### Advertised but broken: the rule "never advertise an unconfigured provider" is violated

1. **Loki: Google.** The button is shown. Google rejects the authorize request
   with `redirect_uri_mismatch` for `https://loki.orangecat.ch/api/auth/callback/google`.
   The credentials are set, because the button is gated on them, but that
   callback URL is not registered in the Google console.
2. **Loki: X.** The button is shown. `/api/x-login/start` fails server-side and
   redirects to `/sign-in?error=XLoginStart`. The button is gated only on
   `X1_CONSUMER_KEY/SECRET` being present, not on the request-token call
   working.
3. **Loki: GitHub.** The button is shown and redirects to GitHub with a client
   id. The GitHub response could not be read from the probe sandbox. Treat it
   as **unverified**, not as working.

### Configured but not shown

4. **Petvity: Google.** It is mounted with no credentials (`client_id=undefined`,
   and Google answers `invalid_client`). It is reachable at
   `/api/auth/signin/google` but not shown. The source comment says it is "kept
   for any Google-linked account", but no such account can sign in through it.
5. **Hirnli: passkeys and 2FA.** The AccountKit runtime serves them, but the
   app's own `AuthForm` offers only email and password.

No AccountKit app shows an OIDC button that its endpoint does not back.
OrangeCat's own button list is probe-driven and hides its broken X provider.

### Missing recovery

6. **Diplodoctor, Heidi and Solon** have mail wired in code but not configured
   in production. The live pages show no "Forgot your password?" and no sign-in
   link, so a person who forgets a password has no way back, and new addresses
   are not verified.
7. **Hirnli and Substrata** have mail turned off in source (`configured: false`).
   They have no recovery by design.
8. **Kivvi, Petvity and Vitareba (live runtime)** have password reset but no
   email-verification flow.

### NextAuth apps still to move to `@bitbaum/accountkit/auth`

9. **evig, kivvi, loki, petvity, surf-your-life, vitareba** run NextAuth
   5.0.0-beta.32. Vitareba has the AccountKit runtime staged and off.
   **AOZ** runs a legacy runtime built on `jose`, also with AccountKit staged
   and off.
10. **Doc drift in fleet.** `STACK.md` says "Loki, Solon, Heidi, Substrata and
    evig still federate to OrangeCat through next-auth". In source, Solon, Heidi
    and Substrata are now on `createAuthRuntime`. `SHARED.md` still lists only
    causius as having adopted `./auth`. BiasLens, Diplodoctor, Heidi, Hirnli,
    Solon and Substrata also use it.
11. **Loki links accounts by email.** GitHub and Google set
    `allowDangerousEmailAccountLinking: true`. STACK.md "Identity" says a
    provider's address is never an identity.

### Apps without a browser auth journey in CI

12. **loki, petvity, surf-your-life, kivvi, substrata** have none. evig's runs
    only against production, only when secrets exist, and covers login only.
    No app tests an OIDC callback (OrangeCat, Google, GitHub or X). The
    shared-auth-journey covers sign-up, verification, recovery with session
    revocation, sign-out, passkeys, 2FA and the magic link, but no social or
    OIDC leg.
13. **No app tests that password and recovery access still work when the
    broker or OrangeCat is down.** That is required by the checklist item.

### Other

14. **Substrata answered 502** for its home page, its sign-in page and its auth
    API throughout the probe window on 2026-10-30.
15. OrangeCat OIDC clients are registered in `scripts/oauth/client-specs.ts`
    for Loki, Solon, Heidi, Skif, Substrata, evig, Petvity, Surf Your Life,
    Datacat and Causius. BiasLens, Diplodoctor, Hirnli, Kivvi, Vitareba and AOZ
    have no OrangeCat client. Any of those that should offer OrangeCat needs a
    registered client first.

## The shared social broker: status

**What it is.** It is the "shared bitbaum sign-in", defined in fleet `STACK.md`
→ "Identity" (2026-10-11) and in accountkit `src/auth/methods.ts`. It is one
OIDC service that holds the Google, GitHub, X, Meta and Apple credentials once
and speaks OIDC to every app. It issues a per-app (pairwise) subject and
creates no OrangeCat account. Apps reach it through `SIGNIN_ISSUER`,
`SIGNIN_CLIENT_ID` and `SIGNIN_CLIENT_SECRET`, with provider id
`bitbaum-signin` and the button label "Continue with Google, Apple, GitHub, X
or Facebook". STACK.md says: "The service is its own project; until it runs,
the button is simply absent."

**What it brokers today: nothing.**

- `bitbaum-signin` returns `PROVIDER_NOT_FOUND` on every AccountKit app that
  answered: biaslens, causius, diplodoctor, heidi, hirnli/revamp-info and solon.
- A repository search of the bitbaum org for `signin` found no repository.
  `SIGNIN_ISSUER` appears only in `.env.example` files and in the app
  templates.
- No fleet register names a host for it. A guessed `signin.orangecat.ch`
  failed the TLS handshake. That only shows the guess is not served; it does
  not show any intended host.

**What does social sign-in in practice.** OrangeCat. OrangeCat itself is
Supabase GoTrue with Google and GitHub working. Its live
`/api/auth/oauth-providers` returns `["google","github"]`. X is flagged on in
GoTrue but its credentials are broken (`docs/operations/oauth-social-login.md`
in orangecat, 2026-07-28), so it is hidden. LinkedIn and Facebook are not
configured, and Apple is intentionally not offered. Apps that show "Sign in with
OrangeCat" reach Google and GitHub through it: accountkit's
`authorizationParams` passes `idp_hint` (google, github), and OrangeCat's
`/oauth/authorize` honours it. This differs from the broker design in two ways:

- OrangeCat creates an OrangeCat account;
- its discovery advertises `subject_types_supported: ["public"]`, not
  pairwise subjects.

**Unfinished:**

- the service does not exist: no repository, host or deployment;
- no app has `SIGNIN_*` set;
- X does not work anywhere, neither at OrangeCat nor in Loki's own OAuth 1.0a
  path;
- Meta and Apple are configured nowhere;
- no app has a tested callback for any social provider;
- there is no outage fallback test.

The checklist item asks for provider secrets to live at the broker, with
issuer and subject mappings preserved. That needs a decision first: build the
`SIGNIN_*` service, or record OrangeCat as the broker. If OrangeCat becomes the
broker, the design rule "creates no OrangeCat account" has to be revisited.
Provider-console access (Google, X developer portal, Meta, Apple) is an
external dependency that this inventory could not check.

## Next steps, in priority order

1. **Stop advertising Loki's broken providers.** Either register
   `https://loki.orangecat.ch/api/auth/callback/google` in the Google console,
   or hide Google. Hide X until `/api/x-login/start` succeeds, and gate the
   button on a working request-token call, not on env presence alone. Then
   verify GitHub from a network that can see the IdP's answer.
2. **Restore Substrata (502)**, then re-run this probe on it.
3. **Give Diplodoctor, Heidi and Solon working account mail** (the
   mail-kit/Resend env on the box), so recovery, verification and the magic
   link appear. Then confirm delivery with an approved test identity.
4. **Decide recovery for Hirnli and Substrata.** Today they have mail off by
   design and no recovery. Either configure mail, or document why a forgotten
   password is acceptable for them.
5. **Petvity: gate Google on its env**, as Surf Your Life does, or configure
   it. Check whether any user row is linked only to Google, because such a user
   is locked out today.
6. **Make the broker decision** (see the broker section) and record it in
   `STACK.md`. Fix X at OrangeCat if OrangeCat stays the de facto broker.
7. **Add an OIDC callback leg to the shared-auth-journey**, using a local mock
   issuer with `client_secret_post` and PKCE. Also add a scenario where the
   broker or OrangeCat is unreachable and password sign-in and recovery still
   work.
8. **Wire a browser auth journey in CI** for loki, petvity, surf-your-life,
   kivvi and substrata. Make evig's run on every PR, not only against
   production.
9. **Move the NextAuth apps onto `@bitbaum/accountkit/auth`**: evig, kivvi,
   loki, petvity and surf-your-life. Switch Vitareba and AOZ from staged to
   live (`AUTH_RUNTIME=accountkit`) once their imports are proven. Drop Loki's
   email-based account linking as part of that move.
10. **Register OrangeCat clients** for any of biaslens, diplodoctor or hirnli
    that should offer OrangeCat. Set their `ORANGECAT_OAUTH_*` and confirm that
    the authorize leg is accepted.
11. **Fix fleet doc drift:** the STACK.md list of next-auth apps and the
    SHARED.md accountkit adopters.

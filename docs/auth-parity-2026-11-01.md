# Authentication parity: every app with a sign-in page (2026-11-01)

This updates [auth-parity-2026-10-30.md](auth-parity-2026-10-30.md). The owner's
rule, set on 2026-11-01: **every app offers every sign-in method on every auth
page** (sign-in, sign-up, recovery):

- email + password (EP);
- the emailed sign-in link (ML);
- passkey (PK);
- two-factor (2FA);
- password recovery (REC);
- "Continue with OrangeCat" (OC);
- "Continue with Google, Apple, GitHub, X or Facebook" (MOR). These providers
  come through Morulia, the shared sign-in at `https://morulia.orangecat.ch`
  (repo `bitbaum/morulia`, env `SIGNIN_ISSUER`/`SIGNIN_CLIENT_ID`/`SIGNIN_CLIENT_SECRET`).
  The button never says "Morulia".

The 10-30 matrix covered 16 apps. This one covers every non-archived
`bitbaum` repository that serves an app with a sign-in page, and lists those
that have none.

## How it was checked

The checks were the same, read-only, as on 10-30, now run by
`scripts/ci/auth-parity.mjs`. It made no account, submitted no credential and
sent no mail. For each app:

- **Shown.** Headless Chromium loaded the sign-in page at 390px and read the
  visible buttons, links and password fields. It ignored the header, the
  footer and the nav. The sign-up page was read too, for OC and MOR.
- **Configured.** The server was asked what it serves:
  - **AccountKit (better-auth):** an empty `POST` to the magic-link and
    `two-factor/verify-totp` endpoints, which answer a validation error when
    mounted and 404 when not, and `GET passkey/generate-authenticate-options`.
    Then `POST sign-in/social` for `orangecat` and `bitbaum-signin`.
  - **Auth.js, and AccountKit's Auth.js bridge:** `/api/auth/providers`, then
    `signin/<id>` with a CSRF token.
- **Authorize leg.** The IdP's authorize URL was requested once, without
  following the redirect. OrangeCat answering 307 to `/auth` means it accepted
  the client, the redirect URI, PKCE and the scopes.

Sources were read from each repo's default branch on origin, fetched on
2026-11-01. Hosts come from loki `scripts/hetzner/apps.conf` and live probes.
GitHub's repository list (all `bitbaum` repos the session can reach) was the
starting set.

**Changes since 10-30.**
- Diplodoctor, Solon and Heidi show recovery and the sign-in link: mail is on.
- kivvi, petvity, surf-your-life, evig and loki answer sign-in from AccountKit
  through its Auth.js bridge (`AUTH_RUNTIME=accountkit`, switched with loki's
  `accountkit-switch.yml`). Loki shows OrangeCat and email only.
- Substrata answers again; on 10-30 it returned 502.

## Matrix

*yes* = shown on the sign-in page; for 2FA, served by the server. *—* = neither
configured nor shown. *MISSING* = the server serves it, but the page does not
show it.

| App | Live sign-in page | Runtime | EP | ML | PK | 2FA | REC | OC | MOR | OC client | Morulia client |
|---|---|---|---|---|---|---|---|---|---|---|---|
| biaslens | biaslens.orangecat.ch/sign-in | AccountKit | yes | yes | yes | yes | yes | — | — | no → [orangecat#1523] | yes |
| causius | causius.orangecat.ch/de/sign-in | AccountKit | yes | yes | yes | yes | yes | yes | — | yes | yes |
| diplodoctor | diplodoctor.orangecat.ch/de/sign-in | AccountKit | yes | yes | yes | yes | yes | — | — | no → [orangecat#1523] | yes |
| heidi | heidi.orangecat.ch/de/sign-in | AccountKit | yes | yes | yes | yes | yes | yes | — | yes | yes |
| hirnli (and revamp-info) | hirnli.orangecat.ch/anmelden | AccountKit | yes | — | **MISSING** | yes | — | — | — | no → [orangecat#1523] | yes (hirnli host) |
| solon | solon.orangecat.ch/de/sign-in | AccountKit | yes | yes | yes | yes | yes | yes | — | yes | yes |
| substrata | substrata.orangecat.ch/sign-in | AccountKit | yes | — | yes | yes | — | yes | — | yes | yes |
| loki | loki.orangecat.ch/sign-in | AccountKit, Auth.js bridge | yes | — | — | — | yes | yes | — | yes | no → [morulia#21] |
| evig | evig.orangecat.ch/auth/login | AccountKit, Auth.js bridge | yes | — | — | — | — | yes | — | yes | no → [morulia#21] |
| kivvi | kivvi.orangecat.ch/login | AccountKit, Auth.js bridge | yes | — | — | — | yes | — | — | no → [orangecat#1523] | no → [morulia#21] |
| petvity | petvity.orangecat.ch/login | AccountKit, Auth.js bridge | yes | — | — | — | yes | yes | — | yes | no → [morulia#21] |
| surf-your-life | surf-your-life.orangecat.ch/de/login | AccountKit, Auth.js bridge | yes | — | — | — | yes | yes | — | yes | no → [morulia#21] |
| vitareba (Vita) | vita.orangecat.ch/de/login | Auth.js (AccountKit staged, off) | yes | — | — | — | yes | — | — | no → [orangecat#1523] | no → [morulia#21] |
| datacat | datacat.orangecat.ch/login | Auth.js | yes | — | — | — | — | yes | — | yes | no → [morulia#21] |
| skif | skif.orangecat.ch/de/signin | Auth.js, OrangeCat only | — | — | — | — | — | yes | — | yes | no → [morulia#21] |
| reparaturbonus-zh | reparaturbonus.orangecat.ch/auth/signin | Auth.js (Credentials) | yes | — | — | — | — | — | — | no → [orangecat#1523] | no → [morulia#21] |
| aoz-begleitung | aoz.orangecat.ch/login | own (`jose`); AccountKit staged, off | yes | yes (login code) | — | — | yes | — | — | no → [orangecat#1523] | no → [morulia#21] |
| botsmann | botsmann.orangecat.ch/auth/signin | Supabase GoTrue | yes | — | — | — | yes | — | — | no → [orangecat#1523] | no → [morulia#21] |
| printcraft | printcraft.orangecat.ch/login | Supabase GoTrue | yes | — | — | — | — | — | — | no → [orangecat#1523] | no → [morulia#21] |
| keller | not served (keller.orangecat.ch did not answer) | AccountKit (`@bitbaum/accountkit` ^0.14, better-auth) | ? | ? | ? | ? | ? | ? | ? | no → [orangecat#1523] | no → [morulia#21] |
| orangecat (the OC IdP) | orangecat.ch/auth | Supabase GoTrue | yes | yes (code) | — | — | yes | n/a | Google, GitHub (its own) | n/a | not a client |

**Sign-up pages.**
- OC is shown on the sign-up page of every app that shows it on sign-in.
- MOR is shown on no sign-up page, because no app has `SIGNIN_ISSUER` yet.

**Every OC button that is shown is accepted.** The authorize leg was accepted
for causius, heidi, solon, substrata, loki, evig, petvity, surf-your-life,
datacat and skif.

**Skif** has no password of its own. Its "Mit Google", "Mit GitHub" and email
entries all start OrangeCat's sign-in, with a provider or email hint
(`src/app/[locale]/(public)/signin/page.tsx`). The check counts them as OC.

**hirnli** serves passkeys and 2FA (the endpoints answer). Its own `AuthForm`
offers email and password only. This is the one live failure today.

**Morulia** is up (`/api/health`: database up, 7 of 7 clients active). It
lists **no provider**, so no app may show its button yet. Its button is not
shown on any app's sign-in page.

## No sign-in page

These repositories serve no page where a person signs in to an account:

| Repository | What it is |
|---|---|
| bitbaum | the studio site, static |
| sbb-fundbuero | a demo, no accounts |
| s-ink | sinktattoo.com, a portfolio |
| camille-boulangerie | a demo bakery site |
| farmhouse, zurich-sublet-compliance-concierge-service, Xhiva, hochhinhouse, hochhinhouse-party, derhochhinhousepartyrenner-ch-refresh-… | client and prospect sites, static |
| farmaciadelparco | a private preview behind one shared access code (`/accesso`), not an account |
| annushka | a static painter's site |
| center-com-2 | static (`index.html`) |
| truthseeker, zeitkastli | no auth code; their hosts did not answer |
| volt, hire | no app code; not served |
| ivy-portal | a localhost tool, not served |
| morulia | the broker itself: its page chooses a provider, it holds no accounts |
| accountkit, chartkit, chatkit, mail-kit and the other `*kit` repos, design-tokens, ai-forms, ai-kit, fleet, loki-releases, dotfiles, go-to-market, paykit, openclaw (fork), .github | packages, tooling or content |

`orangecat-2` is out of scope.

## Registration, after the PRs of 2026-11-01

**Morulia, [morulia#21].** `lib/clients.ts` lists all 20 apps above except
orangecat. Loki [loki#1533] adds the matching `pair:` rows to
`app-secrets.sh`. Once both are merged, `app-secrets.yml app=morulia
action=ensure` writes each secret to both sides. A client with no secret is
stored switched off.

**OrangeCat, [orangecat#1523].** It adds ten clients to
`scripts/oauth/client-specs.ts`: aoz-begleitung, biaslens, botsmann,
diplodoctor, hirnli, keller, kivvi, printcraft, reparaturbonus-zh and
vitareba. The deploy creates their rows switched off and with no secret.
`app-secrets.sh` kind `oc-client` ([loki#1533]) then does the rest, once per
app, with `app=<box app> action=ensure`:

- writes the app's `ORANGECAT_OAUTH_CLIENT_ID` and `_SECRET`;
- stores the secret's sha256 in the row;
- switches the row on.

Nothing is printed.

**Turning MOR on.** It waits until Morulia has a provider.
`app-secrets.yml action=signin-on app=<app>` (or `app=all`) adds
`SIGNIN_ISSUER` and `SIGNIN_CLIENT_ID` beside the paired secret, then
restarts the app. It refuses while `morulia.orangecat.ch/api/health` lists no
provider.

## What each app still lacks against the rule

An env value alone does not finish this. Several apps need code, which is the
per-app work:

- **MOR everywhere.** First the owner's provider keys on Morulia, then
  `signin-on`. AccountKit apps that use AccountKit's own screens (all but
  hirnli) show the button by themselves. The Auth.js
  bridge apps (loki, evig, kivvi, petvity, surf-your-life) need the bridge to
  list `bitbaum-signin` and their own pages to render it. The Auth.js,
  GoTrue and legacy apps need a provider or the AccountKit switch.
- **ML, PK and 2FA on the bridge apps** (loki, evig, kivvi, petvity,
  surf-your-life): AccountKit runs, but the bridge closes these routes and
  the products' own pages do not offer them.
- **hirnli:** PK is served but not shown. It has no ML and no REC, because
  mail is off in its source. It has no OC until its client is switched on.
- **substrata:** no ML and no REC; mail is off in its source.
- **OC** for biaslens and diplodoctor. AccountKit's screens show OC as soon
  as `ORANGECAT_OAUTH_*` is set, so `ensure` per app finishes it. hirnli and
  kivvi render their own sign-in pages and need the button added. For
  vitareba, reparaturbonus-zh, aoz-begleitung, botsmann, printcraft and keller,
  the app also needs code: an OC provider, or the AccountKit switch.
- **REC** is missing on evig, datacat, skif, reparaturbonus-zh and printcraft.
- **keller** is not served, so nothing about it could be seen live.

## The daily check

`.github/workflows/auth-parity.yml` runs `scripts/ci/auth-parity.mjs` every
day at 04:41 UTC, and on dispatch for chosen apps. The list of apps is
`scripts/ci/auth-parity.apps.json`, one row per app.

- The run fails on a method that is configured but not shown, on one that is
  shown but broken, and on a sign-in page that does not load.
- "Broken" covers an OIDC authorize the IdP refuses, a recovery link that does
  not load, and an OIDC button whose provider the server lacks.
- A method that is not configured yet is reported and does not fail.

The report goes to the run summary and to an artifact. Its verdicts are
pinned by `scripts/ci/auth-parity.test.mjs`, which ci.yml runs.

[morulia#21]: https://github.com/bitbaum/morulia/pull/21
[loki#1533]: https://github.com/bitbaum/loki/pull/1533
[orangecat#1523]: https://github.com/bitbaum/orangecat/pull/1523

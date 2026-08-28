# Fleet audit scripts

## `secret-in-response.py`

Reads what actually crossed the wire and reports credential material in it.

### Why this exists

FleetCrown shipped `passwordHash` and `privateZonePinHash` to the browser from
`GET /api/me` (fleetcrown#306). The fix included a static gate that reads route
handlers (`scripts/test/no-raw-user-response.ts`, fleetcrown#309) — and that gate
says in its own header what it cannot see: **RSC flight payloads**. A server
component handing a whole row to a client component serializes it into the HTML
exactly the same way, and no route handler is involved.

This scanner closes that half. It needs no knowledge of any app's schema, ORM or
framework, because it reads responses rather than code.

It has already earned its keep: on its first run across the fleet it found
`GET /api/admin/patients` in vitareba returning every patient's bcrypt digest —
a *cross-account* disclosure that the code-level sweep had missed, because that
route reads `db.query.users.findMany()` with no projection and the grep for
`json(user)` shapes does not match `json({ success, data })`.

### Severity is about what the finding lets an attacker do

| | meaning |
|---|---|
| `CRITICAL` | a live bearer credential — OAuth `access_token` / `refresh_token` / `id_token`, a session token. Possession **is** access, to a third party, right now. |
| `HIGH` | a credential digest — bcrypt/argon2/scrypt/PBKDF2, or a key named `password*`/`pin*`. Not access by itself, but it moves the secret from where nothing can read it to where everything can, and a low-entropy secret behind it (a numeric PIN) is a cheap offline job. |
| `MEDIUM` | a long value under a hash/secret/token-ish key. Often a CSRF nonce or a public share token by design — reported so it is looked at, not assumed to be a leak. |

### Usage

```bash
# unauthenticated — catches anything exposed without a login, costs nothing
python3 scripts/audit/secret-in-response.py \
  --base https://app.example --paths / /login /api/health

# authenticated — the real test; most interesting routes 401 without a session
python3 scripts/audit/secret-in-response.py \
  --base https://app.example \
  --cookie '__Secure-authjs.session-token=<token>' \
  --paths /dashboard /admin/users /api/me --json-out findings.json
```

Exit code is 1 if anything CRITICAL or HIGH was found, so it can gate CI.

### Getting a session for a self-hosted app

For NextAuth v5 apps on the box, mint a JWT rather than logging in — no data
written, no email sent:

```js
import { encode } from "@auth/core/jwt";
console.log(await encode({
  token: { id: "<uuid>", sub: "<uuid>", email: "...", /* + whatever the jwt callback sets */ },
  secret: process.env.SECRET,
  salt: "__Secure-authjs.session-token",   // the cookie name IS the salt
}));
```

**Two traps that cost real time here:**

1. **`.env` values may be single-quoted.** systemd's `EnvironmentFile` strips
   quotes; a naive `cut -d= -f2- | tr -d '"'` does not. The token then signs
   cleanly and the app answers `null`, which reads like a version mismatch.
   Settle it by comparing against the **running process**, not the file:
   ```bash
   PID=$(systemctl show -p MainPID --value <app>.service)
   sudo tr '\0' '\n' < /proc/$PID/environ | grep '^AUTH_SECRET='
   ```
2. **The app-specific claims matter.** Read the `jwt`/`session` callback and
   supply what it sets (`role`, `companyId`, `tokenVersion`, …) or the session
   resolves to something the guards reject.

### Its limits, stated

- It matches **key names and digest prefixes**. A credential stored under a name
  it does not know is invisible — aoz-wohnen's login credential is a `code`
  column holding `AOZ-XXXXXX`, which no pattern here would catch. For an app
  like that, pull the real values from the DB and grep the responses for them
  directly.
- It only reads the paths you give it. It is not a crawler.
- A clean run over N paths is evidence about **those N paths**, not a proof
  about the app.

### Self-test

```bash
python3 scripts/audit/test-secret-in-response.py
```

Every case is a shape observed in the fleet or one that must stay silent. Run it
after touching the patterns — a scanner nobody has watched fail is a scanner
that reports clean because it matches nothing.

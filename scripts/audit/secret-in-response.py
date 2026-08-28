#!/usr/bin/env python3
"""Scan HTTP response bodies for credential material that should never leave the server.

Why a response scanner and not a code scanner: the static gate in FleetCrown
(scripts/test/no-raw-user-response.ts) reads API route handlers, and it says so
in its own header that it cannot see RSC flight payloads — a server component
handing a whole row to a client component serializes it into the HTML just the
same. This reads what actually crossed the wire, so it covers both, and it needs
no knowledge of any app's schema or ORM.

Severity is about what the finding lets an attacker DO:

  CRITICAL  a live bearer credential — OAuth access/refresh/id_token, a session
            token. Possession IS access, to a third party's API, right now.
  HIGH      a credential digest — bcrypt/argon2/scrypt/PBKDF2, or a key literally
            named password*/pin*. Not access by itself, but it moves the secret
            from where nothing can read it to where everything can, and a
            low-entropy secret behind it (a numeric PIN) is a cheap offline job.
  MEDIUM    a long value under a hash/secret/token-ish key. Often a CSRF nonce or
            a public share token by design — reported so it is looked at, not
            assumed to be a leak.

Usage:
  secret-in-response.py --base https://app.example --paths / /dashboard \\
      [--cookie 'name=value'] [--json-out findings.json]
"""
import argparse, json, re, sys, urllib.error, urllib.request

# A live credential: holding it grants access somewhere, now.
BEARER_KEYS = re.compile(
    r'"((?:access|refresh|id)[_-]?token|sessionToken|session_token|providerAccountId_token)"\s*:\s*"([^"]{16,})"',
    re.I,
)
# A digest of a credential.
DIGEST_PREFIX = re.compile(r'\$(?:2[aby]|argon2[id]{1,2}|scrypt|pbkdf2)\$[^"\s]{8,}')
DIGEST_KEYS = re.compile(
    r'"((?:\w*password\w*|\w*passwd\w*|\w*pin)(?:hash)?|password_hash|pin_hash)"\s*:\s*"([^"]{8,})"',
    re.I,
)
# Suspicious but frequently legitimate.
SUSPECT_KEYS = re.compile(
    r'"(\w*(?:hash|secret|apikey|api_key|token)\w*)"\s*:\s*"([^"]{32,})"', re.I
)
# Keys that are legitimately long and public — excluded from MEDIUM to keep the
# signal readable. Each is a deliberate judgement, not a blanket mute.
BENIGN_KEYS = re.compile(
    r'^(csrf\w*|\w*csrf|shareToken|share_token|publicToken|inviteToken|'
    r'contentHash|entryHash|prevHash|lastHash|etag|integrity|nonce|'
    r'tokenPrefix|token_prefix|tokensUsed|tokenCount|token_count)$',
    re.I,
)

def redact(v: str) -> str:
    return v[:6] + "…" + v[-4:] + f" ({len(v)} chars)" if len(v) > 14 else "<short>"

def scan(body: str):
    out = []
    for m in BEARER_KEYS.finditer(body):
        out.append(("CRITICAL", m.group(1), redact(m.group(2))))
    for m in DIGEST_PREFIX.finditer(body):
        out.append(("HIGH", "<digest literal>", redact(m.group(0))))
    for m in DIGEST_KEYS.finditer(body):
        if m.group(2) not in ("null", "undefined", ""):
            out.append(("HIGH", m.group(1), redact(m.group(2))))
    for m in SUSPECT_KEYS.finditer(body):
        if not BENIGN_KEYS.match(m.group(1)):
            out.append(("MEDIUM", m.group(1), redact(m.group(2))))
    # One finding per key, at its highest severity: a repeated row is one leak,
    # and a key already reported as CRITICAL must not also appear as MEDIUM.
    rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2}
    best: dict[str, tuple[str, str, str]] = {}
    for sev, key, val in out:
        cur = best.get(key)
        if cur is None or rank[sev] < rank[cur[0]]:
            best[key] = (sev, key, val)
    return sorted(best.values(), key=lambda h: (rank[h[0]], h[1]))

def fetch(url: str, cookie: str | None, ua: str):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return None, f"<error: {e}>"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--paths", nargs="+", required=True)
    ap.add_argument("--cookie")
    ap.add_argument("--json-out")
    ap.add_argument("--ua", default="Mozilla/5.0 (secret-in-response audit)")
    a = ap.parse_args()

    findings, checked = [], 0
    for p in a.paths:
        url = a.base.rstrip("/") + p
        status, body = fetch(url, a.cookie, a.ua)
        if status is None:
            print(f"  ??  {p:38s} {body[:60]}")
            continue
        checked += 1
        hits = scan(body)
        if hits:
            worst = "CRITICAL" if any(h[0] == "CRITICAL" for h in hits) else \
                    "HIGH" if any(h[0] == "HIGH" for h in hits) else "MEDIUM"
            print(f"  {worst:8s} {status}  {p}")
            for sev, key, val in hits:
                print(f"        {sev:8s} {key} = {val}")
                findings.append({"path": p, "status": status, "severity": sev,
                                 "key": key, "value": val})
        else:
            print(f"  ok       {status}  {p}  ({len(body)} bytes)")

    print(f"\n  {checked} responses read, {len(findings)} finding(s)")
    if a.json_out:
        with open(a.json_out, "w") as f:
            json.dump(findings, f, indent=2)
    return 1 if any(f["severity"] in ("CRITICAL", "HIGH") for f in findings) else 0

if __name__ == "__main__":
    sys.exit(main())

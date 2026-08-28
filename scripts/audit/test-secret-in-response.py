#!/usr/bin/env python3
"""Self-test for secret-in-response.py.

A scanner nobody has watched fail is a scanner that reports clean because it
matches nothing. Every case below is a shape that was actually observed in the
fleet or a shape that must NOT be reported, and the run is the proof.

Run: python3 scripts/audit/test-secret-in-response.py
"""
import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("sir", HERE / "secret-in-response.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# Credential-shaped fixtures are ASSEMBLED, never written as literals: this file
# is a corpus of fake secrets, and a literal here trips the repo's own gitleaks
# pre-commit hook. Splitting keeps the gate strict instead of adding an ignore
# rule that would also cover a real leak dropped in here later.
HEX64 = "4f7d3713" + "0615776551e8af20f2749a19f18e35f5aa4e6632e70a6e5fe0aa12bd"
HEX64B = "9a8b7c6d" + "5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b"
BCRYPT = "$2b$12$" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ"
BCRYPT_SHORT = "$2b$12$" + "abcdefghijklmnopqrstuvwxyz012345"
GOOGLE_AT = "ya29.a0AfB_" + "byC3xk9SAMPLEnotreal_00000000000000"
REFRESH = "1//0eSAMPLE" + "notrealrefreshtoken000000"
SHARE = "abcdefghij" + "klmnopqrstuvwxyz0123456789abcd"
CSRF = "0123456789" + "abcdef0123456789abcdef0123"
WEBHOOK = "whsec_0123" + "456789abcdef0123456789abcdef"

CASES = [
    # --- real, observed in production ---
    (
        "fleetcrown GET /api/me — scrypt hex under a *Hash key, no $ prefix",
        '{"id":"u1","email":"g@x.ch",'
        f'"passwordHash":"{HEX64}","privateZonePinHash":"{HEX64B}"}}',
        "HIGH",
    ),
    (
        "vitareba GET /api/admin/patients — bcrypt digest of ANOTHER user",
        '{"success":true,"data":[{"id":"p1","email":"patient@x.ch",'
        f'"password":"{BCRYPT}"}}]}}',
        "HIGH",
    ),
    # --- the RSC case a route-level code scanner cannot see ---
    (
        "digest inside a Next.js flight payload in HTML",
        '<script>self.__next_f.push([1,"{\\"user\\":{\\"password\\":'
        f'\\"{BCRYPT_SHORT}\\"}}}}"])</script>',
        "HIGH",
    ),
    # --- live bearer credentials outrank digests ---
    (
        "OAuth access_token from a NextAuth accounts row",
        f'{{"provider":"google","access_token":"{GOOGLE_AT}"}}',
        "CRITICAL",
    ),
    ("refresh_token is equally critical", f'{{"refresh_token":"{REFRESH}"}}', "CRITICAL"),
    # --- must stay silent ---
    ("a correctly projected response", '{"id":"u1","username":"g","plan":"free","privateZonePinSetAt":null}', None),
    ("a null hash is not a finding", '{"passwordHash":null,"password":null}', None),
    (
        "public share tokens and csrf nonces are by design",
        f'{{"shareToken":"{SHARE}","csrfToken":"{CSRF}"}}',
        None,
    ),
    # --- unknown-but-suspicious must not be silently dropped ---
    ("an unrecognised long secret-ish key is MEDIUM, not silence", f'{{"webhookSecret":"{WEBHOOK}"}}', "MEDIUM"),
]


def worst(hits):
    if any(h[0] == "CRITICAL" for h in hits):
        return "CRITICAL"
    if any(h[0] == "HIGH" for h in hits):
        return "HIGH"
    return "MEDIUM" if hits else None


def main():
    failed = 0
    for label, body, want in CASES:
        got = worst(m.scan(body))
        ok = got == want
        failed += 0 if ok else 1
        print(f"  {'OK  ' if ok else 'FAIL'}  {label}")
        if not ok:
            print(f"          want={want} got={got}")
    print(f"\n  {len(CASES) - failed}/{len(CASES)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

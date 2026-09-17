#!/usr/bin/env python3
"""
Both directions of every rule in hardcoded-values-audit.py, against fixtures.

Pinning both directions is the point. A detector that never fires is
indistinguishable from a clean fleet — this one reported `arbitrary-hex 0`
across 44 repos on its first run, and that was only believable because a raw
grep agreed. And a detector that fires on everything gets muted, which is worse
than not having it: the comment carrying the history of an incident is correct
under the name it had then.

No fixture value is written literally where the register can supply it: the
retired strings come from registers/retired.json, the same way the audit reads
them. The rest are shapes, not real addresses.
"""
import importlib.util, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("audit", os.path.join(HERE, "hardcoded-values-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

passed = failed = 0


def ok(m):
    global passed
    passed += 1
    print(f"  ✓ {m}")


def bad(m):
    global failed
    failed += 1
    print(f"  ✗ {m}")


def cats(line, fn="a.ts"):
    return {c for c, _ in audit.findings_for_line(line, fn, TERMS)}


TERMS = audit.retired_terms()
RETIRED_ONE = TERMS[0][0]  # longest retired string in the register

# ── each rule fires on its own shape ────────────────────────────────────────
if "retired-value" in cats(f'const host = "{RETIRED_ONE}";'):
    ok("a retired value from the register is found")
else:
    bad("a retired value from the register was NOT found")

if "public-ip" in cats("ssh ubuntu@203.0.114.9 echo hi"):
    ok("a public IPv4 in source is found")
else:
    bad("a public IPv4 was not found")

if "home-path" in cats('const p = "/home/someone/dev/thing";'):
    ok("an absolute /home/<user> path is found")
else:
    bad("an absolute home path was not found")

if "home-path" in cats('const p = "/Users/someone/dev/thing";'):
    ok("a macOS /Users/<user> path is found too")
else:
    bad("a /Users/<user> path was not found")

if "consumer-email" in cats("const to = 'someone@gmail.com';"):
    ok("a consumer mail address in source is found")
else:
    bad("a consumer mail address was not found")

if "arbitrary-hex" in cats('<div className="bg-[#ff5c00]" />', "a.tsx"):
    ok("an arbitrary hex class is found in a .tsx")
else:
    bad("an arbitrary hex class was not found")

# ── and stays silent where a literal is correct ─────────────────────────────
if "public-ip" in cats("listen 127.0.0.1:8899"):
    bad("loopback was reported as a public address")
else:
    ok("loopback is not a finding")

for private in ("10.0.0.4", "192.168.1.10", "172.16.0.9"):
    if "public-ip" in cats(f"host {private}"):
        bad(f"private range {private} was reported")
        break
else:
    ok("private ranges are not findings")

if "public-ip" in cats('const version = "4.256.1.9";'):
    bad("a version-like string was read as an address")
else:
    ok("a version-like string is not an address")

if "arbitrary-hex" in cats('<div className="bg-[#ff5c00]" />', "a.ts"):
    bad("hex classes were hunted outside markup files")
else:
    ok("hex classes are only hunted in markup files")

if "home-path" in cats('import X from "@/components/home/sections";'):
    bad("an import path containing /home/ was read as a home directory")
else:
    ok("an import or URL segment named home is not a home directory")

if "home-path" in cats('default_cwd "/home/someone"'):
    ok("a home path that ENDS at the user is found — requiring a trailing slash lost one")
else:
    bad("a home path with no trailing slash was missed")

if "home-path" in cats('<Route path="/home/value-added-tax.html" />'):
    bad("a URL route under /home/ was read as a home directory")
else:
    ok("a dotted segment is a file or route, not a user")

if "home-path" in cats('BOX_LOKI="/home/ubuntu/dev/loki"'):
    bad("the box's own service account path was reported")
else:
    ok("a service account home (/home/ubuntu) is the box, not one person's machine")

if "public-ip" in cats('  "198.18.0.0/15",'):
    bad("a CIDR range in a data table was read as a host")
else:
    ok("a CIDR range is data, not a connection")

if "public-ip" in cats('const ALLOCATIONS = ["100.64.0.0", "131.0.0.0"];'):
    bad("an allocation table was read as a connection")
else:
    ok("an address with no connection context is not a finding")

# ── comments are history, not drift ─────────────────────────────────────────
def scan_tmp(files, allow=None, repo="fixture"):
    used = set()
    with tempfile.TemporaryDirectory() as d:
        base = os.path.join(d, repo)
        for rel, body in files.items():
            p = os.path.join(base, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(body)
        found = audit.scan_tree(repo, base, allow or {}, used, TERMS)
    return found, used


found, _ = scan_tmp({"a.ts": f'// the host was {RETIRED_ONE} until it moved\nconst x = 1;\n'})
if found:
    bad(f"a line comment recording history was reported: {found[0]['category']}")
else:
    ok("a line comment recording history is not a finding")

found, _ = scan_tmp({"a.ts": f'/*\n * it was {RETIRED_ONE} then.\n */\nconst x = 1;\n'})
if found:
    bad("a line INSIDE a block comment was reported")
else:
    ok("a line inside a block comment is not a finding — v1 missed this and flagged CSS prose")

found, _ = scan_tmp({"a.html": f'<!--\n{RETIRED_ONE}\n-->\n<p>hi</p>\n'})
if found:
    bad("a line inside an HTML comment was reported")
else:
    ok("a line inside an HTML comment is not a finding")

# ── tiers, registers, allowlist ─────────────────────────────────────────────
found, _ = scan_tmp({"scripts/test/thing.ts": f'const h = "{RETIRED_ONE}";\n'})
if found and found[0]["tier"] == "test":
    ok("a fixture under a test path is counted in the test tier")
else:
    bad(f"test tier not detected: {found}")

found, _ = scan_tmp({"src/a.ts": 'const ip = "203.0.114.9";\n'})
if found and found[0]["tier"] == "runtime":
    ok("runtime code is counted in the runtime tier")
else:
    bad("runtime tier not detected")

found, _ = scan_tmp({"scripts/hetzner/_box-env.sh": 'HETZNER_IP="203.0.114.9"\n'})
if found:
    bad("the register that OWNS the address was reported as duplicating it")
else:
    ok("a register holding the canonical address is not a finding")

allow = {("fixture", "src/a.ts", "public-ip"): "deliberate, for the test"}
found, used = scan_tmp({"src/a.ts": 'const ip = "203.0.114.9";\n'}, allow)
if found:
    bad("an allowlisted finding was still reported")
elif used == set(allow):
    ok("an allowlisted finding is suppressed AND its entry marked used")
else:
    bad("allowlist entry was not marked used — stale entries could never be detected")

allow = {("fixture", "src/nothing-here.ts", "public-ip"): "matches nothing"}
found, used = scan_tmp({"src/a.ts": "const x = 1;\n"}, allow)
if used:
    bad("an allowlist entry matching nothing was marked used")
else:
    ok("an allowlist entry matching nothing stays unused, so the ratchet can report it")

# ── a clean tree is clean ───────────────────────────────────────────────────
found, _ = scan_tmp({"src/a.ts": "export const x = 1;\n", "README.md": f"{RETIRED_ONE}\n"})
if found:
    bad(f"a clean tree produced findings: {found}")
else:
    ok("a clean tree is clean, and markdown is left to org-drift")

print()
print(f"test-hardcoded-values-audit: {passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)

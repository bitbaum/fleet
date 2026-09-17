#!/usr/bin/env python3
"""
Fleet audit: a value copied into code that already has one home.

WHY THIS EXISTS

Renaming bitbaum/aoz-housing on 2026-09-15 took four PRs across three repos and
still missed things, because the name had been copied into places nothing
connects: a package name, a GitHub URL builder, a seed map, a site override key,
a JSON key in another repo entirely. None of it broke loudly. A retired host
answers 308, a renamed repo redirects, a stale slug still matches until the day
it does not — so every copy looked healthy right up to the moment it was wrong.

The first full sweep, 2026-09-15, found 478 of these across 16 repos, including
a retired product name serving on loki.orangecat.ch's public footer and a seed
script that would have written two retired hosts into the database.

WHAT COUNTS

A literal is a finding only when it duplicates something that already has a
source of truth, or is simply wrong:

  retired-value    anything registers/retired.json says is retired — hosts,
                   product names, repo names, accounts. The register is the
                   list; this file holds none of those strings itself.
  public-ip        a public IPv4 in source. The box address lives once, in loki
                   scripts/hetzner/_box-env.sh, and in Actions as the org
                   variable HETZNER_IP.
  home-path        an absolute /home/<user> or /Users/<user> path — one
                   person's machine baked into shared code. DEV_ROOT and the
                   running user's own home are the answers.
  consumer-email   an address at a consumer mail provider, in source. Contact
                   addresses belong in config the operator can change.
  arbitrary-hex    a Tailwind `[#rrggbb]` class. globals.css tokens are the
                   SSOT, per the house rule.

THIS FILE DELIBERATELY CONTAINS NO EXAMPLE OF WHAT IT HUNTS. An audit that
hardcoded the IP and the operator's address in order to find them would be the
very bug it reports — and, in a public repo, would publish the address too. The
retired strings come from the register; everything else is a generic shape.

WHAT IS NOT A FINDING

  - comments, including block comments. The history of an incident is correct
    under the name it had at the time, and rewriting it would falsify a record.
  - markdown and docs: org-drift-audit.sh already polices those.
  - registers, *.allow, *.baseline, .mailmap, lockfiles: they ARE the source.
  - entries in hardcoded-values.allow, each with a REASON. An entry matching
    nothing is reported too — an allowlist that cannot shrink is a ratchet that
    cannot fall.
  - test fixtures, counted in their own tier and kept out of the ratchet: a
    fixture reproducing a past incident is not a stale value being shipped.

    hardcoded-values-audit.py [--check] [--src DIR] [--no-fetch] [--repo NAME]
                              [--files CATEGORY] [--emit-baseline]
"""
import argparse, collections, fnmatch, io, json, os, re, shutil, subprocess, sys, tarfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RETIRED = os.path.join(ROOT, "registers", "retired.json")
ALLOW = os.path.join(HERE, "hardcoded-values.allow")
BASELINE = os.path.join(HERE, "hardcoded-values.baseline")
OWNER = os.environ.get("GH_OWNER", "bitbaum")

SKIP_DIRS = {".git", "node_modules", "dist", "build", ".next", "coverage", "vendor", ".turbo", "out"}
SKIP_EXT = (".lock", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".map",
            ".woff", ".woff2", ".ttf", ".mp4", ".zip", ".gz", ".md", ".mdx", ".min.js")
SKIP_NAMES = {"pnpm-lock.yaml", "package-lock.json", "yarn.lock", ".mailmap", ".sweep-sha"}
C_STYLE = (".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".scss", ".less", ".go", ".java",
           ".c", ".h", ".cpp", ".rs", ".swift", ".kt", ".dart", ".vue", ".svelte", ".astro")
HTML_STYLE = (".html", ".htm", ".xml", ".vue", ".svelte", ".astro")
HEX_EXT = (".tsx", ".jsx", ".html", ".vue", ".svelte", ".astro")
MAX_BYTES = 1_000_000

TEST_RE = re.compile(r"(^|/)(tests?|__tests__|e2e|spec|fixtures?)(/|$)"
                     r"|\.(test|spec)\.[a-z]+$"
                     r"|(^|/)test[-_][^/]*$")
LINE_COMMENT = re.compile(r"^\s*(//|#|\*|--\s|;)")

# Private, loopback, link-local, multicast, documentation and version-ish runs.
PRIVATE_IP = re.compile(r"^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|"
                        r"192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|22[4-9]\.|23\d\.|255\.)")
IPV4 = re.compile(r"(?<![\w.])((?:\d{1,3}\.){3}\d{1,3})(?![\w.])")
# Only an address something CONNECTS to. Without this the rule reports CIDR and
# allocation tables — the first sweep surfaced 198.18.0.0, 100.64.0.0 and
# 255.255.255.255, which are data, not a duplicated box address.
CONNECTS = re.compile(r"ssh|scp|rsync|curl|wget|keyscan|ping\b|host|BOX|DEPLOY|SERVER|_IP\b|\bip\s*[:=]", re.I)
# A home DIRECTORY, not a URL or import segment. `@/components/home/sections`
# and `/home/value-added-tax.html` are routes, and the first sweep reported both
# as findings. Service accounts are excluded too: /home/ubuntu and /home/fcrunner
# ARE the box, and _box-env.sh owns those paths. The finding is ONE PERSON's
# machine appearing in code other people run.
SERVICE_USERS = {"ubuntu", "root", "runner", "node", "nextjs", "www-data", "fcrunner",
                 "linuxbrew", "app", "you"}
# The path may END at the user (`default_cwd "/home/g"`), so a trailing slash
# cannot be required — demanding one lost exactly that line. A segment carrying
# a dot is a FILE, not a user: `/home/value-added-tax.html` and
# `/home/HomePublic.tsx` are routes and components, and both were reported once.
HOME_PATH = re.compile(r"(?<![\w/.-])(?:/home/|/Users/)([A-Za-z0-9_-]+)(?=/|[\"'\s,);]|$)")
CONSUMER_MAIL = re.compile(r"[A-Za-z0-9._%+-]+@(gmail|googlemail|outlook|hotmail|yahoo|icloud|gmx|proton|protonmail)\.[a-z.]{2,}", re.I)
HEX_CLASS = re.compile(r"\[#[0-9a-fA-F]{3,8}\]")

CATS = ["retired-value", "public-ip", "home-path", "consumer-email", "arbitrary-hex"]
SHORT = {"retired-value": "retired", "public-ip": "ip", "home-path": "home",
         "consumer-email": "email", "arbitrary-hex": "hex"}


def gh(args, binary=False):
    return subprocess.run(["gh"] + args, capture_output=True, text=not binary)


def is_truth(rel):
    """Files that ARE a source of truth, exempt from every category."""
    return (rel.endswith((".allow", ".baseline")) or rel.endswith("retired.json")
            or rel.endswith("org-drift-inventory.txt"))


def is_register(rel):
    """A register holds the canonical copy of an address; only a RETIRED value in one is wrong."""
    return rel.startswith("registers/") or rel in ("scripts/hetzner/apps.conf",
                                                   "scripts/hetzner/_box-env.sh")


def retired_terms(path=RETIRED):
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)["retired"]
    # Sorted longest-first so a specific host matches before a bare name inside it.
    return sorted(((r["from"], f'retired {r["kind"]} -> "{r["to"]}"') for r in rows),
                  key=lambda t: -len(t[0]))


def load_allow(path=ALLOW):
    entries = {}
    if not os.path.exists(path):
        return entries
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|", 3)]
            if len(parts) < 4 or not parts[3]:
                sys.exit(f"hardcoded-values.allow: every entry needs repo|path|category|REASON — got: {line}")
            entries[tuple(parts[:3])] = parts[3]
    return entries


def allowed(allow, repo, rel, cat):
    for key in allow:
        if key[0] == repo and key[2] == cat and fnmatch.fnmatch(rel, key[1]):
            return key
    return None


def code_lines(text, fn):
    """Yield (lineno, line) for lines that are not inside a comment."""
    in_block = in_html = False
    c_style, html_style = fn.endswith(C_STYLE), fn.endswith(HTML_STYLE)
    for n, line in enumerate(text.splitlines(), 1):
        s = line
        if c_style:
            if in_block:
                if "*/" not in s:
                    continue
                s, in_block = s.split("*/", 1)[1], False
            while "/*" in s:
                head, tail = s.split("/*", 1)
                if "*/" in tail:
                    s = head + tail.split("*/", 1)[1]
                else:
                    s, in_block = head, True
                    break
        if html_style:
            if in_html:
                if "-->" not in s:
                    continue
                s, in_html = s.split("-->", 1)[1], False
            while "<!--" in s:
                head, tail = s.split("<!--", 1)
                if "-->" in tail:
                    s = head + tail.split("-->", 1)[1]
                else:
                    s, in_html = head, True
                    break
        if not s.strip() or LINE_COMMENT.match(s):
            continue
        yield n, s


def findings_for_line(line, fn, terms):
    """Every category this line trips, as (category, why)."""
    out = []
    for term, why in terms:
        if term in line:
            out.append(("retired-value", why))
            break  # one retired value per line is the finding; listing each is noise
    if CONNECTS.search(line):
        for m in IPV4.finditer(line):
            ip = m.group(1)
            if PRIVATE_IP.match(ip):
                continue
            if any(int(part) > 255 for part in ip.split(".")):
                continue  # a version string, not an address
            if line[m.end():m.end() + 1] == "/":
                continue  # CIDR notation: a range, not a host
            out.append(("public-ip", "public IPv4 in a connection — the box address has one home"))
            break
    hm = HOME_PATH.search(line)
    if hm and hm.group(1) not in SERVICE_USERS:
        out.append(("home-path", "one person's home directory — use DEV_ROOT or the running user's home"))
    if CONSUMER_MAIL.search(line):
        out.append(("consumer-email", "consumer mail address in source — belongs in config"))
    if fn.endswith(HEX_EXT) and HEX_CLASS.search(line):
        out.append(("arbitrary-hex", "arbitrary hex class — use a globals.css token"))
    return out


def scan_tree(repo, base, allow, used, terms):
    out = []
    for dp, dns, fns in os.walk(base):
        dns[:] = [d for d in dns if d not in SKIP_DIRS and not d.startswith(".claude")]
        for fn in fns:
            if fn in SKIP_NAMES or fn.endswith(SKIP_EXT):
                continue
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, base)
            if is_truth(rel):
                continue
            try:
                if os.path.getsize(full) > MAX_BYTES:
                    continue
                with open(full, "rb") as fh:
                    raw = fh.read()
            except OSError:
                continue
            if b"\x00" in raw[:4096]:
                continue
            text = raw.decode("utf-8", "replace")
            register, tier = is_register(rel), ("test" if TEST_RE.search(rel) else "runtime")
            for n, line in code_lines(text, fn):
                for cat, why in findings_for_line(line, fn, terms):
                    if register and cat != "retired-value":
                        continue
                    key = allowed(allow, repo, rel, cat)
                    if key:
                        used.add(key)
                        continue
                    out.append({"repo": repo, "file": rel, "line": n, "category": cat,
                                "tier": tier, "why": why, "text": line.strip()[:160]})
    return out


def fetch_repos(dest):
    """Snapshot every non-fork, non-archived repo's default branch. Forks are skipped:
    a fork's upstream fixtures are not ours and flooded an earlier detector."""
    os.makedirs(dest, exist_ok=True)
    r = gh(["repo", "list", OWNER, "--limit", "200", "--no-archived",
            "--json", "name,isFork,defaultBranchRef"])
    if r.returncode != 0:
        sys.exit(f"could not list repos: {r.stderr[:200]}")
    names, failed = [], []
    for x in sorted((x for x in json.loads(r.stdout) if not x["isFork"]), key=lambda x: x["name"]):
        name = x["name"]
        branch = (x.get("defaultBranchRef") or {}).get("name") or "main"
        s = gh(["api", f"repos/{OWNER}/{name}/commits/{branch}", "--jq", ".sha"])
        sha = s.stdout.strip()
        if s.returncode != 0 or len(sha) != 40:
            failed.append((name, "no sha"))
            continue
        out = os.path.join(dest, name)
        stamp = os.path.join(out, ".sweep-sha")
        if os.path.exists(stamp) and open(stamp).read().strip() == sha:
            names.append(name)
            continue
        t = gh(["api", f"repos/{OWNER}/{name}/tarball/{sha}"], binary=True)
        if t.returncode != 0 or t.stdout[:2] != b"\x1f\x8b":
            failed.append((name, "tarball unreadable"))
            continue
        if os.path.isdir(out):
            shutil.rmtree(out)
        os.makedirs(out)
        with tarfile.open(fileobj=io.BytesIO(t.stdout), mode="r:gz") as tar:
            members = []
            for m in tar.getmembers():
                parts = m.name.split("/", 1)
                if len(parts) < 2 or not parts[1] or not (m.isfile() or m.isdir()):
                    continue
                if m.isfile() and m.size > MAX_BYTES:
                    continue
                m.name = parts[1]
                members.append(m)
            tar.extractall(out, members=members, filter="data")
        with open(stamp, "w") as fh:
            fh.write(sha)
        names.append(name)
    return names, failed


def read_baseline(path=BASELINE):
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            cat, count = line.split()
            out[cat] = int(count)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--src", default=os.environ.get("HARDCODE_SRC") or
                    os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "hardcoded-sweep"))
    ap.add_argument("--no-fetch", action="store_true")
    ap.add_argument("--repo")
    ap.add_argument("--files")
    ap.add_argument("--emit-baseline", action="store_true")
    a = ap.parse_args()

    failed = []
    if a.no_fetch:
        repos = sorted(d for d in os.listdir(a.src) if os.path.isdir(os.path.join(a.src, d)))
    else:
        repos, failed = fetch_repos(a.src)
    if a.repo:
        repos = [a.repo]
    if not repos:
        # A sweep that read nothing must never read as a clean sweep.
        print("⊘ hardcoded-values SKIPPED — no repos were scanned.", file=sys.stderr)
        sys.exit(1)

    allow, used, terms = load_allow(), set(), retired_terms()
    findings = []
    for repo in repos:
        findings += scan_tree(repo, os.path.join(a.src, repo), allow, used, terms)

    runtime = [f for f in findings if f["tier"] == "runtime"]
    totals = collections.Counter(f["category"] for f in runtime)

    if a.emit_baseline:
        with open(BASELINE, "w", encoding="utf-8") as fh:
            fh.write("# Runtime findings per category. A RATCHET: it may fall, never rise.\n"
                     "# Regenerate deliberately with --emit-baseline, in the PR that lowers it.\n")
            for c in CATS:
                fh.write(f"{c} {totals[c]}\n")
        print(f"wrote {BASELINE}")

    print(f"hardcoded values: {len(runtime)} runtime findings across {len(repos)} repo(s) "
          f"(+{len(findings) - len(runtime)} in tests, not ratcheted)\n")
    by = collections.defaultdict(collections.Counter)
    for f in findings:
        by[f["repo"]][(f["category"], f["tier"])] += 1
    print(f"  {'repo':24} " + " ".join(f"{SHORT[c]:>8}" for c in CATS))
    for repo in sorted(by, key=lambda r: (-sum(v for (c, t), v in by[r].items() if t == "runtime"), r)):
        cells = []
        for c in CATS:
            rt, te = by[repo][(c, "runtime")], by[repo][(c, "test")]
            cells.append(f"{(f'{rt}' + (f'({te})' if te else '')) if (rt or te) else '·':>8}")
        print(f"  {repo:24} " + " ".join(cells))
    print("\n  runtime totals: " + ", ".join(f"{SHORT[c]} {totals[c]}" for c in CATS))

    if a.files:
        for f in [x for x in runtime if x["category"] == a.files]:
            print(f"    {f['repo']}/{f['file']}:{f['line']}: {f['text'][:110]}")

    for name, why in failed:
        print(f"  COULD NOT READ (not a verdict): {name}: {why}")

    stale = [k for k in allow if k not in used and (not a.repo or k[0] == a.repo)]
    if stale and not a.repo:
        print(f"\n  ✗ {len(stale)} allowlist entr(y/ies) matched nothing — delete them:")
        for k in stale:
            print(f"      {'|'.join(k)}")

    if not a.check:
        return
    base = read_baseline()
    risen = [(c, totals[c], base[c]) for c in CATS if c in base and totals[c] > base[c]]
    if failed or stale or risen:
        print()
        for c, now, was in risen:
            print(f"✗ {c}: {now} > baseline {was} — a value with one home was copied again.")
        if failed:
            print("✗ some repos could not be read; this run does not describe the fleet.")
        if stale:
            print("✗ the allowlist has entries matching nothing.")
        sys.exit(1)
    print("\n✓ no category rose above its baseline.")


if __name__ == "__main__":
    main()

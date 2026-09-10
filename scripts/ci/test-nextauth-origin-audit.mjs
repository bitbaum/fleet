#!/usr/bin/env node
/**
 * Self-test for nextauth-origin-audit.mjs.
 * Run: node scripts/ci/test-nextauth-origin-audit.mjs
 *
 * This detector exists because a fix REVERTED unnoticed. A detector that
 * silently stops detecting reverts the same way: it keeps printing ✓ over a
 * broken fleet, and a clean report from a dead check is worse than no check,
 * because somebody believes it.
 *
 * So every fixture asserts a VERDICT, and both sides are pinned:
 *   - petvity's real 2026-09-10 regression is still caught       (positive)
 *   - petvity's real repaired payload stays silent               (negative)
 *   - a 500 from a next-auth app FAILS, never "no data, move on"
 *   - a site that is not a next-auth app SKIPs, never FAILs
 *   - a legitimate redirect is judged against the host that answered
 *
 * Fixtures are captured payloads, inline. No network, no box, no secret — and
 * nothing here touches a production env, which is the one way this check could
 * do harm while proving itself.
 */
import { judge, advertisedUrls, looksLikeProviders, report } from "./nextauth-origin-audit.mjs";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
    failures++;
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

// petvity as it was serving on 2026-09-10: NEXTAUTH_URL absent from
// /opt/petvity/shared/.env, so next-auth resolved against the internal origin
// and published the port systemd binds. Google sign-in could not complete.
const PETVITY_BROKEN = {
  google: {
    id: "google",
    name: "Google",
    type: "oidc",
    signinUrl: "https://localhost:4013/api/auth/signin/google",
    callbackUrl: "https://localhost:4013/api/auth/callback/google",
  },
  credentials: {
    id: "credentials",
    name: "Credentials",
    type: "credentials",
    signinUrl: "https://localhost:4013/api/auth/signin/credentials",
    callbackUrl: "https://localhost:4013/api/auth/callback/credentials",
  },
};

// The same endpoint after NEXTAUTH_URL was pinned and the unit restarted —
// captured verbatim the same day.
const PETVITY_FIXED = {
  google: {
    id: "google",
    name: "Google",
    type: "oidc",
    signinUrl: "https://petvity.orangecat.ch/api/auth/signin/google",
    callbackUrl: "https://petvity.orangecat.ch/api/auth/callback/google",
  },
  credentials: {
    id: "credentials",
    name: "Credentials",
    type: "credentials",
    signinUrl: "https://petvity.orangecat.ch/api/auth/signin/credentials",
    callbackUrl: "https://petvity.orangecat.ch/api/auth/callback/credentials",
  },
};

// datacat, 2026-09-10: authOptions has no `secret:`, so every /api/auth/*
// route 500s while the rest of the site renders fine.
const DATACAT_500 = { message: "There is a problem with the server configuration. Check the server logs for more information." };

// Most of the fleet: a Next app with no next-auth. The route does not exist,
// so Next serves its 404 page as HTML.
const NOT_NEXTAUTH_HTML = null;

const state = (p) => judge(p).state;

// ── The regression this check was built for ──────────────────────────────────

check(
  "petvity's localhost regression is caught",
  state({ site: "https://petvity.orangecat.ch", status: 200, finalUrl: "https://petvity.orangecat.ch/api/auth/providers", payload: PETVITY_BROKEN }),
  "fail",
);

check(
  "...and the message names the offending URL, not just 'mismatch'",
  judge({ site: "https://petvity.orangecat.ch", status: 200, finalUrl: "https://petvity.orangecat.ch/api/auth/providers", payload: PETVITY_BROKEN })
    .detail.includes("https://localhost:4013/api/auth/signin/google"),
  true,
);

check(
  "the repaired payload stays silent",
  state({ site: "https://petvity.orangecat.ch", status: 200, finalUrl: "https://petvity.orangecat.ch/api/auth/providers", payload: PETVITY_FIXED }),
  "pass",
);

// One wrong provider among correct ones must still fail — the first draft of
// this class of check looked only at the first entry, and credentials-only
// apps are correct while their OAuth provider is not.
check(
  "one wrong provider among right ones fails",
  state({
    site: "https://x.orangecat.ch",
    status: 200,
    finalUrl: "https://x.orangecat.ch/api/auth/providers",
    payload: { ...PETVITY_FIXED, google: PETVITY_BROKEN.google },
  }),
  "fail",
);

// A foreign but non-local host is the same bug wearing a different hat: a
// stale NEXTAUTH_URL copied from another app's env.
check(
  "a wrong PUBLIC host fails too, not just localhost",
  state({
    site: "https://vitareba.orangecat.ch",
    status: 200,
    finalUrl: "https://vitareba.orangecat.ch/api/auth/providers",
    payload: { credentials: { id: "credentials", signinUrl: "https://kivvi.orangecat.ch/api/auth/signin/credentials", callbackUrl: "https://kivvi.orangecat.ch/api/auth/callback/credentials" } },
  }),
  "fail",
);

check(
  "http where https is served fails — the origin includes the scheme",
  state({
    site: "https://x.orangecat.ch",
    status: 200,
    finalUrl: "https://x.orangecat.ch/api/auth/providers",
    payload: { credentials: { id: "credentials", signinUrl: "http://x.orangecat.ch/api/auth/signin/credentials", callbackUrl: "http://x.orangecat.ch/api/auth/callback/credentials" } },
  }),
  "fail",
);

// ── An app that cannot answer is broken, not absent ──────────────────────────

check(
  "a 500 from next-auth FAILS (datacat's missing secret)",
  state({ site: "https://datacat.orangecat.ch", status: 500, finalUrl: "https://datacat.orangecat.ch/api/auth/providers", payload: DATACAT_500 }),
  "fail",
);

check(
  "...and says so, so the reader is not left guessing",
  judge({ site: "https://datacat.orangecat.ch", status: 500, finalUrl: "https://datacat.orangecat.ch/api/auth/providers", payload: DATACAT_500 })
    .detail.includes("cannot answer"),
  true,
);

// ── Quiet where it should be quiet ───────────────────────────────────────────

check(
  "a site without next-auth SKIPs, it does not FAIL",
  state({ site: "https://heidi.orangecat.ch", status: 404, finalUrl: "https://heidi.orangecat.ch/api/auth/providers", payload: NOT_NEXTAUTH_HTML }),
  "skip",
);

check(
  "a 200 catch-all page SKIPs — a page is not a providers route",
  state({ site: "https://x.orangecat.ch", status: 200, finalUrl: "https://x.orangecat.ch/api/auth/providers", payload: null, body: "<!DOCTYPE html>" }),
  "skip",
);

check(
  "an unreachable site SKIPs and says why — never a silent pass",
  judge({ site: "https://gone.orangecat.ch", status: 0, error: "getaddrinfo ENOTFOUND" }),
  { site: "https://gone.orangecat.ch", state: "skip", detail: "unreachable (getaddrinfo ENOTFOUND) — uptime's class, not this one" },
);

// A redirect is judged against the host that ANSWERED. aoz-wohnen.orangecat.ch
// 301s to aoz.orangecat.ch; expecting the requested host would invent a
// failure on every correctly-configured tenant alias.
check(
  "a followed redirect is judged against the final origin",
  state({
    site: "https://aoz-wohnen.orangecat.ch",
    status: 200,
    finalUrl: "https://aoz.orangecat.ch/api/auth/providers",
    payload: { credentials: { id: "credentials", signinUrl: "https://aoz.orangecat.ch/api/auth/signin/credentials", callbackUrl: "https://aoz.orangecat.ch/api/auth/callback/credentials" } },
  }),
  "pass",
);

// ── The parsing helpers, pinned separately ───────────────────────────────────

check("advertisedUrls finds both keys of both providers", advertisedUrls(PETVITY_FIXED).length, 4);
check("looksLikeProviders rejects an array", looksLikeProviders([1, 2, 3]), false);
check("looksLikeProviders rejects null", looksLikeProviders(null), false);
check("looksLikeProviders rejects an error body", looksLikeProviders(DATACAT_500), false);
check(
  "a provider carrying no absolute URLs is not a providers object",
  looksLikeProviders({ credentials: { id: "credentials", name: "Credentials" } }),
  false,
);

// ── The report must show the failure, not bury it ────────────────────────────

const rendered = report([
  judge({ site: "https://petvity.orangecat.ch", status: 200, finalUrl: "https://petvity.orangecat.ch/api/auth/providers", payload: PETVITY_BROKEN }),
  judge({ site: "https://heidi.orangecat.ch", status: 404, payload: null }),
]);
check("the report names the fix", rendered.includes("NEXTAUTH_URL"), true);
check("the report warns that AUTH_TRUST_HOST is not it", rendered.includes("AUTH_TRUST_HOST"), true);
check("the report counts the failure", rendered.includes("1 fail"), true);

console.log(failures === 0 ? "\nnextauth-origin audit self-test: all green" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

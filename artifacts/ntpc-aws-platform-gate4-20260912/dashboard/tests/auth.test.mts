import assert from "node:assert/strict";
import test from "node:test";

import { createSignedToken, getSession, getSessionAccess, unauthenticatedResponse, verifySignedToken } from "../worker/auth.ts";
import type { DashboardRuntimeEnv } from "../worker/runtime-env.ts";

const secret = "test-session-secret-that-is-longer-than-thirty-two-bytes";
const baseEnv = {
  APP_ORIGIN: "https://ntpc-youth.the-weekly-blend.com",
  GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
  SESSION_COOKIE_NAME: "__Host-ntpc_youth_session",
  SESSION_TTL_SECONDS: "28800",
  SESSION_SECRET: secret,
  ALLOWED_EMAILS: "decision-reviewer@example.invalid,public-viewer@example.invalid",
} as unknown as DashboardRuntimeEnv;

test("signed session rejects tampering and expiration", async () => {
  const token = await createSignedToken({ email: "decision-reviewer@example.invalid", exp: 1_900_000_000 }, secret);
  assert.equal((await verifySignedToken<{ email: string; exp: number }>(token, secret, new Date("2026-08-26T00:00:00Z")))?.email, "decision-reviewer@example.invalid");
  assert.equal(await verifySignedToken(`${token}x`, secret, new Date("2026-08-26T00:00:00Z")), null);
  const expired = await createSignedToken({ exp: 1 }, secret);
  assert.equal(await verifySignedToken(expired, secret, new Date("2026-08-26T00:00:00Z")), null);
});

test("session email must remain in the allowlist and receives the configured role", async () => {
  const token = await createSignedToken({ subject: "1", email: "decision-reviewer@example.invalid", name: "Demo Reviewer", exp: 1_900_000_000 }, secret);
  const request = new Request("https://ntpc-youth.the-weekly-blend.com/", { headers: { cookie: `__Host-ntpc_youth_session=${token}` } });
  assert.equal((await getSession(request, baseEnv))?.email, "decision-reviewer@example.invalid");
  assert.equal((await getSessionAccess(request, { ...baseEnv, DECISION_EMAILS: "decision-reviewer@example.invalid" }))?.role, "decision");
  assert.equal((await getSessionAccess(request, { ...baseEnv, DECISION_EMAILS: "public-viewer@example.invalid" }))?.role, "viewer");
  assert.equal(await getSession(request, { ...baseEnv, ALLOWED_EMAILS: "other@example.com,public-viewer@example.invalid" }), null);
});

test("decision email configuration must be a subset of the login allowlist", async () => {
  const token = await createSignedToken({ subject: "1", email: "decision-reviewer@example.invalid", name: "Demo Reviewer", exp: 1_900_000_000 }, secret);
  const request = new Request("https://ntpc-youth.the-weekly-blend.com/", { headers: { cookie: `__Host-ntpc_youth_session=${token}` } });
  assert.equal(await getSessionAccess(request, { ...baseEnv, DECISION_EMAILS: "not-allowed@example.com" }), null);
});

test("unauthenticated page gets login portal and API fails closed", async () => {
  const page = unauthenticatedResponse(new Request("https://ntpc-youth.the-weekly-blend.com/"), baseEnv);
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.match(body, /新北青年資料/);
  assert.match(body, /使用白名單中的 Google 帳號登入/);
  assert.match(body, /\/auth\/google/);
  const api = unauthenticatedResponse(new Request("https://ntpc-youth.the-weekly-blend.com/api/ask"), baseEnv);
  assert.equal(api.status, 401);
  assert.deepEqual((await api.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");
});

test("login nonce survives the Google cross-site form POST", () => {
  const page = unauthenticatedResponse(new Request("https://ntpc-youth.the-weekly-blend.com/"), baseEnv);
  const setCookie = page.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /__Host-ntpc_youth_login_nonce=/u);
  assert.match(setCookie, /Max-Age=600/u);
  assert.match(setCookie, /Secure/u);
  assert.match(setCookie, /HttpOnly/u);
  assert.match(setCookie, /SameSite=None/u);
  assert.doesNotMatch(setCookie, /SameSite=Lax/u);
});

test("unauthenticated subrequests reuse the active login nonce", async () => {
  const firstPage = unauthenticatedResponse(
    new Request("https://ntpc-youth.the-weekly-blend.com/"),
    baseEnv,
  );
  const setCookie = firstPage.headers.get("set-cookie") ?? "";
  const nonce = /__Host-ntpc_youth_login_nonce=([^;]+)/u.exec(setCookie)?.[1];
  assert.ok(nonce);

  const assetRequest = new Request("https://ntpc-youth.the-weekly-blend.com/favicon.svg", {
    headers: { cookie: `__Host-ntpc_youth_login_nonce=${nonce}` },
  });
  const assetResponse = unauthenticatedResponse(assetRequest, baseEnv);
  const body = await assetResponse.text();

  assert.match(body, new RegExp(`data-nonce="${nonce}"`, "u"));
  assert.equal(assetResponse.headers.get("set-cookie"), null);
});

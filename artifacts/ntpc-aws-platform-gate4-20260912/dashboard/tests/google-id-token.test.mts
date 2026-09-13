import assert from "node:assert/strict";
import test from "node:test";

import {
  GoogleIdTokenVerificationError,
  verifyGoogleIdToken,
} from "../worker/google-id-token.ts";

const clientId = "test.apps.googleusercontent.com";
const nonce = "test-login-nonce";
const now = new Date("2026-08-29T12:00:00Z");

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function signingFixture(keyId: string) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const header = encode({ alg: "RS256", kid: keyId, typ: "JWT" });
  const claims = {
    iss: "https://accounts.google.com",
    sub: "google-subject-1",
    email: "decision-reviewer@example.invalid",
    email_verified: true,
    aud: clientId,
    nonce,
    iat: Math.floor(now.getTime() / 1_000) - 60,
    exp: Math.floor(now.getTime() / 1_000) + 3_600,
    name: "Demo Reviewer",
  };

  async function token(overrides: Record<string, unknown> = {}): Promise<string> {
    const encodedClaims = encode({ ...claims, ...overrides });
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(`${header}.${encodedClaims}`),
    );
    return `${header}.${encodedClaims}.${Buffer.from(signature).toString("base64url")}`;
  }

  return {
    jwk: { ...publicJwk, kid: keyId, alg: "RS256", use: "sig" },
    token,
  };
}

test("valid Google token is accepted with the configured audience and nonce", async () => {
  const fixture = await signingFixture("current-key");
  const identity = await verifyGoogleIdToken(await fixture.token(), {
    clientId,
    expectedNonce: nonce,
    now,
    fetchImpl: async () => Response.json({ keys: [fixture.jwk] }),
  });

  assert.equal(identity.subject, "google-subject-1");
  assert.equal(identity.email, "decision-reviewer@example.invalid");
});

test("missing cached key triggers one cache-bypassing JWKS refresh", async () => {
  const fixture = await signingFixture("rotated-key");
  const requests: RequestInit[] = [];
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    return Response.json(requests.length === 1
      ? { keys: [{ ...fixture.jwk, kid: "stale-key" }] }
      : { keys: [fixture.jwk] });
  };

  const identity = await verifyGoogleIdToken(await fixture.token(), {
    clientId,
    expectedNonce: nonce,
    now,
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(identity.email, "decision-reviewer@example.invalid");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.cache, undefined);
  assert.equal(requests[1]?.cache, "no-store");
});

test("claim failures expose a non-sensitive diagnostic code", async () => {
  const fixture = await signingFixture("current-key");

  await assert.rejects(
    verifyGoogleIdToken(await fixture.token({ aud: "other.apps.googleusercontent.com" }), {
      clientId,
      expectedNonce: nonce,
      now,
      fetchImpl: async () => Response.json({ keys: [fixture.jwk] }),
    }),
    (error: unknown) =>
      error instanceof GoogleIdTokenVerificationError && error.code === "audience_mismatch",
  );
});

import { readBoundedJson, utf8 } from "./http.ts";

const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const ALLOWED_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);

interface GoogleSigningJsonWebKey extends JsonWebKey {
  readonly kid?: string;
}

interface JsonWebKeySet {
  readonly keys: readonly GoogleSigningJsonWebKey[];
}

interface GoogleIdTokenHeader {
  readonly alg: string;
  readonly kid: string;
  readonly typ?: string;
}

export interface VerifiedGoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
  readonly picture: string | null;
}

interface VerifyGoogleIdTokenOptions {
  readonly clientId: string;
  readonly expectedNonce: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: Date;
}

export type GoogleIdTokenVerificationFailure =
  | "token_malformed"
  | "token_decode_failed"
  | "signing_header_invalid"
  | "jwks_unavailable"
  | "jwks_invalid"
  | "signing_key_unavailable"
  | "signature_invalid"
  | "issuer_invalid"
  | "subject_missing"
  | "email_missing"
  | "email_unverified"
  | "nonce_mismatch"
  | "token_expired"
  | "issued_at_invalid"
  | "audience_mismatch";

export class GoogleIdTokenVerificationError extends Error {
  constructor(readonly code: GoogleIdTokenVerificationFailure) {
    super(`Google ID token verification failed: ${code}`);
    this.name = "GoogleIdTokenVerificationError";
  }
}

function fail(code: GoogleIdTokenVerificationFailure): never {
  throw new GoogleIdTokenVerificationError(code);
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeBase64Url(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseObject(value: Uint8Array): Record<string, unknown> {
  const parsed = JSON.parse(new TextDecoder().decode(value)) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Google ID token contained an invalid JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseHeader(value: Uint8Array): GoogleIdTokenHeader {
  const header = parseObject(value);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid === "") {
    fail("signing_header_invalid");
  }
  return {
    alg: header.alg,
    kid: header.kid,
    ...(typeof header.typ === "string" ? { typ: header.typ } : {}),
  };
}

function parseJwks(payload: unknown): JsonWebKeySet {
  if (typeof payload !== "object" || payload === null || !("keys" in payload)) {
    fail("jwks_invalid");
  }
  const keys = (payload as { readonly keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    fail("jwks_invalid");
  }
  return { keys: keys as GoogleSigningJsonWebKey[] };
}

function stringClaim(
  claims: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = claims[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberClaim(
  claims: Readonly<Record<string, unknown>>,
  name: string,
): number | undefined {
  const value = claims[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function audienceMatches(audience: unknown, clientId: string, azp: unknown): boolean {
  if (audience === clientId) return true;
  return (
    Array.isArray(audience) &&
    audience.every((value) => typeof value === "string") &&
    audience.includes(clientId) &&
    (audience.length === 1 || azp === clientId)
  );
}

function findSigningKey(
  jwks: JsonWebKeySet,
  keyId: string,
): GoogleSigningJsonWebKey | undefined {
  return jwks.keys.find(
    (candidate) =>
      candidate.kid === keyId &&
      candidate.kty === "RSA" &&
      (candidate.alg === undefined || candidate.alg === "RS256") &&
      (candidate.use === undefined || candidate.use === "sig"),
  );
}

async function fetchGoogleJwks(
  fetchImpl: typeof fetch,
  bypassCache: boolean,
): Promise<JsonWebKeySet> {
  try {
    const response = await fetchImpl(GOOGLE_JWKS_ENDPOINT, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      ...(bypassCache ? { cache: "no-store" as const } : {}),
    });
    if (!response.ok) fail("jwks_unavailable");
    return parseJwks(await readBoundedJson(response));
  } catch (error) {
    if (error instanceof GoogleIdTokenVerificationError) throw error;
    fail("jwks_unavailable");
  }
}

async function verifySignature(
  jwk: GoogleSigningJsonWebKey,
  encodedHeader: string,
  encodedClaims: string,
  encodedSignature: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      arrayBuffer(decodeBase64Url(encodedSignature)),
      arrayBuffer(utf8(`${encodedHeader}.${encodedClaims}`)),
    );
  } catch {
    return false;
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  options: VerifyGoogleIdTokenOptions,
): Promise<VerifiedGoogleIdentity> {
  const segments = idToken.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment === "")) {
    fail("token_malformed");
  }
  const [encodedHeader, encodedClaims, encodedSignature] = segments as [
    string,
    string,
    string,
  ];
  let header: GoogleIdTokenHeader;
  let claims: Record<string, unknown>;
  try {
    header = parseHeader(decodeBase64Url(encodedHeader));
    claims = parseObject(decodeBase64Url(encodedClaims));
  } catch (error) {
    if (error instanceof GoogleIdTokenVerificationError) throw error;
    fail("token_decode_failed");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let jwks = await fetchGoogleJwks(fetchImpl, false);
  let jwk = findSigningKey(jwks, header.kid);
  let refreshed = false;
  if (jwk === undefined) {
    jwks = await fetchGoogleJwks(fetchImpl, true);
    jwk = findSigningKey(jwks, header.kid);
    refreshed = true;
  }
  if (jwk === undefined) fail("signing_key_unavailable");

  let validSignature = await verifySignature(jwk, encodedHeader, encodedClaims, encodedSignature);
  if (!validSignature && !refreshed) {
    jwks = await fetchGoogleJwks(fetchImpl, true);
    jwk = findSigningKey(jwks, header.kid);
    if (jwk === undefined) fail("signing_key_unavailable");
    validSignature = await verifySignature(jwk, encodedHeader, encodedClaims, encodedSignature);
  }
  if (!validSignature) fail("signature_invalid");

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const issuer = stringClaim(claims, "iss");
  const subject = stringClaim(claims, "sub");
  const email = stringClaim(claims, "email")?.trim().toLowerCase();
  const nonce = stringClaim(claims, "nonce");
  const expiry = numberClaim(claims, "exp");
  const issuedAt = numberClaim(claims, "iat");
  const verified = claims.email_verified === true || claims.email_verified === "true";

  if (issuer === undefined || !ALLOWED_ISSUERS.has(issuer)) fail("issuer_invalid");
  if (subject === undefined) fail("subject_missing");
  if (email === undefined) fail("email_missing");
  if (!verified) fail("email_unverified");
  if (nonce !== options.expectedNonce) fail("nonce_mismatch");
  if (expiry === undefined || expiry <= nowSeconds) fail("token_expired");
  if (issuedAt === undefined || issuedAt > nowSeconds + 300) fail("issued_at_invalid");
  if (!audienceMatches(claims.aud, options.clientId, claims.azp)) fail("audience_mismatch");

  return {
    subject,
    email,
    name: stringClaim(claims, "name") ?? null,
    picture: stringClaim(claims, "picture") ?? null,
  };
}

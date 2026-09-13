import {
  GoogleIdTokenVerificationError,
  verifyGoogleIdToken,
} from "./google-id-token.ts";
import { htmlEscape, htmlResponse, jsonResponse, utf8 } from "./http.ts";
import {
  readAuthConfiguration,
  type AuthConfiguration,
  type DashboardRuntimeEnv,
} from "./runtime-env.ts";

const LOGIN_NONCE_COOKIE = "__Host-ntpc_youth_login_nonce";
const LOGIN_NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export interface SessionPayload {
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
  readonly exp: number;
}

export type DashboardAccessRole = "viewer" | "decision";

export interface SessionAccess {
  readonly session: SessionPayload;
  readonly role: DashboardAccessRole;
  readonly permissions: {
    readonly viewPolicy: boolean;
    readonly exportData: boolean;
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    arrayBuffer(utf8(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSignedToken(payload: object, secret: string): Promise<string> {
  const body = base64UrlEncode(utf8(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), arrayBuffer(utf8(body)));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySignedToken<T extends { readonly exp: number }>(
  token: string | undefined,
  secret: string,
  now = new Date(),
): Promise<T | null> {
  if (token === undefined || secret === "") return null;
  const segments = token.split(".");
  if (segments.length !== 2 || segments.some((segment) => segment === "")) return null;
  const [body, signature] = segments as [string, string];
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      arrayBuffer(base64UrlDecode(signature)),
      arrayBuffer(utf8(body)),
    );
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("exp" in parsed)) return null;
    const payload = parsed as T;
    return Number.isFinite(payload.exp) && payload.exp > Math.floor(now.getTime() / 1_000)
      ? payload
      : null;
  } catch {
    return null;
  }
}

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name !== "") cookies.set(name, value);
  }
  return cookies;
}

function cookie(
  name: string,
  value: string,
  maxAge: number,
  sameSite: "Lax" | "None" = "Lax",
): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=${sameSite}`;
}

function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "private, no-store" });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

function configurationUnavailable(): Response {
  return renderMessage(
    "登入尚未完成設定",
    "Google 登入或兩帳號白名單尚未部署完成，儀表板目前維持關閉。",
    503,
    "AUTH_NOT_CONFIGURED",
  );
}

function renderMessage(title: string, message: string, status: number, code: string): Response {
  return htmlResponse(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}｜新北青年資料證據台</title><style>:root{color-scheme:light;--navy:#123f5a;--blue:#176b91;--paper:#f3f7f9;--ink:#132a36;--muted:#536b77;--line:#c7d7df;font-family:ui-sans-serif,system-ui,-apple-system,"Noto Sans TC",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--paper);color:var(--ink)}main{width:min(620px,100%);padding:40px;border:1px solid var(--line);border-radius:22px;background:#fff;box-shadow:0 20px 60px rgba(18,63,90,.1)}.mark{color:var(--blue);font:800 12px/1.4 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}h1{margin:16px 0 12px;font-size:clamp(28px,6vw,42px)}p{color:var(--muted);line-height:1.75}.code{font:12px/1.5 ui-monospace,monospace}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}a{min-height:44px;display:inline-flex;align-items:center;padding:10px 16px;border:1px solid var(--navy);border-radius:10px;color:var(--navy);font-weight:800;text-decoration:none}a.primary{background:var(--navy);color:#fff}:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}</style></head><body><main><div class="mark">The Weekly Blend · Private Research</div><h1>${htmlEscape(title)}</h1><p>${htmlEscape(message)}</p><p class="code">${htmlEscape(code)}</p><div class="actions"><a class="primary" href="/">回登入入口</a><a href="https://the-weekly-blend.com/dashboard/">回會員中心</a></div></main></body></html>`, { status });
}

function renderLogin(request: Request, config: AuthConfiguration): Response {
  // Unauthenticated asset and icon requests also pass through this Worker.
  // Reuse the short-lived login nonce so those requests cannot rotate the
  // cookie after Google Identity Services has read the nonce from the page.
  const cookieNonce = parseCookies(request).get(LOGIN_NONCE_COOKIE);
  const nonce = cookieNonce !== undefined && LOGIN_NONCE_PATTERN.test(cookieNonce)
    ? cookieNonce
    : crypto.randomUUID();
  const response = htmlResponse(`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登入｜新北青年資料證據台</title><script src="https://accounts.google.com/gsi/client" async></script>
<style>:root{color-scheme:light;--navy:#123f5a;--blue:#176b91;--sky:#dff3fb;--paper:#f4f8fa;--surface:#fff;--ink:#102b3a;--muted:#56717e;--line:#c6d9e2;--accent:#a16207;font-family:ui-sans-serif,system-ui,-apple-system,"Noto Sans TC",sans-serif}*{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100dvh;padding:24px;background:radial-gradient(circle at 14% 18%,#fff 0,transparent 34%),linear-gradient(135deg,#eef6f9,#f8fafc);color:var(--ink)}a{color:inherit}:focus-visible{outline:3px solid #f59e0b;outline-offset:4px}.shell{width:min(1180px,100%);min-height:calc(100dvh - 48px);margin:auto;display:grid;grid-template-columns:1.08fr .92fr;border:1px solid var(--line);border-radius:26px;overflow:hidden;background:rgba(255,255,255,.82);box-shadow:0 24px 80px rgba(18,63,90,.12)}.intro{padding:clamp(42px,6vw,78px);display:flex;flex-direction:column;justify-content:space-between;background:var(--navy);color:#fff}.eyebrow{margin:0;color:#bde9f8;font:800 12px/1.4 ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase}.intro h1{max-width:720px;margin:24px 0 20px;font-size:clamp(46px,7vw,78px);line-height:1.02;letter-spacing:-.045em}.intro p{max-width:650px;margin:0;color:#d9edf5;font-size:17px;line-height:1.75}.tags{display:flex;flex-wrap:wrap;gap:9px;margin-top:38px}.tags span{padding:7px 11px;border:1px solid rgba(255,255,255,.28);border-radius:999px;font-size:12px}.login{display:grid;place-items:center;padding:clamp(32px,5vw,66px);background:var(--surface)}.panel{width:min(470px,100%);text-align:center}.lock{width:62px;height:62px;margin:0 auto 26px;display:grid;place-items:center;border-radius:18px;background:var(--sky);color:var(--navy);font-size:19px;font-weight:900}.panel h2{margin:0;font-size:clamp(30px,4vw,42px)}.panel>p{margin:14px auto 0;color:var(--muted);line-height:1.75}.google-wrap{min-height:64px;display:grid;place-items:center;margin-top:30px}.notice{margin-top:24px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--paper);color:var(--muted);font-size:13px;line-height:1.7;text-align:left}.back{min-height:44px;display:inline-flex;align-items:center;margin-top:24px;color:var(--blue);font-weight:800;text-decoration:none;border-bottom:1px solid currentColor}.privacy{font-size:12px!important}@media(max-width:800px){body{padding:0}.shell{min-height:100dvh;border:0;border-radius:0;grid-template-columns:1fr}.intro{min-height:390px;padding:40px 24px}.intro h1{font-size:clamp(42px,13vw,64px)}.login{padding:38px 20px 48px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important}}</style></head>
<body><main class="shell"><section class="intro" aria-labelledby="portal-title"><div><p class="eyebrow">The Weekly Blend · Private Research</p><h1 id="portal-title">新北青年資料<br>證據台</h1><p>整合戶籍人口、勞動市場與受僱員工薪資三種母體，所有指標保留來源、估計方法、年度與查核狀態。</p><div class="tags"><span>戶籍人口母體</span><span>勞動市場母體</span><span>薪資母體</span></div></div></section><section class="login"><div class="panel"><div class="lock" aria-hidden="true">NT</div><h2>僅限授權成員</h2><p>請使用白名單中的 Google 帳號登入。</p><div id="g_id_onload" data-client_id="${htmlEscape(config.clientId)}" data-login_uri="${htmlEscape(config.appOrigin)}/auth/google" data-ux_mode="redirect" data-nonce="${htmlEscape(nonce)}" data-auto_prompt="false"></div><div class="google-wrap"><div class="g_id_signin" data-type="standard" data-shape="rectangular" data-theme="outline" data-text="signin_with" data-size="large" data-locale="zh_TW" data-width="300"></div></div><div class="notice"><strong>權限說明</strong><br>伺服器會核對兩帳號白名單。登入只使用姓名、Email與Google帳號識別碼，不讀取Gmail或Google Drive。</div><a class="back" href="https://the-weekly-blend.com/dashboard/">← 回到 The Weekly Blend 會員中心</a><p class="privacy">Session最長8小時；移除白名單後既有Session也會立即失效。</p></div></section></main></body></html>`);
  // Google Identity Services returns the credential with a cross-site form POST.
  // Only this short-lived nonce cookie needs SameSite=None; the session remains Lax.
  if (cookieNonce !== nonce) {
    response.headers.append("set-cookie", cookie(LOGIN_NONCE_COOKIE, nonce, 600, "None"));
  }
  return response;
}

function sameOrigin(request: Request, config: AuthConfiguration): boolean {
  return new URL(request.url).origin === config.appOrigin;
}

async function readBoundedForm(request: Request, maxBytes = 24_000): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    throw new Error("Unsupported login content type.");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Login body exceeded the configured limit.");
  }
  if (request.body === null) return new URLSearchParams();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (result.value === undefined) continue;
    total += result.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Login body exceeded the configured limit.");
    }
    chunks.push(result.value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(combined));
}

async function finishGoogleLogin(request: Request, config: AuthConfiguration): Promise<Response> {
  if (!sameOrigin(request, config)) return renderMessage("登入來源不正確", "請從正式儀表板網域重新登入。", 400, "AUTH_ORIGIN_INVALID");
  let form: URLSearchParams;
  try {
    form = await readBoundedForm(request);
  } catch {
    return renderMessage("登入資料無法讀取", "Google登入資料格式或大小不符合要求。", 400, "AUTH_BODY_INVALID");
  }
  const credential = form.get("credential");
  const bodyCsrf = form.get("g_csrf_token");
  const cookies = parseCookies(request);
  const cookieCsrf = cookies.get("g_csrf_token");
  const nonce = cookies.get(LOGIN_NONCE_COOKIE);
  const credentialValid = typeof credential === "string" && credential.length >= 100 && credential.length <= 20_000;
  const bodyCsrfValid = typeof bodyCsrf === "string" && bodyCsrf !== "";
  const csrfMatches = bodyCsrfValid && cookieCsrf === bodyCsrf;
  const nonceValid = nonce !== undefined && nonce !== "";
  if (!credentialValid || !csrfMatches || !nonceValid) {
    console.warn(JSON.stringify({
      event: "oauth_callback_failed",
      stage: "request_validation",
      reason: "callback_prerequisite_missing",
      credentialValid,
      bodyCsrfValid,
      cookieCsrfPresent: cookieCsrf !== undefined && cookieCsrf !== "",
      csrfMatches,
      nonceValid,
    }));
    return renderMessage("登入驗證失敗", "登入狀態可能已逾時，請回入口重新操作。", 400, "AUTH_REQUEST_INVALID");
  }

  try {
    const identity = await verifyGoogleIdToken(credential, {
      clientId: config.clientId,
      expectedNonce: nonce,
    });
    if (!config.allowedEmails.has(identity.email)) {
      console.warn(JSON.stringify({ event: "oauth_callback_failed", stage: "allowlist", reason: "email_not_allowed" }));
      return renderMessage("此帳號尚未獲得權限", "Google身分已確認，但此Email不在儀表板白名單。", 403, "EMAIL_NOT_ALLOWED");
    }
    const session: SessionPayload = {
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      exp: Math.floor(Date.now() / 1_000) + config.sessionTtlSeconds,
    };
    const sessionToken = await createSignedToken(session, config.sessionSecret);
    return redirect("/", [
      cookie(LOGIN_NONCE_COOKIE, "", 0, "None"),
      cookie(config.sessionCookieName, sessionToken, config.sessionTtlSeconds),
    ]);
  } catch (error) {
    const reason = error instanceof GoogleIdTokenVerificationError
      ? error.code
      : "unexpected_verifier_error";
    console.warn(JSON.stringify({ event: "oauth_callback_failed", stage: "identity_verification", reason }));
    return renderMessage("Google身分驗證失敗", "請回到入口重新登入。", 401, "GOOGLE_IDENTITY_INVALID");
  }
}

export async function getSession(request: Request, env: DashboardRuntimeEnv): Promise<SessionPayload | null> {
  return (await getSessionAccess(request, env))?.session ?? null;
}

export async function getSessionAccess(request: Request, env: DashboardRuntimeEnv): Promise<SessionAccess | null> {
  const config = readAuthConfiguration(env);
  if (config === null) return null;
  const session = await verifySignedToken<SessionPayload>(
    parseCookies(request).get(config.sessionCookieName),
    config.sessionSecret,
  );
  if (session === null || !config.allowedEmails.has(session.email)) return null;
  const role: DashboardAccessRole = config.decisionEmails.has(session.email) ? "decision" : "viewer";
  const decisionPermission = role === "decision";
  return {
    session,
    role,
    permissions: {
      viewPolicy: decisionPermission,
      exportData: decisionPermission,
    },
  };
}

export async function handleAuthRoute(request: Request, env: DashboardRuntimeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const config = readAuthConfiguration(env);
  if (url.pathname === "/auth/google" && request.method === "POST") {
    return config === null ? configurationUnavailable() : finishGoogleLogin(request, config);
  }
  if (url.pathname === "/auth/login" && (request.method === "GET" || request.method === "HEAD")) {
    return config === null ? configurationUnavailable() : renderLogin(request, config);
  }
  if (url.pathname === "/auth/logout") {
    return redirect("/", config === null ? [] : [cookie(config.sessionCookieName, "", 0)]);
  }
  if (url.pathname === "/auth/status") {
    const access = await getSessionAccess(request, env);
    return jsonResponse(access === null
      ? {
          authenticated: false,
          role: "viewer",
          permissions: { viewPolicy: false, exportData: false },
        }
      : {
          authenticated: true,
          email: access.session.email,
          name: access.session.name,
          role: access.role,
          permissions: access.permissions,
        }, 200);
  }
  return null;
}

export function unauthenticatedResponse(request: Request, env: DashboardRuntimeEnv): Response {
  if (new URL(request.url).pathname.startsWith("/api/")) {
    return jsonResponse({ error: { code: "AUTH_REQUIRED", message: "請先登入。" } }, 401);
  }
  const config = readAuthConfiguration(env);
  return config === null ? configurationUnavailable() : renderLogin(request, config);
}

const encoder = new TextEncoder();

export function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function nonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function securityHeaders(scriptNonce?: string): Headers {
  const scriptSource = scriptNonce ? `'nonce-${scriptNonce}' ` : "";
  return new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-security-policy":
      `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; ` +
      `style-src 'unsafe-inline'; script-src ${scriptSource}https://accounts.google.com/gsi/client; ` +
      "img-src 'self' blob: data: https://lh3.googleusercontent.com; " +
      "connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; " +
      "object-src 'none'; media-src blob:;",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
}

export function htmlResponse(
  body: string,
  options: { readonly status?: number; readonly scriptNonce?: string } = {},
): Response {
  const headers = securityHeaders(options.scriptNonce);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { status: options.status ?? 200, headers });
}

export function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  const headers = securityHeaders();
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}

export async function readBoundedJson(
  response: Response,
  maxBytes = 64 * 1024,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Response exceeded the configured JSON limit.");
  }
  if (response.body === null) return {};

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (result.value === undefined) continue;
    total += result.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Response exceeded the configured JSON limit.");
    }
    chunks.push(result.value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(combined);
  return text === "" ? {} : (JSON.parse(text) as unknown);
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

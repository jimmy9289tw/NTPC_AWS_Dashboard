import handler from "vinext/server/app-router-entry";
import { getSessionAccess, handleAuthRoute } from "./auth.ts";
import type { DashboardRuntimeEnv } from "./runtime-env.ts";

const PROTECTED_STATIC_PREFIXES = ["/_next/static/", "/data/"] as const;
const PROTECTED_STATIC_FILES = new Set([
  "/favicon.svg",
  "/file.svg",
  "/globe.svg",
  "/window.svg",
]);

function isProtectedStaticAsset(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const { pathname } = new URL(request.url);
  return PROTECTED_STATIC_FILES.has(pathname)
    || PROTECTED_STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function preventStaleDynamicResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("cdn-cache-control", "no-store");
  headers.set("cloudflare-cdn-cache-control", "no-store");
  headers.set("expires", "0");
  headers.set("pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: DashboardRuntimeEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      const authResponse = await handleAuthRoute(request, env);
      if (authResponse !== null) return authResponse;
      const access = await getSessionAccess(request, env);
      const pathname = new URL(request.url).pathname;
      const role = access?.role ?? "viewer";
      const permissions = access?.permissions ?? { viewPolicy: false, exportData: false };
      if (pathname.startsWith("/api/export") && !permissions.exportData) {
        return Response.json(
          { error: { code: "ACCESS_DENIED", message: "此功能限決策內網授權帳號使用。" } },
          { status: 403, headers: { "cache-control": "private, no-store" } },
        );
      }
      if (isProtectedStaticAsset(request)) return env.ASSETS.fetch(request);
      const headers = new Headers(request.headers);
      headers.set("x-ntpc-access-role", role);
      headers.set("x-ntpc-can-view-policy", permissions.viewPolicy ? "1" : "0");
      const response = await handler.fetch(new Request(request, { headers }), env, ctx);
      return preventStaleDynamicResponse(response);
    } catch (error) {
      console.error(JSON.stringify({
        event: "dashboard_request_failed",
        path: new URL(request.url).pathname,
        errorType: error instanceof Error ? error.name : "UnknownError",
      }));
      return Response.json(
        { error: { code: "INTERNAL_ERROR", message: "Internal server error." } },
        { status: 500, headers: { "cache-control": "private, no-store" } },
      );
    }
  },
} satisfies ExportedHandler<DashboardRuntimeEnv>;

export default worker;

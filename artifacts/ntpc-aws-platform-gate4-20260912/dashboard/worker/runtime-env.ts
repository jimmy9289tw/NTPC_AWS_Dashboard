export type DashboardRuntimeEnv = Env & {
  readonly GOOGLE_CLIENT_ID?: string;
  readonly SESSION_SECRET?: string;
  readonly ALLOWED_EMAILS?: string;
  readonly DECISION_EMAILS?: string;
};

export interface AuthConfiguration {
  readonly appOrigin: string;
  readonly clientId: string;
  readonly sessionSecret: string;
  readonly sessionCookieName: string;
  readonly sessionTtlSeconds: number;
  readonly allowedEmails: ReadonlySet<string>;
  readonly decisionEmails: ReadonlySet<string>;
}

function normalizedAllowedEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function readAuthConfiguration(env: DashboardRuntimeEnv): AuthConfiguration | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  const allowedEmails = normalizedAllowedEmails(env.ALLOWED_EMAILS);
  const configuredDecisionEmails = normalizedAllowedEmails(env.DECISION_EMAILS);
  const decisionEmails = configuredDecisionEmails.size > 0
    ? configuredDecisionEmails
    : new Set(allowedEmails);
  const appOrigin = (env.APP_ORIGIN ?? "").trim().replace(/\/$/u, "");
  const sessionCookieName = (env.SESSION_COOKIE_NAME ?? "").trim();
  const parsedTtl = Number(env.SESSION_TTL_SECONDS ?? "");
  const sessionTtlSeconds = Number.isFinite(parsedTtl)
    ? Math.min(Math.max(Math.trunc(parsedTtl), 900), 86_400)
    : 28_800;

  if (
    clientId === "" ||
    sessionSecret.length < 32 ||
    allowedEmails.size < 1 ||
    [...decisionEmails].some((email) => !allowedEmails.has(email)) ||
    !appOrigin.startsWith("https://") ||
    !sessionCookieName.startsWith("__Host-")
  ) {
    return null;
  }

  return {
    appOrigin,
    clientId,
    sessionSecret,
    sessionCookieName,
    sessionTtlSeconds,
    allowedEmails,
    decisionEmails,
  };
}

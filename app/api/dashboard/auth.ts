const env = process.env;

const COOKIE_NAME = "dice_lab_dashboard";
const SESSION_SECONDS = 60 * 60 * 8;

export function dashboardConfigured(): boolean {
  return Boolean(env.DASHBOARD_PASSWORD && env.DASHBOARD_SESSION_SECRET);
}

export async function passwordMatches(candidate: unknown): Promise<boolean> {
  if (typeof candidate !== "string" || !env.DASHBOARD_PASSWORD) return false;
  return timingSafeEqual(candidate, env.DASHBOARD_PASSWORD);
}

export async function createDashboardCookie(request: Request): Promise<string> {
  if (!env.DASHBOARD_SESSION_SECRET) throw new Error("Dashboard session secret is unavailable.");
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const signature = await sign(String(expires), env.DASHBOARD_SESSION_SECRET);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${expires}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearDashboardCookie(request?: Request): string {
  const secure = request && new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function isDashboardAuthorized(request: Request): Promise<boolean> {
  if (!env.DASHBOARD_SESSION_SECRET) return false;
  const raw = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!raw) return false;
  const [expiresText, signature] = raw.split(".");
  const expires = Number(expiresText);
  if (!expiresText || !signature || !Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(expiresText, env.DASHBOARD_SESSION_SECRET);
  return timingSafeEqual(signature, expected);
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

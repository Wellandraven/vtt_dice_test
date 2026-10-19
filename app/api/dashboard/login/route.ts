import {
  createDashboardCookie,
  dashboardConfigured,
  isDashboardAuthorized,
  passwordMatches,
} from "../auth.js";

export async function GET(request: Request): Promise<Response> {
  return Response.json({ authenticated: await isDashboardAuthorized(request), configured: dashboardConfigured() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!dashboardConfigured()) {
    return Response.json({ error: "Dashboard access has not been configured." }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  if (!(await passwordMatches(body?.password))) {
    return Response.json({ error: "That password is not correct." }, { status: 401 });
  }
  return Response.json({ authenticated: true }, {
    headers: { "Cache-Control": "no-store", "Set-Cookie": await createDashboardCookie(request) },
  });
}

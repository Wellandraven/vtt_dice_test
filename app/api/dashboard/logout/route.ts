import { clearDashboardCookie } from "../auth.js";

export async function POST(request: Request): Promise<Response> {
  return Response.json({ authenticated: false }, {
    headers: { "Cache-Control": "no-store", "Set-Cookie": clearDashboardCookie(request) },
  });
}

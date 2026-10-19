import { ensureStudySchema, getD1 } from "../../../../db/index.js";
import { STUDY_PHASE } from "../../../../study/protocol.js";
import { getStudyMode } from "../../../../study/mode.js";
import { isDashboardAuthorized } from "../auth.js";

export async function POST(request: Request): Promise<Response> {
  if (!(await isDashboardAuthorized(request))) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  await ensureStudySchema();
  const db = getD1();

  if (body?.action === "launch") {
    await db.prepare("UPDATE study_admin_state SET is_live = 1, launched_at = COALESCE(launched_at, ?) WHERE id = 1")
      .bind(Date.now()).run();
    return Response.json(await getStudyMode(), { headers: { "Cache-Control": "no-store" } });
  }

  if (body?.action === "clear_qa") {
    const results = await db.batch([
      db.prepare("DELETE FROM study_events WHERE session_id IN (SELECT id FROM study_sessions WHERE study_phase = ?)").bind(STUDY_PHASE),
      db.prepare("DELETE FROM study_trials WHERE session_id IN (SELECT id FROM study_sessions WHERE study_phase = ?)").bind(STUDY_PHASE),
      db.prepare("DELETE FROM study_contact_opt_ins WHERE study_phase = ?").bind(STUDY_PHASE),
      db.prepare("DELETE FROM study_sessions WHERE study_phase = ?").bind(STUDY_PHASE),
    ]);
    const deletedSessions = Number(results[3]?.meta?.changes ?? 0);
    return Response.json({ cleared: true, deletedSessions }, { headers: { "Cache-Control": "no-store" } });
  }

  return Response.json({ error: "Unknown dashboard action." }, { status: 400 });
}

import { ensureStudySchema, getD1, type D1PreparedStatement } from "../../../../db/index.js";

interface ContactBody {
  sessionId?: unknown;
  email?: unknown;
  newsletter?: unknown;
  followUp?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ContactBody;
    const sessionId = typeof body.sessionId === "string" && body.sessionId.length <= 80 ? body.sessionId : null;
    const email = normalizeEmail(body.email);
    const newsletter = body.newsletter === true;
    const followUp = body.followUp === true;
    if (!sessionId || !email || (!newsletter && !followUp)) {
      return Response.json({ error: "A valid email and at least one contact choice are required." }, { status: 400 });
    }

    await ensureStudySchema();
    const db = getD1();
    const session = await db.prepare(`SELECT id, study_phase AS "studyPhase" FROM study_sessions
      WHERE id = ? AND status = 'development_complete' LIMIT 1`)
      .bind(sessionId)
      .first<{ id: string; studyPhase: string }>();
    if (!session) return Response.json({ error: "Completed study session not found." }, { status: 404 });

    const emailKey = await sha256(email);
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    if (newsletter) {
      statements.push(db.prepare(`INSERT INTO study_contact_opt_ins
        (id, kind, email, session_id, study_phase, consented_at) VALUES (?, 'newsletter', ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET email = excluded.email, consented_at = excluded.consented_at`)
        .bind(`newsletter:${emailKey}`, email, session.studyPhase, now));
    }
    if (followUp) {
      statements.push(db.prepare(`INSERT INTO study_contact_opt_ins
        (id, kind, email, session_id, study_phase, consented_at) VALUES (?, 'session_followup', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET email = excluded.email, consented_at = excluded.consented_at`)
        .bind(`session_followup:${sessionId}`, email, sessionId, session.studyPhase, now));
    }
    await db.batch(statements);
    return Response.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    console.error("Unable to save post-study contact preferences", error);
    return Response.json({ error: "Your contact preferences could not be saved." }, { status: 500 });
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

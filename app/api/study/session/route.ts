import { ensureStudySchema, getD1 } from "../../../../db/index.js";
import {
  balancedInterfaceSequenceCandidates,
  isStudyProfile,
  isStudySequence,
  type StudyProfile,
  type StudySequence,
} from "../../../../study/protocol.js";
import { getStudyMode } from "../../../../study/mode.js";
import {
  DEVELOPMENT_INTERFACES,
  type InterfaceProgress,
  type StudyProgress,
} from "../../../../study/progress.js";
import { isSessionInactive } from "../../../../study/inactivity.js";

interface SessionRow {
  id: string;
  sequence: string;
  status: string;
  lastActivityAt?: number;
}

interface SequenceCountRow {
  sequence: string;
  assigned: number;
}

interface TrialRow {
  interfaceId: string;
  taskId: string;
  status: string;
  easeRating: number | null;
  confidenceRating: number | null;
  comment: string | null;
}

interface ViewportContext {
  viewportWidth: number;
  viewportHeight: number;
  visualViewportWidth: number;
  visualViewportHeight: number;
  visualViewportScale: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  orientation: "portrait" | "landscape";
  capturedAt: number;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { consent?: unknown; profile?: unknown; viewport?: unknown };
    const viewport = readViewportContext(body.viewport);
    if (body.consent !== true || !isStudyProfile(body.profile) || !viewport) {
      return json({ error: "Consent, study profile fields, and viewport context are required." }, 400);
    }

    await ensureStudySchema();
    const db = getD1();
    const studyMode = await getStudyMode();
    const counts = await db
      .prepare("SELECT SUBSTR(sequence, 1, 1) AS sequence, COUNT(*) AS assigned FROM study_sessions WHERE study_phase = ? AND status != 'incomplete' GROUP BY SUBSTR(sequence, 1, 1)")
      .bind(studyMode.phase)
      .all<SequenceCountRow>();
    const sequence = chooseLeastAssigned(counts.results ?? []);
    const id = crypto.randomUUID();
    const now = Date.now();
    const profile = body.profile as StudyProfile;

    await db.batch([
      db.prepare(`INSERT INTO study_sessions (
        id, sequence, study_phase, status, current_position,
        vtt_tools, vtt_other, vtt_comfort, dice_familiarity,
        vtt_experience, notation_familiarity, device_class, input_method,
        consented_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        sequence,
        studyMode.phase,
        "active",
        0,
        JSON.stringify(profile.vttTools),
        profile.vttOther,
        profile.vttComfort,
        profile.diceFamiliarity,
        profile.vttTools.includes("none") ? "none" : "used",
        profile.diceFamiliarity,
        viewportClass(viewport.viewportWidth),
        "not_collected",
        now,
        now,
      ),
      db.prepare(`INSERT INTO study_events (
        id, session_id, trial_id, event_type, interface_id, position, task_pack, task_id, occurred_at, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          id,
          null,
          "session_context",
          null,
          null,
          null,
          null,
          now,
          JSON.stringify({ viewport, profile }),
        ),
    ]);

    return json({ session: { id, sequence, status: "active" }, progress: {} }, 201);
  } catch (error: unknown) {
    console.error("Unable to create study session", error);
    return json({ error: "The study session could not be created." }, 500);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id || id.length > 80) return json({ error: "A valid session id is required." }, 400);

    await ensureStudySchema();
    const db = getD1();
    const session = await db
      .prepare(`SELECT id, sequence, status,
        COALESCE((SELECT MAX(e.occurred_at) FROM study_events e WHERE e.session_id = study_sessions.id), created_at) AS lastActivityAt
        FROM study_sessions WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<SessionRow>();
    if (!session || !isStudySequence(session.sequence)) return json({ error: "Study session not found." }, 404);
    if (session.status === "active" && isSessionInactive(Number(session.lastActivityAt ?? 0))) {
      await db.prepare("UPDATE study_sessions SET status = 'incomplete' WHERE id = ? AND status = 'active'").bind(id).run();
      return json({ error: "This session expired after 15 minutes of inactivity." }, 410);
    }

    const trials = await db
      .prepare(`SELECT interface_id AS interfaceId, task_id AS taskId, status, ease_rating AS easeRating,
        confidence_rating AS confidenceRating, comment
        FROM study_trials WHERE session_id = ? AND interface_id IN (?, ?, ?) ORDER BY created_at`)
      .bind(id, ...DEVELOPMENT_INTERFACES)
      .all<TrialRow>();
    const rows = trials.results ?? [];
    const progress: StudyProgress = {};
    for (const interfaceId of DEVELOPMENT_INTERFACES) {
      const interfaceRows = rows.filter((trial) => trial.interfaceId === interfaceId);
      if (interfaceRows.length === 0) continue;
      const rated = interfaceRows.find((trial) => trial.easeRating !== null && trial.confidenceRating !== null);
      const interfaceProgress: InterfaceProgress = {
        completedTaskIds: interfaceRows.filter((trial) => trial.status === "complete").map((trial) => trial.taskId),
        rating: rated
          ? { ease: rated.easeRating!, confidence: rated.confidenceRating!, comment: rated.comment ?? "" }
          : null,
      };
      progress[interfaceId] = interfaceProgress;
    }

    return json({
      session: { id: session.id, sequence: session.sequence as StudySequence, status: session.status },
      progress,
    });
  } catch (error: unknown) {
    console.error("Unable to resume study session", error);
    return json({ error: "The study session could not be resumed." }, 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { sessionId?: unknown; action?: unknown };
    if (typeof body.sessionId !== "string" || body.sessionId.length > 80 || body.action !== "mark_incomplete") {
      return json({ error: "Invalid session update." }, 400);
    }
    await ensureStudySchema();
    const db = getD1();
    await db.prepare("UPDATE study_sessions SET status = 'incomplete' WHERE id = ? AND status = 'active'").bind(body.sessionId).run();
    return json({ ok: true });
  } catch (error: unknown) {
    console.error("Unable to expire study session", error);
    return json({ error: "The study session could not be reset." }, 500);
  }
}

function chooseLeastAssigned(rows: readonly SequenceCountRow[]): StudySequence {
  const interfaceCounts: Record<"A" | "B" | "C", number> = { A: 0, B: 0, C: 0 };
  for (const row of rows) {
    if (row.sequence === "A" || row.sequence === "B" || row.sequence === "C") {
      interfaceCounts[row.sequence] = Number(row.assigned) || 0;
    }
  }
  const candidates = balancedInterfaceSequenceCandidates(interfaceCounts);
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return candidates[random[0]! % candidates.length]!;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function readViewportContext(value: unknown): ViewportContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const context = value as Record<string, unknown>;
  const viewportWidth = positiveInteger(context.viewportWidth, 20_000);
  const viewportHeight = positiveInteger(context.viewportHeight, 20_000);
  const visualViewportWidth = positiveInteger(context.visualViewportWidth, 20_000);
  const visualViewportHeight = positiveInteger(context.visualViewportHeight, 20_000);
  const screenWidth = positiveInteger(context.screenWidth, 20_000);
  const screenHeight = positiveInteger(context.screenHeight, 20_000);
  const devicePixelRatio = boundedNumber(context.devicePixelRatio, 0.1, 10);
  const visualViewportScale = boundedNumber(context.visualViewportScale, 0.1, 10);
  const capturedAt = positiveInteger(context.capturedAt, Number.MAX_SAFE_INTEGER);
  const orientation = context.orientation === "portrait" || context.orientation === "landscape" ? context.orientation : null;
  if (
    viewportWidth === null || viewportHeight === null || visualViewportWidth === null ||
    visualViewportHeight === null || screenWidth === null || screenHeight === null ||
    devicePixelRatio === null || visualViewportScale === null || capturedAt === null || !orientation
  ) return null;
  return {
    viewportWidth,
    viewportHeight,
    visualViewportWidth,
    visualViewportHeight,
    visualViewportScale,
    screenWidth,
    screenHeight,
    devicePixelRatio,
    orientation,
    capturedAt,
  };
}

function positiveInteger(value: unknown, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(maximum, Math.round(value));
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(minimum, Math.min(maximum, value));
}

function viewportClass(width: number): "compact" | "medium" | "large" {
  if (width < 640) return "compact";
  if (width < 1024) return "medium";
  return "large";
}

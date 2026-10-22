import { ensureStudySchema, getD1, type D1Database } from "../../../../db/index.js";
import {
  INTERFACES,
  interfacePosition,
  isStudySequence,
  tasksForInterface,
  type InterfaceId,
  type StudySequence,
} from "../../../../study/protocol.js";
import { isSessionInactive } from "../../../../study/inactivity.js";

const EVENT_TYPES = [
  "interface_ready",
  "task_presented",
  "first_interaction",
  "click_audit",
  "invalid_roll",
  "valid_roll_initiated",
  "animation_completed",
  "help_opened",
  "help_opened_session",
  "trial_rating_submitted",
  "viewport_resized",
  "study_completed",
  "participant_activity",
] as const;
type EventType = (typeof EVENT_TYPES)[number];

interface SessionRow {
  sequence: string;
  status: string;
  lastActivityAt: number;
}

interface EventBody {
  sessionId?: unknown;
  eventType?: unknown;
  interfaceId?: unknown;
  taskId?: unknown;
  payload?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as EventBody;
    if (typeof body.sessionId !== "string" || body.sessionId.length > 80 || !isEventType(body.eventType)) {
      return json({ error: "Invalid study event." }, 400);
    }

    await ensureStudySchema();
    const db = getD1();
    const session = await db
      .prepare(`SELECT sequence, status,
        COALESCE((SELECT MAX(e.occurred_at) FROM study_events e WHERE e.session_id = study_sessions.id), created_at) AS "lastActivityAt"
        FROM study_sessions WHERE id = ? LIMIT 1`)
      .bind(body.sessionId)
      .first<SessionRow>();
    if (!session || !isStudySequence(session.sequence)) return json({ error: "Study session not found." }, 404);
    if (session.status === "active" && isSessionInactive(Number(session.lastActivityAt))) {
      await db.prepare("UPDATE study_sessions SET status = 'incomplete' WHERE id = ? AND status = 'active'").bind(body.sessionId).run();
      return json({ error: "This session expired after 15 minutes of inactivity." }, 410);
    }
    if (session.status !== "active") return json({ error: "This study session is no longer active." }, 409);

    const interfaceId = isInterfaceId(body.interfaceId) ? body.interfaceId : null;
    const sequence = session.sequence as StudySequence;
    const position = interfaceId ? interfacePosition(sequence, interfaceId) : null;
    const knownTasks = interfaceId ? tasksForInterface(sequence, interfaceId) : [];
    const task = typeof body.taskId === "string" ? knownTasks.find((candidate) => candidate.id === body.taskId) : undefined;
    if (requiresTask(body.eventType) && (!interfaceId || !task || position === null || position < 0)) {
      return json({ error: "This event does not match the assigned study task." }, 400);
    }

    const now = Date.now();
    const trialId = task && interfaceId ? `${body.sessionId}:${interfaceId}:${task.id}` : null;
    const payload = safePayload(body.payload);

    if (body.eventType === "task_presented" && task && interfaceId && trialId && position !== null) {
      await db
        .prepare(`INSERT INTO study_trials (
          id, session_id, interface_id, position, task_pack, task_id, is_practice,
          status, presented_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, interface_id, task_id) DO UPDATE SET
          status = CASE WHEN study_trials.status = 'complete' THEN study_trials.status ELSE 'presented' END,
          presented_at = CASE WHEN study_trials.status = 'complete' THEN study_trials.presented_at ELSE excluded.presented_at END,
          updated_at = excluded.updated_at`)
        .bind(
          trialId,
          body.sessionId,
          interfaceId,
          position,
          position,
          task.id,
          task.isPractice ? 1 : 0,
          "presented",
          now,
          now,
          now,
        )
        .run();
      await db
        .prepare("UPDATE study_sessions SET current_position = ? WHERE id = ?")
        .bind(position, body.sessionId)
        .run();
    }

    const eventValues = [
      crypto.randomUUID(),
      body.sessionId,
      trialId,
      body.eventType,
      interfaceId,
      position,
      position,
      task?.id ?? null,
      now,
      payload === null ? null : JSON.stringify(payload),
    ] as const;
    if (body.eventType === "help_opened_session") {
      await db
        .prepare(`INSERT INTO study_events (
          id, session_id, trial_id, event_type, interface_id, position, task_pack, task_id, occurred_at, payload
        ) SELECT ?, ?, ?, ?, ?, ?::integer, ?::integer, ?, ?::bigint, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM study_events WHERE session_id = ? AND event_type = 'help_opened_session'
          )`)
        .bind(...eventValues, body.sessionId)
        .run();
    } else {
      await db
        .prepare(`INSERT INTO study_events (
          id, session_id, trial_id, event_type, interface_id, position, task_pack, task_id, occurred_at, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...eventValues)
        .run();
    }

    if (trialId) await applyTrialSummary(db, trialId, body.eventType, payload, now);
    if (body.eventType === "study_completed") {
      await db
        .prepare("UPDATE study_sessions SET status = ?, completed_at = ? WHERE id = ?")
        .bind("development_complete", now, body.sessionId)
        .run();
    }

    return json({ ok: true });
  } catch (error: unknown) {
    console.error("Unable to record study event", error);
    return json({ error: "The study event could not be recorded." }, 500);
  }
}

async function applyTrialSummary(
  db: D1Database,
  trialId: string,
  eventType: EventType,
  payload: Record<string, unknown> | null,
  now: number,
): Promise<void> {
  switch (eventType) {
    case "first_interaction":
      await db.prepare("UPDATE study_trials SET first_interaction_at = COALESCE(first_interaction_at, ?), updated_at = ? WHERE id = ?").bind(now, now, trialId).run();
      break;
    case "invalid_roll":
      await db.prepare("UPDATE study_trials SET invalid_attempts = invalid_attempts + 1, updated_at = ? WHERE id = ?").bind(now, trialId).run();
      break;
    case "valid_roll_initiated": {
      const elapsedMs = boundedInteger(payload?.elapsedMs, 1, 3_600_000);
      await db.prepare("UPDATE study_trials SET status = ?, valid_roll_at = ?, elapsed_ms = ?, updated_at = ? WHERE id = ?").bind("complete", now, elapsedMs, now, trialId).run();
      break;
    }
    case "animation_completed":
      await db.prepare("UPDATE study_trials SET animation_completed_at = ?, updated_at = ? WHERE id = ?").bind(now, now, trialId).run();
      break;
    case "help_opened":
      await db.prepare("UPDATE study_trials SET help_opened = 1, updated_at = ? WHERE id = ?").bind(now, trialId).run();
      break;
    case "trial_rating_submitted": {
      const ease = boundedInteger(payload?.ease, 1, 5);
      const confidence = boundedInteger(payload?.confidence, 1, 5);
      const comment = typeof payload?.comment === "string" ? payload.comment.slice(0, 1000) : "";
      await db.prepare("UPDATE study_trials SET ease_rating = ?, confidence_rating = ?, comment = ?, updated_at = ? WHERE id = ?").bind(ease, confidence, comment, now, trialId).run();
      break;
    }
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function safePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isEventType(value: unknown): value is EventType {
  return EVENT_TYPES.includes(value as EventType);
}

function isInterfaceId(value: unknown): value is InterfaceId {
  return INTERFACES.includes(value as InterfaceId);
}

function requiresTask(eventType: EventType): boolean {
  return !["interface_ready", "click_audit", "help_opened_session", "viewport_resized", "study_completed", "participant_activity"].includes(eventType);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

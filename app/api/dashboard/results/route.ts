import { ensureStudySchema, getD1 } from "../../../../db/index.js";
import { getStudyMode } from "../../../../study/mode.js";

interface SummaryRow {
  totalSessions: number;
  completedSessions: number;
  activeSessions: number;
  helpOpeners: number;
}

interface InterfaceRow {
  interfaceId: string;
  completedTrials: number;
  averageElapsedMs: number | null;
  averageInvalidAttempts: number | null;
  averageEase: number | null;
  averageConfidence: number | null;
  helpTrials: number;
}

interface SequenceRow { sequence: string; sessions: number }

interface ProfileRow {
  vttTools: string;
  vttOther: string | null;
  vttComfort: number;
  diceFamiliarity: string;
}

interface SessionRow {
  id: string;
  studyPhase: string;
  sequence: string;
  status: string;
  currentPosition: number;
  viewportClass: string;
  createdAt: number;
  completedAt: number | null;
  lastActivityAt: number;
  completedTrials: number;
  scoredTrials: number;
  helpOpened: number;
}

interface ContactRow {
  id: string;
  kind: string;
  email: string;
  sessionId: string | null;
  studyPhase: string;
  consentedAt: number;
}

interface SurveySummaryRow {
  interfaceId: string;
  responseCount: number;
  averageEase: number | null;
  averageConfidence: number | null;
  highEaseCount: number;
  highConfidenceCount: number;
  commentCount: number;
}

interface SurveyResponseRow {
  id: string;
  sessionId: string;
  studyPhase: string;
  interfaceId: string;
  sequence: string;
  ease: number | null;
  confidence: number | null;
  comment: string;
  submittedAt: number;
}

interface ClickAuditRow {
  id: string;
  sessionId: string;
  studyPhase: string;
  interfaceId: string | null;
  taskId: string | null;
  occurredAt: number;
  payload: string | null;
}

interface PhaseRow {
  studyPhase: string;
  totalSessions: number;
  completedSessions: number;
  earliestAt: number | null;
  latestAt: number | null;
}

export async function GET(request: Request): Promise<Response> {
  await ensureStudySchema();
  const db = getD1();
  const studyMode = await getStudyMode();
  const activePhase = studyMode.phase;
  const requestedPhase = new URL(request.url).searchParams.get("phase");
  const selectedPhase = requestedPhase === "all" ? null : requestedPhase || activePhase;
  const inactivityCutoff = Date.now() - 15 * 60 * 1000;
  await db.prepare(`UPDATE study_sessions SET status = 'incomplete'
    WHERE study_phase = ? AND status = 'active'
      AND COALESCE((SELECT MAX(e.occurred_at) FROM study_events e WHERE e.session_id = study_sessions.id), created_at) <= ?`)
    .bind(activePhase, inactivityCutoff)
    .run();
  const [availablePhases, summary, interfaces, sequences, profiles, sessions, contacts, surveySummary, surveyResponses, clickAudit] = await Promise.all([
    db.prepare(`SELECT
      study_phase AS studyPhase,
      COUNT(*) AS totalSessions,
      SUM(CASE WHEN status = 'development_complete' THEN 1 ELSE 0 END) AS completedSessions,
      MIN(created_at) AS earliestAt,
      MAX(created_at) AS latestAt
      FROM study_sessions
      GROUP BY study_phase
      ORDER BY latestAt DESC`).all<PhaseRow>(),
    db.prepare(`SELECT
      COUNT(*) AS totalSessions,
      SUM(CASE WHEN status = 'development_complete' THEN 1 ELSE 0 END) AS completedSessions,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeSessions,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM study_events e WHERE e.session_id = s.id AND e.event_type = 'help_opened_session'
      ) THEN 1 ELSE 0 END) AS helpOpeners
      FROM study_sessions s WHERE (? IS NULL OR s.study_phase = ?)`).bind(selectedPhase, selectedPhase).first<SummaryRow>(),
    db.prepare(`SELECT
      t.interface_id AS interfaceId,
      SUM(CASE WHEN t.status = 'complete' AND t.is_practice = 0 THEN 1 ELSE 0 END) AS completedTrials,
      AVG(CASE WHEN t.status = 'complete' AND t.is_practice = 0 THEN t.elapsed_ms END) AS averageElapsedMs,
      AVG(CASE WHEN t.status = 'complete' AND t.is_practice = 0 THEN t.invalid_attempts END) AS averageInvalidAttempts,
      AVG(CASE WHEN t.is_practice = 0 THEN t.ease_rating END) AS averageEase,
      AVG(CASE WHEN t.is_practice = 0 THEN t.confidence_rating END) AS averageConfidence,
      SUM(CASE WHEN t.is_practice = 0 AND t.help_opened = 1 THEN 1 ELSE 0 END) AS helpTrials
      FROM study_trials t
      INNER JOIN study_sessions s ON s.id = t.session_id
      WHERE (? IS NULL OR s.study_phase = ?) GROUP BY t.interface_id ORDER BY t.interface_id`).bind(selectedPhase, selectedPhase).all<InterfaceRow>(),
    db.prepare(`SELECT SUBSTR(sequence, 1, 1) AS sequence, COUNT(*) AS sessions FROM study_sessions
      WHERE (? IS NULL OR study_phase = ?) GROUP BY SUBSTR(sequence, 1, 1) ORDER BY sequence`).bind(selectedPhase, selectedPhase).all<SequenceRow>(),
    db.prepare(`SELECT
      vtt_tools AS vttTools,
      vtt_other AS vttOther,
      vtt_comfort AS vttComfort,
      dice_familiarity AS diceFamiliarity
      FROM study_sessions
      WHERE (? IS NULL OR study_phase = ?)
      ORDER BY created_at DESC`).bind(selectedPhase, selectedPhase).all<ProfileRow>(),
    db.prepare(`SELECT
      s.id,
      s.study_phase AS studyPhase,
      s.sequence,
      s.status,
      s.current_position AS currentPosition,
      s.device_class AS viewportClass,
      s.created_at AS createdAt,
      s.completed_at AS completedAt,
      COALESCE((SELECT MAX(e.occurred_at) FROM study_events e WHERE e.session_id = s.id), s.created_at) AS lastActivityAt,
      (SELECT COUNT(*) FROM study_trials t WHERE t.session_id = s.id AND t.status = 'complete') AS completedTrials,
      (SELECT COUNT(*) FROM study_trials t WHERE t.session_id = s.id AND t.is_practice = 0) AS scoredTrials,
      CASE WHEN EXISTS (
        SELECT 1 FROM study_events e WHERE e.session_id = s.id AND e.event_type = 'help_opened_session'
      ) THEN 1 ELSE 0 END AS helpOpened
      FROM study_sessions s
      WHERE (? IS NULL OR s.study_phase = ?)
      ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, lastActivityAt DESC
      LIMIT 40`).bind(selectedPhase, selectedPhase).all<SessionRow>(),
    db.prepare(`SELECT
      id,
      kind,
      email,
      session_id AS sessionId,
      study_phase AS studyPhase,
      consented_at AS consentedAt
      FROM study_contact_opt_ins
      WHERE (? IS NULL OR study_phase = ?)
      ORDER BY consented_at DESC
      LIMIT 200`).bind(selectedPhase, selectedPhase).all<ContactRow>(),
    db.prepare(`SELECT
      t.interface_id AS interfaceId,
      COUNT(*) AS responseCount,
      AVG(t.ease_rating) AS averageEase,
      AVG(t.confidence_rating) AS averageConfidence,
      SUM(CASE WHEN t.ease_rating >= 4 THEN 1 ELSE 0 END) AS highEaseCount,
      SUM(CASE WHEN t.confidence_rating >= 4 THEN 1 ELSE 0 END) AS highConfidenceCount,
      SUM(CASE WHEN LENGTH(TRIM(COALESCE(t.comment, ''))) > 0 THEN 1 ELSE 0 END) AS commentCount
      FROM study_trials t
      INNER JOIN study_sessions s ON s.id = t.session_id
      WHERE (? IS NULL OR s.study_phase = ?)
        AND (t.ease_rating IS NOT NULL OR t.confidence_rating IS NOT NULL OR LENGTH(TRIM(COALESCE(t.comment, ''))) > 0)
      GROUP BY t.interface_id
      ORDER BY t.interface_id`).bind(selectedPhase, selectedPhase).all<SurveySummaryRow>(),
    db.prepare(`SELECT
      t.id,
      t.session_id AS sessionId,
      s.study_phase AS studyPhase,
      t.interface_id AS interfaceId,
      s.sequence,
      t.ease_rating AS ease,
      t.confidence_rating AS confidence,
      COALESCE(t.comment, '') AS comment,
      t.updated_at AS submittedAt
      FROM study_trials t
      INNER JOIN study_sessions s ON s.id = t.session_id
      WHERE (? IS NULL OR s.study_phase = ?)
        AND (t.ease_rating IS NOT NULL OR t.confidence_rating IS NOT NULL OR LENGTH(TRIM(COALESCE(t.comment, ''))) > 0)
      ORDER BY t.updated_at DESC
      LIMIT 300`).bind(selectedPhase, selectedPhase).all<SurveyResponseRow>(),
    db.prepare(`SELECT
      e.id,
      e.session_id AS sessionId,
      s.study_phase AS studyPhase,
      e.interface_id AS interfaceId,
      e.task_id AS taskId,
      e.occurred_at AS occurredAt,
      e.payload
      FROM study_events e
      INNER JOIN study_sessions s ON s.id = e.session_id
      WHERE (? IS NULL OR s.study_phase = ?) AND e.event_type = 'click_audit'
      ORDER BY e.occurred_at DESC
      LIMIT 2000`).bind(selectedPhase, selectedPhase).all<ClickAuditRow>(),
  ]);

  return Response.json({
    ...studyMode,
    activePhase,
    selectedPhase,
    view: selectedPhase === null ? "all" : selectedPhase === activePhase ? "current" : "phase",
    availablePhases: (availablePhases.results ?? []).map((row) => ({
      ...row,
      totalSessions: Number(row.totalSessions ?? 0),
      completedSessions: Number(row.completedSessions ?? 0),
      earliestAt: nullableNumber(row.earliestAt),
      latestAt: nullableNumber(row.latestAt),
    })),
    generatedAt: Date.now(),
    summary: normalizeSummary(summary),
    interfaces: (interfaces.results ?? []).map(normalizeInterface),
    sequences: sequences.results ?? [],
    profileAnalytics: summarizeProfiles(profiles.results ?? []),
    surveySummary: (surveySummary.results ?? []).map(normalizeSurveySummary),
  }, { headers: { "Cache-Control": "no-store" } });
}

function summarizeProfiles(rows: readonly ProfileRow[]) {
  const toolCounts: Record<string, number> = {};
  const comfortCounts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  const familiarityCounts: Record<string, number> = { unfamiliar: 0, somewhat: 0, familiar: 0 };
  let comfortTotal = 0;
  let comfortResponses = 0;

  for (const row of rows) {
    try {
      const tools = JSON.parse(row.vttTools) as unknown;
      if (Array.isArray(tools)) {
        for (const tool of tools) if (typeof tool === "string") toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
      }
    } catch { /* Ignore malformed legacy profile data. */ }
    const comfort = Number(row.vttComfort);
    if (Number.isInteger(comfort) && comfort >= 1 && comfort <= 5) {
      comfortCounts[String(comfort)] += 1;
      comfortTotal += comfort;
      comfortResponses += 1;
    }
    if (row.diceFamiliarity in familiarityCounts) familiarityCounts[row.diceFamiliarity] += 1;
  }

  return {
    respondents: rows.length,
    tools: Object.entries(toolCounts).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    otherTools: [],
    comfort: Object.entries(comfortCounts).map(([value, count]) => ({ value: Number(value), count })),
    averageComfort: comfortResponses ? comfortTotal / comfortResponses : null,
    familiarity: Object.entries(familiarityCounts).map(([value, count]) => ({ value, count })),
  };
}

function normalizeSummary(row: SummaryRow | null) {
  return {
    totalSessions: Number(row?.totalSessions ?? 0),
    completedSessions: Number(row?.completedSessions ?? 0),
    activeSessions: Number(row?.activeSessions ?? 0),
    helpOpeners: Number(row?.helpOpeners ?? 0),
  };
}

function normalizeInterface(row: InterfaceRow) {
  return {
    interfaceId: row.interfaceId,
    completedTrials: Number(row.completedTrials ?? 0),
    averageElapsedMs: nullableNumber(row.averageElapsedMs),
    averageInvalidAttempts: nullableNumber(row.averageInvalidAttempts),
    averageEase: nullableNumber(row.averageEase),
    averageConfidence: nullableNumber(row.averageConfidence),
    helpTrials: Number(row.helpTrials ?? 0),
  };
}

function normalizeSurveySummary(row: SurveySummaryRow) {
  return {
    interfaceId: row.interfaceId,
    responseCount: Number(row.responseCount ?? 0),
    averageEase: nullableNumber(row.averageEase),
    averageConfidence: nullableNumber(row.averageConfidence),
    highEaseCount: Number(row.highEaseCount ?? 0),
    highConfidenceCount: Number(row.highConfidenceCount ?? 0),
    commentCount: Number(row.commentCount ?? 0),
  };
}

function nullableNumber(value: number | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function parseClickPayload(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

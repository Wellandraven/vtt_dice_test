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

interface SurveySummaryRow {
  interfaceId: string;
  responseCount: number;
  averageEase: number | null;
  averageConfidence: number | null;
  highEaseCount: number;
  highConfidenceCount: number;
  commentCount: number;
}

interface ClickSummaryRow {
  interfaceId: string;
  totalClicks: number;
  observedSessions: number;
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
  // This endpoint is public, so it returns aggregates only. Participant-level rows (sessions,
  // emails, comments, click traces) are deliberately never queried here.
  const [availablePhases, summary, interfaces, sequences, profiles, surveySummary, clickSummary] = await Promise.all([
    db.prepare(`SELECT
      study_phase AS "studyPhase",
      COUNT(*) AS "totalSessions",
      SUM(CASE WHEN status = 'development_complete' THEN 1 ELSE 0 END) AS "completedSessions",
      MIN(created_at) AS "earliestAt",
      MAX(created_at) AS "latestAt"
      FROM study_sessions
      GROUP BY study_phase
      ORDER BY "latestAt" DESC`).all<PhaseRow>(),
    db.prepare(`SELECT
      COUNT(*) AS "totalSessions",
      SUM(CASE WHEN status = 'development_complete' THEN 1 ELSE 0 END) AS "completedSessions",
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS "activeSessions",
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM study_events e WHERE e.session_id = s.id AND e.event_type = 'help_opened_session'
      ) THEN 1 ELSE 0 END) AS "helpOpeners"
      FROM study_sessions s WHERE (?::text IS NULL OR s.study_phase = ?)`).bind(selectedPhase, selectedPhase).first<SummaryRow>(),
    db.prepare(`SELECT
      t.interface_id AS "interfaceId",
      SUM(CASE WHEN t.status = 'complete' AND t.is_practice = 0 THEN 1 ELSE 0 END) AS "completedTrials",
      AVG(CASE WHEN t.status = 'complete' AND t.is_practice = 0 THEN t.elapsed_ms END) AS "averageElapsedMs",
      AVG(CASE WHEN t.status = 'complete' AND t.is_practice = 0 THEN t.invalid_attempts END) AS "averageInvalidAttempts",
      AVG(CASE WHEN t.is_practice = 0 THEN t.ease_rating END) AS "averageEase",
      AVG(CASE WHEN t.is_practice = 0 THEN t.confidence_rating END) AS "averageConfidence",
      SUM(CASE WHEN t.is_practice = 0 AND t.help_opened = 1 THEN 1 ELSE 0 END) AS "helpTrials"
      FROM study_trials t
      INNER JOIN study_sessions s ON s.id = t.session_id
      WHERE (?::text IS NULL OR s.study_phase = ?) GROUP BY t.interface_id ORDER BY t.interface_id`).bind(selectedPhase, selectedPhase).all<InterfaceRow>(),
    db.prepare(`SELECT SUBSTR(sequence, 1, 1) AS sequence, COUNT(*) AS sessions FROM study_sessions
      WHERE (?::text IS NULL OR study_phase = ?) GROUP BY SUBSTR(sequence, 1, 1) ORDER BY sequence`).bind(selectedPhase, selectedPhase).all<SequenceRow>(),
    db.prepare(`SELECT
      vtt_tools AS "vttTools",
      vtt_other AS "vttOther",
      vtt_comfort AS "vttComfort",
      dice_familiarity AS "diceFamiliarity"
      FROM study_sessions
      WHERE (?::text IS NULL OR study_phase = ?)
      ORDER BY created_at DESC`).bind(selectedPhase, selectedPhase).all<ProfileRow>(),
    db.prepare(`SELECT
      t.interface_id AS "interfaceId",
      COUNT(*) AS "responseCount",
      AVG(t.ease_rating) AS "averageEase",
      AVG(t.confidence_rating) AS "averageConfidence",
      SUM(CASE WHEN t.ease_rating >= 4 THEN 1 ELSE 0 END) AS "highEaseCount",
      SUM(CASE WHEN t.confidence_rating >= 4 THEN 1 ELSE 0 END) AS "highConfidenceCount",
      SUM(CASE WHEN LENGTH(TRIM(COALESCE(t.comment, ''))) > 0 THEN 1 ELSE 0 END) AS "commentCount"
      FROM study_trials t
      INNER JOIN study_sessions s ON s.id = t.session_id
      WHERE (?::text IS NULL OR s.study_phase = ?)
        AND (t.ease_rating IS NOT NULL OR t.confidence_rating IS NOT NULL OR LENGTH(TRIM(COALESCE(t.comment, ''))) > 0)
      GROUP BY t.interface_id
      ORDER BY t.interface_id`).bind(selectedPhase, selectedPhase).all<SurveySummaryRow>(),
    db.prepare(`SELECT
      e.interface_id AS "interfaceId",
      COUNT(*) AS "totalClicks",
      COUNT(DISTINCT e.session_id) AS "observedSessions"
      FROM study_events e
      INNER JOIN study_sessions s ON s.id = e.session_id
      WHERE (?::text IS NULL OR s.study_phase = ?) AND e.event_type = 'click_audit' AND e.interface_id IS NOT NULL
      GROUP BY e.interface_id
      ORDER BY e.interface_id`).bind(selectedPhase, selectedPhase).all<ClickSummaryRow>(),
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
    clickSummary: (clickSummary.results ?? []).map(normalizeClickSummary),
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

function normalizeClickSummary(row: ClickSummaryRow) {
  const totalClicks = Number(row.totalClicks ?? 0);
  const observedSessions = Number(row.observedSessions ?? 0);
  return {
    interfaceId: row.interfaceId,
    totalClicks,
    observedSessions,
    averageClicks: observedSessions ? totalClicks / observedSessions : null,
  };
}

function nullableNumber(value: number | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

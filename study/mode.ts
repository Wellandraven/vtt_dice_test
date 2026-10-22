import { getD1 } from "../db/index.js";
import { LIVE_STUDY_PHASE, STUDY_PHASE } from "./protocol.js";

interface StudyModeRow {
  isLive: number;
  launchedAt: number | null;
}

export interface StudyMode {
  mode: "qa" | "live";
  phase: string;
  launchedAt: number | null;
}

export async function getStudyMode(): Promise<StudyMode> {
  const row = await getD1().prepare(
    `SELECT is_live AS "isLive", launched_at AS "launchedAt" FROM study_admin_state WHERE id = 1`,
  ).first<StudyModeRow>();
  const live = Number(row?.isLive ?? 0) === 1;
  return {
    mode: live ? "live" : "qa",
    phase: live ? LIVE_STUDY_PHASE : STUDY_PHASE,
    launchedAt: row?.launchedAt ?? null,
  };
}

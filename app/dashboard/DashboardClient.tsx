"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const interfacePreviews = [
  { id: "A", image: "/interface-previews/interface-a.png", href: "/preview?interface=A" },
  { id: "B", image: "/interface-previews/interface-b.png", href: "/preview?interface=B" },
  { id: "C", image: "/interface-previews/interface-c.png", href: "/preview?interface=C" },
] as const;

type InterfacePreviewId = (typeof interfacePreviews)[number]["id"];

interface DashboardData {
  mode: "qa" | "live";
  phase: string;
  activePhase: string;
  selectedPhase: string | null;
  view: "current" | "all" | "phase";
  availablePhases: Array<{ studyPhase: string; totalSessions: number; completedSessions: number; earliestAt: number | null; latestAt: number | null }>;
  launchedAt: number | null;
  generatedAt: number;
  summary: { totalSessions: number; completedSessions: number; activeSessions: number; helpOpeners: number };
  interfaces: Array<{
    interfaceId: string;
    completedTrials: number;
    averageElapsedMs: number | null;
    averageInvalidAttempts: number | null;
    averageEase: number | null;
    averageConfidence: number | null;
    helpTrials: number;
  }>;
  sequences: Array<{ sequence: string; sessions: number }>;
  profileAnalytics: {
    respondents: number;
    tools: Array<{ value: string; count: number }>;
    otherTools: Array<{ value: string; count: number }>;
    comfort: Array<{ value: number; count: number }>;
    averageComfort: number | null;
    familiarity: Array<{ value: string; count: number }>;
  };
  surveySummary: Array<{
    interfaceId: string;
    responseCount: number;
    averageEase: number | null;
    averageConfidence: number | null;
    highEaseCount: number;
    highConfidenceCount: number;
    commentCount: number;
  }>;
  clickSummary: Array<{ interfaceId: string; averageClicks: number | null; observedSessions: number; totalClicks: number }>;
}

export default function DashboardClient() {
  const [error, setError] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState("current");
  const [previewImage, setPreviewImage] = useState<InterfacePreviewId | null>(null);

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      const phase = phaseFilter === "current" ? "" : `?phase=${encodeURIComponent(phaseFilter)}`;
      const response = await fetch(`/api/dashboard/results${phase}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Results are temporarily unavailable.");
      setData(await response.json() as DashboardData);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Results are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [phaseFilter]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  useEffect(() => {
    if (!analysisOpen && !previewImage && !adminOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAnalysisOpen(false);
        setPreviewImage(null);
        setAdminOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [analysisOpen, previewImage, adminOpen]);

  const selectedPreview = interfacePreviews.find((preview) => preview.id === previewImage);

  const completionRate = data?.summary.totalSessions
    ? Math.round((data.summary.completedSessions / data.summary.totalSessions) * 100)
    : 0;
  const helpRate = data?.summary.totalSessions
    ? Math.round((data.summary.helpOpeners / data.summary.totalSessions) * 100)
    : 0;

  const exportPdfReport = () => {
    if (!data) return;
    const stamp = new Date(data.generatedAt).toISOString().slice(0, 10);
    downloadBlob(
      `dice-interface-lab-${data.selectedPhase ?? "all-phases"}-${stamp}.pdf`,
      buildPdfReport(data),
    );
  };

  return (
    <main className="dashboard-root">
      <header className="dashboard-header">
        <div>
          <span className="dashboard-eyebrow">Dice Interface Lab</span>
          <h1>Research case study</h1>
          <p>{data?.view === "all" ? "Public historical overview of a multi-interface dice UX experiment." : data?.mode === "live" ? "Public aggregate results from a live usability study" : "Public aggregate results from QA research"}</p>
        </div>
        <div className="dashboard-actions">
          <span className={`dashboard-live${data?.mode === "live" ? " is-live" : ""}`}><i />{data?.mode === "live" ? "Test is live" : "QA mode"}</span>
          <button type="button" className="dashboard-analysis" onClick={() => setAnalysisOpen(true)} disabled={!data}>Run analysis</button>
          <button type="button" onClick={loadResults} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </header>

      <div className="dashboard-content">
        {error && <p className="dashboard-error" role="alert">{error}</p>}
        <section className="dashboard-panel interface-preview-gallery" aria-labelledby="tested-interfaces-title">
          <header className="interface-preview-gallery-head">
            <div>
              <span className="dashboard-eyebrow">Tested interfaces</span>
              <h2 id="tested-interfaces-title">Explore the three dice-control variations</h2>
              <p>Click a screenshot to view it full screen, or open an interactive preview.</p>
            </div>
          </header>
          <div className="interface-preview-grid">
            {interfacePreviews.map((preview) => (
              <article className="interface-preview-card" key={preview.id}>
                <button type="button" className="interface-preview-image" onClick={() => setPreviewImage(preview.id)} aria-label={`View Interface ${preview.id} screenshot full screen`}>
                  <img src={preview.image} alt={`Screenshot of Interface ${preview.id} dice controls`} />
                </button>
                <div className="interface-preview-card-footer">
                  <h3>Interface {preview.id}</h3>
                  <a className="interface-preview-cta" href={preview.href}>View UI test {preview.id}</a>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="dashboard-grid" aria-label="Study design">
          <article className="dashboard-panel">
            <div className="dashboard-panel-head"><div><span className="dashboard-eyebrow">Research design</span><h2>Controlled interface study</h2></div></div>
            <p className="dashboard-panel-note">Participants completed dice-rolling tasks across three interface variants. The study balanced interface order and captured completion, task time, correction attempts, help use, and post-task ratings.</p>
          </article>
          <article className="dashboard-panel">
            <div className="dashboard-panel-head"><div><span className="dashboard-eyebrow">Privacy approach</span><h2>Aggregate reporting only</h2></div></div>
            <p className="dashboard-panel-note">This public view excludes participant-level sessions, written feedback, emails, exact timestamps, device details, click traces, and raw-data exports.</p>
          </article>
        </section>
        <section className="dashboard-panel dashboard-data-view">
          <div>
            <span className="dashboard-eyebrow">Results view</span>
            <h2>{data?.view === "all" ? "All study phases" : "Selected study phase"}</h2>
            <p>{data?.view === "all" ? "This is a complete historical record. Protocols changed between phases, so do not pool these totals to select a winning interface." : "Choose a phase to review its experiment results and exports."}</p>
          </div>
          <label>
            <span>Data set</span>
            <select value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)}>
              <option value="current">Current live phase</option>
              <option value="all">All historical phases</option>
              {(data?.availablePhases ?? []).filter((phase) => phase.studyPhase !== data?.activePhase).map((phase) => <option key={phase.studyPhase} value={phase.studyPhase}>{phase.studyPhase}</option>)}
            </select>
          </label>
        </section>
        {data?.view === "all" && <section className="dashboard-panel">
          <div className="dashboard-panel-head"><div><span className="dashboard-eyebrow">Protocol history</span><h2>Results by study phase</h2></div></div>
          <div className="phase-summary-list">{data.availablePhases.map((phase) => <article key={phase.studyPhase}><strong>{phase.studyPhase}</strong><span>{phase.totalSessions} sessions · {phase.completedSessions} completed</span><small>Latest activity {phase.latestAt ? new Date(phase.latestAt).toLocaleDateString() : "—"}</small></article>)}</div>
        </section>}
        <section className="dashboard-metrics" aria-label="Study summary">
          <Metric label="Sessions" value={data?.summary.totalSessions ?? 0} detail={`${data?.summary.activeSessions ?? 0} active now`} />
          <Metric label="Completed" value={data?.summary.completedSessions ?? 0} detail={`${completionRate}% completion rate`} />
          <Metric label="Opened help" value={data?.summary.helpOpeners ?? 0} detail={`${helpRate}% of sessions`} />
          <Metric label="Data set" value={data?.view === "all" ? "All phases" : data?.mode === "live" ? "Live" : "QA"} detail={data?.selectedPhase ?? "Historical overview"} compact />
        </section>

        <div className="dashboard-grid">
          <section className="dashboard-panel dashboard-wide">
            <div className="dashboard-panel-head"><div><span className="dashboard-eyebrow">Primary comparison</span><h2>Interface performance</h2></div></div>
            <div className="interface-results">
              {(data?.interfaces ?? []).map((item) => (
                <article key={item.interfaceId} className="interface-result-card">
                  <div className="interface-badge">{item.interfaceId}</div>
                  <div><span>Average task time</span><strong>{formatDuration(item.averageElapsedMs)}</strong></div>
                  <div><span>Invalid attempts</span><strong>{formatNumber(item.averageInvalidAttempts)}</strong></div>
                  <div><span>Ease</span><strong>{formatRating(item.averageEase)}</strong></div>
                  <div><span>Confidence</span><strong>{formatRating(item.averageConfidence)}</strong></div>
                  <small>{item.completedTrials} scored trials · help opened on {item.helpTrials}</small>
                </article>
              ))}
              {!data?.interfaces.length && <p className="dashboard-empty">No scored trials recorded yet.</p>}
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-head"><div><span className="dashboard-eyebrow">Experiment health</span><h2>Interface assignment</h2></div></div>
            <div className="sequence-list">
              {(data?.sequences ?? []).map((item) => <div key={item.sequence}><span>Interface {item.sequence}</span><strong>{item.sessions}</strong></div>)}
              {!data?.sequences.length && <p className="dashboard-empty">No assignments yet.</p>}
            </div>
          </section>
        </div>

        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div><span className="dashboard-eyebrow">Pre-test questionnaire</span><h2>Participant profile</h2></div>
            <span>{data?.profileAnalytics.respondents ?? 0} responses</span>
          </div>
          <ProfileAnalytics data={data?.profileAnalytics ?? null} />
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div><span className="dashboard-eyebrow">Post-interface survey</span><h2>Survey results</h2></div>
          </div>
          <SurveySummary items={data?.surveySummary ?? []} />
        </section>

        <footer className="dashboard-footer">
          <p>PDF reports contain aggregate study results only; participant-level data and written feedback are excluded.</p>
          <div className="dashboard-footer-actions">
            <button type="button" className="dashboard-admin-link" onClick={() => setAdminOpen(true)}>Admin</button>
            <button type="button" onClick={exportPdfReport} disabled={!data}>Export PDF report</button>
          </div>
        </footer>
      </div>
      {analysisOpen && data && <AnalysisDialog data={data} onClose={() => setAnalysisOpen(false)} />}
      {adminOpen && <AdminDialog data={data} onClose={() => setAdminOpen(false)} onChanged={() => void loadResults()} />}
      {selectedPreview && <div className="interface-gallery-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewImage(null); }}>
        <section className="interface-gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="interface-gallery-title">
          <header>
            <h2 id="interface-gallery-title">Interface {selectedPreview.id}</h2>
            <button type="button" onClick={() => setPreviewImage(null)} aria-label="Close full-screen preview">×</button>
          </header>
          <img src={selectedPreview.image} alt={`Full-screen screenshot of Interface ${selectedPreview.id} dice controls`} />
        </section>
      </div>}
    </main>
  );
}

interface StudyAnalysis {
  headline: string;
  confidence: string;
  insights: Array<{ title: string; detail: string; tone: "positive" | "neutral" | "caution" }>;
  recommendations: string[];
}

type AdminAuth = "checking" | "unconfigured" | "signed-out" | "signed-in";
type AdminConfirm = "clear" | "launch" | null;

/**
 * Admin controls behind the dashboard password: clear QA test data, launch the live study, sign
 * out. The server routes already enforce the signed cookie; this is only the way to reach them.
 */
function AdminDialog({ data, onClose, onChanged }: { data: DashboardData | null; onClose: () => void; onChanged: () => void }) {
  const [auth, setAuth] = useState<AdminAuth>("checking");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [confirm, setConfirm] = useState<AdminConfirm>(null);

  useEffect(() => {
    void fetch("/api/dashboard/login", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ authenticated: boolean; configured: boolean }>)
      .then((status) => setAuth(!status.configured ? "unconfigured" : status.authenticated ? "signed-in" : "signed-out"))
      .catch(() => { setAuth("signed-out"); setFailure("Could not check your admin session."); });
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFailure("");
    try {
      const response = await fetch("/api/dashboard/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Sign-in failed.");
      setPassword("");
      setAuth("signed-in");
    } catch (signInError) {
      setFailure(signInError instanceof Error ? signInError.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/dashboard/logout", { method: "POST" }).catch(() => undefined);
    setBusy(false);
    setMessage("");
    setAuth("signed-out");
  }

  async function runAction(action: "clear_qa" | "launch") {
    setConfirm(null);
    setBusy(true);
    setFailure("");
    setMessage("");
    try {
      const response = await fetch("/api/dashboard/study-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await response.json().catch(() => ({})) as { error?: string; deletedSessions?: number };
      if (response.status === 401) {
        setAuth("signed-out");
        throw new Error("Your admin session expired. Sign in again.");
      }
      if (!response.ok) throw new Error(body.error ?? "The action failed.");
      setMessage(action === "clear_qa"
        ? `Cleared ${body.deletedSessions ?? 0} QA session${body.deletedSessions === 1 ? "" : "s"}.`
        : "The study is live. New sessions are now recorded as live data.");
      onChanged();
    } catch (actionError) {
      setFailure(actionError instanceof Error ? actionError.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  }

  const live = data?.mode === "live";
  return <div className="analysis-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="analysis-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <header><div><span className="dashboard-eyebrow">Study admin</span><h2 id="admin-title">Admin controls</h2></div><button type="button" onClick={onClose} aria-label="Close admin controls">×</button></header>
      <div className="admin-body">
        {auth === "checking" && <p className="admin-note">Checking your admin session…</p>}
        {auth === "unconfigured" && <p className="admin-note">Admin access is not configured. Set <code>DASHBOARD_PASSWORD</code> and <code>DASHBOARD_SESSION_SECRET</code> in the hosting environment variables.</p>}
        {auth === "signed-out" && <form className="admin-form" onSubmit={signIn}>
          <label htmlFor="admin-password">Dashboard password</label>
          <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
          <button type="submit" className="admin-primary" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>}
        {auth === "signed-in" && <>
          <div className="admin-status">
            <span className={`dashboard-live${live ? " is-live" : ""}`}><i />{live ? "Test is live" : "QA mode"}</span>
            <small>Active phase: <code>{data?.activePhase ?? "—"}</code></small>
          </div>
          <article className="admin-action">
            <div><strong>Clear QA data</strong><p>Deletes every test session recorded in QA mode for the current phase. Live data and earlier phases are never touched.</p></div>
            <button type="button" className="admin-danger" onClick={() => setConfirm("clear")} disabled={busy}>Clear QA data</button>
          </article>
          {!live && <article className="admin-action">
            <div><strong>Launch study</strong><p>Switches to live mode, so new sessions are recorded as real study data, kept separate from QA. There is no switch back from here.</p></div>
            <button type="button" className="admin-primary" onClick={() => setConfirm("launch")} disabled={busy}>Launch study</button>
          </article>}
        </>}
        {message && <p className="admin-message" role="status">{message}</p>}
        {failure && <p className="dashboard-error" role="alert">{failure}</p>}
      </div>
      <footer><small>{auth === "signed-in" ? "Signed in for up to eight hours on this browser." : "Only the study owner needs this."}</small>{auth === "signed-in" ? <button type="button" onClick={signOut} disabled={busy}>Sign out</button> : <button type="button" onClick={onClose}>Close</button>}</footer>
    </section>
    {confirm && <div className="confirm-backdrop" role="presentation">
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title">
        <div className="confirm-warning" aria-hidden="true">!</div>
        <h2 id="admin-confirm-title">{confirm === "clear" ? "Delete all QA data?" : "Launch the live study?"}</h2>
        <p>{confirm === "clear"
          ? "Every QA test session, its events, ratings and contact opt-ins for the current phase will be permanently deleted."
          : "From now on every new session counts as real study data. Make sure QA testing is finished and the QA data is cleared first."}</p>
        <p className="confirm-safe-note">{confirm === "clear" ? "Live study data is not affected." : "Existing QA data is kept separately and stays out of the live results."}</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={() => setConfirm(null)} autoFocus>Cancel</button>
          <button type="button" className={confirm === "clear" ? "confirm-delete" : "admin-primary"} onClick={() => void runAction(confirm === "clear" ? "clear_qa" : "launch")}>{confirm === "clear" ? "Delete QA data" : "Launch study"}</button>
        </div>
      </section>
    </div>}
  </div>;
}

function AnalysisDialog({ data, onClose }: { data: DashboardData; onClose: () => void }) {
  const analysis = useMemo(() => analyzeStudy(data), [data]);
  const isHistoricalOverview = data.view === "all";
  return <div className="analysis-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="analysis-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-title">
      <header><div><span className="dashboard-eyebrow">Study analysis</span><h2 id="analysis-title">Insights and recommendations</h2></div><button type="button" onClick={onClose} aria-label="Close analysis">×</button></header>
      <div className="analysis-summary"><span>{isHistoricalOverview ? "Combined historical overview" : analysis.confidence}</span><h3>{analysis.headline}</h3><p>{isHistoricalOverview ? "This analysis combines all recorded phases to surface broad patterns, friction points, and participant feedback. Because protocols changed between phases, use the individual phase views to validate any interface-selection decision." : `Generated from ${data.selectedPhase ?? data.phase}. Findings are directional and should be validated with participant context.`}</p></div>
      <div className="analysis-section"><h3>Key insights</h3><div className="analysis-insights">{analysis.insights.map((insight) => <article className={`is-${insight.tone}`} key={insight.title}><i aria-hidden="true" /><div><strong>{insight.title}</strong><p>{insight.detail}</p></div></article>)}</div></div>
      <div className="analysis-section"><h3>Recommended next steps</h3><ol className="analysis-recommendations">{analysis.recommendations.map((item) => <li key={item}>{item}</li>)}</ol></div>
      <footer><small>Analyzed {data.summary.totalSessions} sessions, {data.interfaces.reduce((sum, item) => sum + item.completedTrials, 0)} scored trials, {data.surveySummary.reduce((sum, item) => sum + item.responseCount, 0)} survey responses, and {data.clickSummary.reduce((sum, item) => sum + item.totalClicks, 0)} recorded clicks.</small><button type="button" onClick={onClose}>Done</button></footer>
    </section>
  </div>;
}

function analyzeStudy(data: DashboardData): StudyAnalysis {
  const scored = data.interfaces.filter((item) => item.completedTrials > 0);
  const responseCount = data.surveySummary.reduce((sum, item) => sum + item.responseCount, 0);
  const completionRate = data.summary.totalSessions ? Math.round((data.summary.completedSessions / data.summary.totalSessions) * 100) : 0;
  if (!scored.length) return {
    headline: "There is not enough completed test data to compare the interfaces yet.",
    confidence: "Insufficient evidence",
    insights: [{ title: "No scored trials", detail: "Collect at least one completed visitor test before comparing interface performance.", tone: "caution" }],
    recommendations: ["Collect completed visitor tests for Interfaces A, B, and C.", "Confirm click tracking and survey responses appear in the dashboard before recruiting participants."],
  };

  const bySpeed = [...scored].filter((item) => item.averageElapsedMs !== null).sort((a, b) => (a.averageElapsedMs ?? Infinity) - (b.averageElapsedMs ?? Infinity));
  const byEase = [...scored].filter((item) => item.averageEase !== null).sort((a, b) => (b.averageEase ?? -Infinity) - (a.averageEase ?? -Infinity));
  const byConfidence = [...scored].filter((item) => item.averageConfidence !== null).sort((a, b) => (b.averageConfidence ?? -Infinity) - (a.averageConfidence ?? -Infinity));
  const byErrors = [...scored].filter((item) => item.averageInvalidAttempts !== null).sort((a, b) => (a.averageInvalidAttempts ?? Infinity) - (b.averageInvalidAttempts ?? Infinity));
  const leaders = [bySpeed[0]?.interfaceId, byEase[0]?.interfaceId, byConfidence[0]?.interfaceId].filter(Boolean);
  const consensus = leaders.length === 3 && new Set(leaders).size === 1 ? leaders[0] : null;
  const clickAverages = data.clickSummary
    .map((item) => ({ interfaceId: item.interfaceId, average: item.averageClicks }))
    .filter((item) => item.average !== null).sort((a, b) => (a.average ?? Infinity) - (b.average ?? Infinity));
  const sequenceCounts = data.sequences.map((item) => item.sessions);
  const sequenceSpread = sequenceCounts.length ? Math.max(...sequenceCounts) - Math.min(...sequenceCounts) : 0;
  const minimumTrials = Math.min(...scored.map((item) => item.completedTrials));
  const insights: StudyAnalysis["insights"] = [];

  if (consensus) insights.push({ title: `Interface ${consensus} leads across the primary measures`, detail: `It is currently fastest and has the highest average ease and confidence ratings. Treat this as directional until the sample is larger.`, tone: "positive" });
  else insights.push({ title: "The measures point to different leaders", detail: `Speed favors Interface ${bySpeed[0]?.interfaceId ?? "—"}, ease favors ${byEase[0]?.interfaceId ?? "—"}, and confidence favors ${byConfidence[0]?.interfaceId ?? "—"}. There is not yet a single unambiguous winner.`, tone: "neutral" });
  if (byErrors.length) insights.push({ title: `Interface ${byErrors[0]!.interfaceId} has the fewest invalid attempts`, detail: `${formatNumber(byErrors[0]!.averageInvalidAttempts)} average invalid attempts per scored trial, compared with ${formatNumber(byErrors.at(-1)!.averageInvalidAttempts)} for Interface ${byErrors.at(-1)!.interfaceId}.`, tone: "positive" });
  insights.push({ title: `${completionRate}% session completion`, detail: `${data.summary.completedSessions} of ${data.summary.totalSessions} sessions reached completion; ${data.summary.activeSessions} are currently active.`, tone: completionRate >= 75 ? "positive" : "caution" });
  if (clickAverages.length >= 2) insights.push({ title: `Interface ${clickAverages[0]!.interfaceId} currently requires the fewest recorded clicks`, detail: `${clickAverages[0]!.average!.toFixed(1)} clicks per observed interface session versus ${clickAverages.at(-1)!.average!.toFixed(1)} for Interface ${clickAverages.at(-1)!.interfaceId}. More clicks can indicate extra effort, but may also reflect exploration.`, tone: "neutral" });
  insights.push({ title: sequenceSpread <= 1 ? "Interface assignment is balanced" : "Interface imbalance may influence the comparison", detail: sequenceSpread <= 1 ? "Assigned interface counts differ by no more than one session." : `The largest interface group exceeds the smallest by ${sequenceSpread} sessions.`, tone: sequenceSpread <= 1 ? "positive" : "caution" });
  insights.push({ title: `${responseCount} post-interface survey responses`, detail: responseCount >= scored.length * 5 ? "The qualitative layer is beginning to support the behavioral measures." : "The survey sample is still small, so individual ratings and comments may shift the averages substantially.", tone: responseCount >= scored.length * 5 ? "neutral" : "caution" });

  const recommendations = [
    minimumTrials < 8 ? "Collect at least eight completed scored trials per interface before making a product decision." : "Continue collecting sessions until the leading pattern remains stable across several additional participants.",
    consensus ? `Use Interface ${consensus} as the current direction, but validate it against participant comments before committing.` : "Define the decision priority—speed, perceived ease, or confidence—before selecting an interface.",
    byErrors.length > 1 ? `Review the click timelines and comments for Interface ${byErrors.at(-1)!.interfaceId}, which currently has the most invalid attempts.` : "Review click timelines for repeated actions, resets, and long pauses that may indicate friction.",
    sequenceSpread > 1 ? "Rebalance future interface assignments before comparing results." : "Preserve the current balanced interface assignment as more sessions are added.",
  ];
  if (data.view === "all") recommendations.unshift("Use this combined history to identify recurring patterns, then check each study phase before treating an interface difference as a decision-ready result.");
  return {
    headline: data.view === "all"
      ? consensus ? `Across the combined history, Interface ${consensus} leads on the recorded summary measures.` : "Across the combined history, the recorded measures show meaningful tradeoffs rather than one clear leader."
      : consensus ? `Interface ${consensus} is the current directional leader.` : "The study shows meaningful tradeoffs rather than one clear winner.",
    confidence: minimumTrials >= 8 && responseCount >= 15 ? "Moderate evidence" : "Early directional evidence",
    insights,
    recommendations,
  };
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildPdfReport(data: DashboardData): Blob {
  const dataSet = data.view === "all" ? "All historical phases" : data.selectedPhase ?? "Current live phase";
  const completionRate = data.summary.totalSessions ? Math.round((data.summary.completedSessions / data.summary.totalSessions) * 100) : 0;
  const lines = [
    "Dice Interface Lab - Aggregate research report",
    `Data set: ${dataSet}`,
    `Generated: ${new Date(data.generatedAt).toLocaleString()}`,
    "",
    "Study summary",
    `Sessions: ${data.summary.totalSessions}`,
    `Completed sessions: ${data.summary.completedSessions} (${completionRate}%)`,
    `Active sessions: ${data.summary.activeSessions}`,
    `Sessions that opened help: ${data.summary.helpOpeners}`,
    "",
    "Interface performance",
    ...data.interfaces.map((item) => `Interface ${item.interfaceId}: ${item.completedTrials} scored trials | ${formatDuration(item.averageElapsedMs)} average task time | ${formatNumber(item.averageInvalidAttempts)} invalid attempts | ease ${formatRating(item.averageEase)} | confidence ${formatRating(item.averageConfidence)} | help ${item.helpTrials}`),
    "",
    "Interface assignment",
    ...(data.sequences.length ? data.sequences.map((item) => `Interface ${item.sequence}: ${item.sessions} sessions`) : ["No assignments recorded yet."]),
    "",
    "Participant profile (aggregate)",
    `Questionnaire responses: ${data.profileAnalytics.respondents}`,
    `Average VTT comfort: ${data.profileAnalytics.averageComfort?.toFixed(1) ?? "-"} / 5`,
    ...data.profileAnalytics.tools.map((item) => `VTT tool used - ${profileLabel(item.value)}: ${item.count}`),
    ...data.profileAnalytics.familiarity.map((item) => `Dice familiarity - ${profileLabel(item.value)}: ${item.count}`),
    "",
    "Post-interface survey (aggregate)",
    ...data.surveySummary.map((item) => `Interface ${item.interfaceId}: ${item.responseCount} responses | ease ${formatRating(item.averageEase)} | confidence ${formatRating(item.averageConfidence)} | ${item.commentCount} comments`),
    "",
    "Privacy note: This report excludes participant-level sessions, written comments, emails, timestamps, device details, click traces, and raw-data exports.",
  ];
  return createSimplePdf(lines);
}

function createSimplePdf(lines: string[]): Blob {
  const pageLines = chunkPdfLines(lines.flatMap(wrapPdfLine), 46);
  const encoder = new TextEncoder();
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageRefs: number[] = [];

  for (const page of pageLines) {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    pageRefs.push(pageObject);
    const stream = ["BT", "/F1 10 Tf", "50 770 Td", "14 TL", ...page.map((line, index) => `${index ? "T* " : ""}(${escapePdfText(line)}) Tj`), "ET"].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([encoder.encode(pdf)], { type: "application/pdf" });
}

function wrapPdfLine(line: string): string[] {
  const safe = line.replace(/[–—]/g, "-").replace(/[^ -\x7E]/g, "?");
  const words = safe.split(/\s+/);
  const wrapped: string[] = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    if (`${current} ${word}`.trim().length > 92 && current) {
      wrapped.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current || !wrapped.length) wrapped.push(current);
  return wrapped;
}

function chunkPdfLines(lines: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < lines.length; index += size) chunks.push(lines.slice(index, index + size));
  return chunks.length ? chunks : [[""]];
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function SurveySummary({ items }: { items: DashboardData["surveySummary"] }) {
  if (!items.length) return <p className="dashboard-empty">No survey responses have been submitted for this data set.</p>;
  return <div className="survey-summary-grid">{items.map((item) => {
    const easePositive = item.responseCount ? Math.round((item.highEaseCount / item.responseCount) * 100) : 0;
    const confidencePositive = item.responseCount ? Math.round((item.highConfidenceCount / item.responseCount) * 100) : 0;
    return <article className="survey-summary-card" key={item.interfaceId}>
      <a className="survey-summary-title" href={`/preview?interface=${item.interfaceId}`} aria-label={`Open interactive preview for Interface ${item.interfaceId}`}><span className="interface-badge is-static">{item.interfaceId}</span><div><strong>Interface {item.interfaceId}</strong><small>{item.responseCount} responses · {item.commentCount} comments · Open preview</small></div></a>
      <div className="survey-score-row"><span>Average ease<strong>{formatRating(item.averageEase)}</strong><small>{easePositive}% rated 4–5</small></span><span>Average confidence<strong>{formatRating(item.averageConfidence)}</strong><small>{confidencePositive}% rated 4–5</small></span></div>
    </article>;
  })}</div>;
}

function Metric({ label, value, detail, compact = false }: { label: string; value: string | number; detail: string; compact?: boolean }) {
  return <article className={`dashboard-metric${compact ? " is-compact" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function ProfileAnalytics({ data }: { data: DashboardData["profileAnalytics"] | null }) {
  if (!data?.respondents) return <p className="dashboard-empty">No pre-test responses have been submitted for this data set.</p>;
  return <div className="profile-analytics-grid">
    <ProfileBreakdown title="VTT platforms used" items={data.tools.map((item) => ({ ...item, label: profileLabel(item.value) }))} total={data.respondents} note="Participants may select more than one." />
    <ProfileBreakdown title="VTT comfort" items={data.comfort.map((item) => ({ ...item, label: `${item.value} / 5` }))} total={data.respondents} note={`Average ${data.averageComfort?.toFixed(1) ?? "—"} / 5`} />
    <ProfileBreakdown title="Dice notation familiarity" items={data.familiarity.map((item) => ({ ...item, label: profileLabel(item.value) }))} total={data.respondents} />
    {data.otherTools.length > 0 && <ProfileBreakdown title="Other platforms named" items={data.otherTools.map((item) => ({ ...item, label: item.value }))} total={data.respondents} note="Grouped anonymous responses." />}
  </div>;
}

function ProfileBreakdown({ title, items, total, note }: { title: string; items: Array<{ label: string; count: number }>; total: number; note?: string }) {
  return <article className="profile-breakdown"><header><strong>{title}</strong>{note && <small>{note}</small>}</header><div>{items.map((item) => {
    const percent = total ? Math.round((item.count / total) * 100) : 0;
    return <div className="profile-bar" key={item.label}><span><b>{item.label}</b><em>{item.count} · {percent}%</em></span><i><b style={{ width: `${percent}%` }} /></i></div>;
  })}</div></article>;
}

function profileLabel(value: string): string {
  return ({ dndbeyond: "D&D Beyond", roll20: "Roll20", foundry: "Foundry VTT", owlbear: "Owlbear Rodeo", other: "Other", none: "None", unfamiliar: "Unfamiliar", somewhat: "Somewhat familiar", familiar: "Familiar" } as Record<string, string>)[value] ?? value;
}

function formatDuration(value: number | null): string { return value === null ? "—" : `${(value / 1000).toFixed(1)}s`; }
function formatNumber(value: number | null): string { return value === null ? "—" : value.toFixed(2); }
function formatRating(value: number | null): string { return value === null ? "—" : `${value.toFixed(1)} / 5`; }

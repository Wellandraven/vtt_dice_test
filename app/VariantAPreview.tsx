"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  isValidSelection,
  tasksForInterface,
  type RollSelection,
  type StudySequence,
  type StudyTask,
} from "../study/protocol.js";
import {
  nextSingleInterfaceStep,
  type DevelopmentInterfaceId,
  type StudyProgress,
} from "../study/progress.js";
import { SESSION_INACTIVITY_MS } from "../study/inactivity.js";

const STORAGE_KEY = "dice-lab-session-id";
const VTT_TOOL_CHOICES = [
  ["roll20", "Roll20"],
  ["foundry", "Foundry VTT"],
  ["dndbeyond", "D&D Beyond"],
  ["owlbear", "Owlbear Rodeo"],
  ["other", "Other"],
  ["none", "None / In-person only"],
] as const;
type VttToolId = (typeof VTT_TOOL_CHOICES)[number][0];

type Phase = "boot" | "onboarding" | "loading" | "task" | "rating" | "complete" | "error";

interface StudySession {
  id: string;
  sequence: StudySequence;
  status: string;
}

interface SessionResponse {
  session: StudySession;
  progress: StudyProgress;
  error?: string;
}

interface RollEventDetail extends RollSelection {
  modifier: number;
}

interface ViewportSnapshot {
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

export default function VariantAPreview({ previewInterface }: { previewInterface?: DevelopmentInterfaceId }) {
  const isPreview = Boolean(previewInterface);
  const [phase, setPhase] = useState<Phase>("boot");
  const [session, setSession] = useState<StudySession | null>(null);
  const [interfaceId, setInterfaceId] = useState<DevelopmentInterfaceId>("A");
  const [taskIndex, setTaskIndex] = useState(0);
  const [interfaceReady, setInterfaceReady] = useState(false);
  const [taskActive, setTaskActive] = useState(false);
  const [canContinue, setCanContinue] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dicePanelOpen, setDicePanelOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [vttTools, setVttTools] = useState<VttToolId[]>([]);
  const [followUpOptIn, setFollowUpOptIn] = useState(false);
  const [completionSaving, setCompletionSaving] = useState(false);
  const [completionFinished, setCompletionFinished] = useState(false);

  const sessionRef = useRef<StudySession | null>(null);
  const interfaceIdRef = useRef<DevelopmentInterfaceId>("A");
  const taskRef = useRef<StudyTask | null>(null);
  const taskStartedAt = useRef(0);
  const taskActiveRef = useRef(false);
  const firstInteractionRef = useRef(false);
  const validRollRef = useRef(false);
  const validSavedRef = useRef(false);
  const animationDoneRef = useRef(false);
  const animationTaskRef = useRef<StudyTask | null>(null);
  const presentedTaskRef = useRef("");
  const helpRecordedRef = useRef(false);
  const sessionHelpRecordedRef = useRef(false);
  const interfaceReadyRecordedRef = useRef(new Set<DevelopmentInterfaceId>());
  const lastViewportRef = useRef<ViewportSnapshot | null>(null);
  const ratingPreparedRef = useRef(false);
  const beehiivMountRef = useRef<HTMLDivElement | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityAtRef = useRef(Date.now());
  const lastActivitySentAtRef = useRef(0);
  const expiringSessionRef = useRef(false);

  const tasks = useMemo(() => (session ? tasksForInterface(session.sequence, interfaceId) : []), [interfaceId, session]);
  const currentTask = tasks[taskIndex];

  useEffect(() => {
    let active = true;
    if (previewInterface) {
      const previewSequence: StudySequence = previewInterface === "A" ? "A-B-C" : previewInterface === "B" ? "B-A-C" : "C-A-B";
      const previewSession: StudySession = { id: "public-preview", sequence: previewSequence, status: "preview" };
      sessionRef.current = previewSession;
      setSession(previewSession);
      interfaceIdRef.current = previewInterface;
      setInterfaceId(previewInterface);
      setPhase("rating");
      return () => { active = false; };
    }
    const savedId = window.localStorage.getItem(STORAGE_KEY);
    if (!savedId) {
      setPhase("onboarding");
      return;
    }

    void fetch(`/api/study/session?id=${encodeURIComponent(savedId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as SessionResponse;
      })
      .then((data) => {
        if (active) configureSession(data);
      })
      .catch(() => {
        if (!active) return;
        window.localStorage.removeItem(STORAGE_KEY);
        setPhase("onboarding");
      });

    return () => {
      active = false;
    };
  }, [previewInterface]);

  useEffect(() => {
    if (!session || session.status !== "active" || phase === "complete") return;

    const expireSession = async () => {
      if (expiringSessionRef.current) return;
      expiringSessionRef.current = true;
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      window.localStorage.removeItem(STORAGE_KEY);
      try {
        await fetch("/api/study/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, action: "mark_incomplete" }),
          keepalive: true,
        });
      } finally {
        window.location.reload();
      }
    };

    const scheduleExpiration = () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      const remaining = Math.max(0, SESSION_INACTIVITY_MS - (Date.now() - lastActivityAtRef.current));
      inactivityTimerRef.current = setTimeout(() => void expireSession(), remaining);
    };

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastActivityAtRef.current >= SESSION_INACTIVITY_MS) {
        void expireSession();
        return;
      }
      lastActivityAtRef.current = now;
      scheduleExpiration();
      if (now - lastActivitySentAtRef.current >= 60_000) {
        lastActivitySentAtRef.current = now;
        void postStudyEvent(session.id, "participant_activity");
      }
    };

    lastActivityAtRef.current = Date.now();
    lastActivitySentAtRef.current = 0;
    expiringSessionRef.current = false;
    scheduleExpiration();
    const activityEvents = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") recordActivity();
    };
    for (const eventName of activityEvents) window.addEventListener(eventName, recordActivity, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      for (const eventName of activityEvents) window.removeEventListener(eventName, recordActivity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [phase, session]);

  useEffect(() => {
    const mount = beehiivMountRef.current;
    if (phase !== "complete" || completionFinished || !mount) return;
    mount.replaceChildren();
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://subscribe-forms.beehiiv.com/v3/loader.js";
    script.dataset.beehiivForm = "78981ef5-e692-4fa4-b798-2f759d7d5116";
    mount.appendChild(script);
    return () => mount.replaceChildren();
  }, [phase, completionFinished]);

  useEffect(() => {
    if (isPreview) return;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const recordResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const activeSession = sessionRef.current;
        if (!activeSession) return;
        const next = viewportSnapshot();
        const previous = lastViewportRef.current ?? next;
        if (viewportSignature(previous) === viewportSignature(next)) return;
        lastViewportRef.current = next;
        void postStudyEvent(
          activeSession.id,
          "viewport_resized",
          interfaceIdRef.current,
          taskRef.current?.id,
          { from: previous, to: next },
        );
      }, 300);
    };

    window.addEventListener("resize", recordResize);
    window.visualViewport?.addEventListener("resize", recordResize);
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", recordResize);
      window.visualViewport?.removeEventListener("resize", recordResize);
    };
  }, [isPreview]);

  useEffect(() => {
    if (isPreview) return;
    if (!session || !["loading", "task", "rating"].includes(phase)) return;
    const recordClick = (event: MouseEvent) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const control = target.closest<HTMLElement>("button, a, input, select, textarea, summary, canvas, [role='button'], #dice-stage");
      if (!control) return;
      const task = taskRef.current;
      void postStudyEvent(activeSession.id, "click_audit", interfaceIdRef.current, task?.id, {
        control: describeClickTarget(control),
        phase,
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
        xPercent: Math.round((event.clientX / Math.max(1, window.innerWidth)) * 1000) / 10,
        yPercent: Math.round((event.clientY / Math.max(1, window.innerHeight)) * 1000) / 10,
      });
    };
    document.addEventListener("click", recordClick, { capture: true });
    return () => document.removeEventListener("click", recordClick, { capture: true });
  }, [isPreview, phase, session]);

  useEffect(() => {
    const onReady = () => {
      setInterfaceReady(true);
      const activeSession = sessionRef.current;
      const activeInterface = interfaceIdRef.current;
      if (!isPreview && activeSession && !interfaceReadyRecordedRef.current.has(activeInterface)) {
        interfaceReadyRecordedRef.current.add(activeInterface);
        void postStudyEvent(activeSession.id, "interface_ready", activeInterface);
      }
    };
    const onInteraction = (event: Event) => {
      const activeSession = sessionRef.current;
      const task = taskRef.current;
      if (!activeSession || !task || !taskActiveRef.current || firstInteractionRef.current) return;
      firstInteractionRef.current = true;
      const control = (event as CustomEvent<Record<string, unknown>>).detail?.control;
      void postStudyEvent(activeSession.id, "first_interaction", interfaceIdRef.current, task.id, { control });
    };
    const onRoll = async (event: Event) => {
      const activeSession = sessionRef.current;
      const task = taskRef.current;
      if (!activeSession || !task || !taskActiveRef.current || validRollRef.current) return;
      const detail = (event as CustomEvent<RollEventDetail>).detail;
      if (!isValidSelection(detail, task.target)) {
        setFeedback({ kind: "error", text: "That roll does not match the target. Adjust the controls and try again." });
        await postStudyEvent(activeSession.id, "invalid_roll", interfaceIdRef.current, task.id, { selection: detail });
        return;
      }

      validRollRef.current = true;
      taskActiveRef.current = false;
      animationTaskRef.current = task;
      setTaskActive(false);
      setFeedback({ kind: "info", text: "Correct roll. Saving this trial…" });
      const elapsedMs = Math.max(1, Math.round(performance.now() - taskStartedAt.current));
      const saved = await postStudyEvent(activeSession.id, "valid_roll_initiated", interfaceIdRef.current, task.id, { elapsedMs, selection: detail });
      if (!saved) {
        setFeedback({ kind: "error", text: "This trial could not be saved. Refresh to retry it safely." });
        return;
      }
      validSavedRef.current = true;
      setFeedback({ kind: "success", text: "Correct roll recorded." });
      if (animationDoneRef.current) setCanContinue(true);
    };
    const onAnimationComplete = () => {
      const activeSession = sessionRef.current;
      const task = animationTaskRef.current;
      if (!activeSession || !task || animationDoneRef.current) return;
      animationDoneRef.current = true;
      void postStudyEvent(activeSession.id, "animation_completed", interfaceIdRef.current, task.id);
      if (validSavedRef.current) setCanContinue(true);
    };
    const onPanelVisibility = (event: Event) => {
      const open = (event as CustomEvent<{ open?: unknown }>).detail?.open;
      if (typeof open === "boolean") setDicePanelOpen(open);
    };

    window.addEventListener("dice-lab:interface-ready", onReady);
    window.addEventListener("dice-lab:interaction", onInteraction);
    window.addEventListener("dice-lab:roll-initiated", onRoll);
    window.addEventListener("dice-lab:animation-completed", onAnimationComplete);
    window.addEventListener("dice-lab:panel-visibility", onPanelVisibility);
    return () => {
      window.removeEventListener("dice-lab:interface-ready", onReady);
      window.removeEventListener("dice-lab:interaction", onInteraction);
      window.removeEventListener("dice-lab:roll-initiated", onRoll);
      window.removeEventListener("dice-lab:animation-completed", onAnimationComplete);
      window.removeEventListener("dice-lab:panel-visibility", onPanelVisibility);
    };
  }, [isPreview]);

  useEffect(() => {
    if (!session || (phase !== "loading" && phase !== "rating")) return;
    let active = true;
    void import("./main")
      .then(() => {
        if (active) setInterfaceReady(true);
      })
      .catch((error: unknown) => {
        console.error("Dice interface failed to start", error);
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [phase, session]);

  useEffect(() => {
    interfaceIdRef.current = interfaceId;
    if (!interfaceReady) return;
    window.dispatchEvent(new CustomEvent("dice-lab:set-interface", { detail: { interfaceId } }));
  }, [interfaceId, interfaceReady]);

  useEffect(() => {
    if (phase !== "rating" || !interfaceReady || ratingPreparedRef.current) return;
    ratingPreparedRef.current = true;
    taskActiveRef.current = false;
    validRollRef.current = false;
    setTaskActive(false);
    setCanContinue(false);
    setFeedback(null);
    setHelpOpen(false);
    setDicePanelOpen(true);
    window.dispatchEvent(new CustomEvent("dice-lab:prepare-task", {
      detail: { picks: {}, mode: "flat", modifier: 0, open: true, interfaceId },
    }));
  }, [interfaceId, interfaceReady, phase]);

  useEffect(() => {
    if (isPreview || !session || !interfaceReady || interfaceReadyRecordedRef.current.has(interfaceId)) return;
    interfaceReadyRecordedRef.current.add(interfaceId);
    void postStudyEvent(session.id, "interface_ready", interfaceId);
  }, [interfaceId, interfaceReady, isPreview, session]);

  useEffect(() => {
    if (!session || !interfaceReady || phase !== "loading") return;
    setPhase("task");
  }, [interfaceReady, phase, session]);

  useEffect(() => {
    if (!session || !currentTask || !interfaceReady || phase !== "task") return;
    if (presentedTaskRef.current === currentTask.id) return;
    presentedTaskRef.current = currentTask.id;
    taskRef.current = currentTask;
    taskActiveRef.current = false;
    firstInteractionRef.current = false;
    validRollRef.current = false;
    validSavedRef.current = false;
    animationDoneRef.current = false;
    animationTaskRef.current = null;
    helpRecordedRef.current = false;
    setTaskActive(false);
    setCanContinue(false);
    setHelpOpen(false);
    setFeedback({ kind: "info", text: "Preparing the controls…" });
    window.dispatchEvent(new CustomEvent("dice-lab:prepare-task", { detail: { ...currentTask.initial, interfaceId } }));

    let frameOne = 0;
    let frameTwo = 0;
    void postStudyEvent(session.id, "task_presented", interfaceId, currentTask.id).then((saved) => {
      if (!saved || taskRef.current?.id !== currentTask.id) {
        if (!saved) {
          setFeedback({ kind: "error", text: "The task could not be started. Refresh to try again." });
          setPhase("error");
        }
        return;
      }
      frameOne = requestAnimationFrame(() => {
        frameTwo = requestAnimationFrame(() => {
          taskStartedAt.current = performance.now();
          taskActiveRef.current = true;
          setTaskActive(true);
          setFeedback(null);
        });
      });
    });

    return () => {
      cancelAnimationFrame(frameOne);
      cancelAnimationFrame(frameTwo);
    };
  }, [currentTask, interfaceId, interfaceReady, phase, session]);

  function configureSession(data: SessionResponse): void {
    if (sessionRef.current?.id !== data.session.id) interfaceReadyRecordedRef.current.clear();
    sessionRef.current = data.session;
    lastViewportRef.current = viewportSnapshot();
    setSession(data.session);
    const next = nextSingleInterfaceStep(data.session.sequence, data.progress);
    presentedTaskRef.current = "";
    ratingPreparedRef.current = false;
    taskRef.current = null;
    taskActiveRef.current = false;
    setTaskActive(false);
    setCanContinue(false);
    setFormError("");
    if (next.kind === "complete") {
      setPhase("complete");
      return;
    }
    interfaceIdRef.current = next.interfaceId;
    setInterfaceId(next.interfaceId);
    if (next.kind === "task") {
      setTaskIndex(next.taskIndex);
      setPhase("loading");
      return;
    }
    setPhase("rating");
  }

  async function createSession(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError("");
    const form = new FormData(event.currentTarget);
    const selectedTools = form.getAll("vttTools").map(String) as VttToolId[];
    const vttOther = String(form.get("vttOther") ?? "").trim();
    if (selectedTools.length === 0) {
      setFormError("Please select at least one virtual tabletop option.");
      return;
    }
    if (selectedTools.includes("other") && !vttOther) {
      setFormError("Please tell us which other virtual tabletop you have used.");
      return;
    }
    setPhase("boot");
    try {
      const response = await fetch("/api/study/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: form.get("consent") === "on",
          profile: {
            vttTools: selectedTools,
            vttOther: selectedTools.includes("other") ? vttOther : null,
            vttComfort: Number(form.get("vttComfort")),
            diceFamiliarity: form.get("diceFamiliarity"),
          },
          viewport: viewportSnapshot(),
        }),
      });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok) throw new Error(data.error ?? "The anonymous session could not be created.");
      window.localStorage.setItem(STORAGE_KEY, data.session.id);
      configureSession(data);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : "The anonymous session could not be created.");
      setPhase("onboarding");
    }
  }

  function toggleVttTool(tool: VttToolId, checked: boolean): void {
    setVttTools((current) => {
      if (tool === "none") return checked ? ["none"] : [];
      const withoutNone = current.filter((value) => value !== "none");
      if (checked) return withoutNone.includes(tool) ? withoutNone : [...withoutNone, tool];
      return withoutNone.filter((value) => value !== tool);
    });
  }

  function continueToNextTask(): void {
    if (!canContinue) return;
    const next = taskIndex + 1;
    if (next < tasks.length) {
      presentedTaskRef.current = "";
      setTaskIndex(next);
      return;
    }
    setPhase("rating");
  }

  async function submitRating(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!session) return;
    const form = new FormData(event.currentTarget);
    const finalTask = tasks[tasks.length - 1];
    if (!finalTask) return;
    const comment = String(form.get("comment") ?? "").trim();
    if (!comment) {
      setFormError("Please answer all three questions before saving your rating.");
      return;
    }
    const ratingSaved = await postStudyEvent(session.id, "trial_rating_submitted", interfaceId, finalTask.id, {
      ease: Number(form.get("ease")),
      confidence: Number(form.get("confidence")),
      comment,
    });
    if (!ratingSaved) {
      setFormError("The rating could not be saved. Please submit it again.");
      return;
    }
    try {
      const response = await fetch(`/api/study/session?id=${encodeURIComponent(session.id)}`, { cache: "no-store" });
      const data = (await response.json()) as SessionResponse;
      if (!response.ok) throw new Error(data.error ?? "Progress could not be loaded.");
      const next = nextSingleInterfaceStep(data.session.sequence, data.progress);
      if (next.kind === "complete") {
        const completionSaved = await postStudyEvent(session.id, "study_completed", interfaceId, undefined, {
          scope: "single-random-interface",
        });
        if (!completionSaved) throw new Error("Completion could not be saved.");
      }
      configureSession(data);
    } catch {
      setFormError("Your rating was saved, but the next interface could not be loaded. Refresh to continue safely.");
    }
  }

  function openHelp(): void {
    const opening = !helpOpen;
    setHelpOpen(opening);
    if (!opening || !session || !currentTask) return;
    if (!helpRecordedRef.current) {
      helpRecordedRef.current = true;
      void postStudyEvent(session.id, "help_opened", interfaceId, currentTask.id);
    }
    if (!sessionHelpRecordedRef.current) {
      sessionHelpRecordedRef.current = true;
      void postStudyEvent(session.id, "help_opened_session", interfaceId, undefined, { sourceTaskId: currentTask.id });
    }
  }

  function reopenDicePanel(): void {
    setDicePanelOpen(true);
    window.dispatchEvent(new CustomEvent("dice-lab:open-panel"));
  }

  async function finishStudy(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!session) return;
    setFormError("");
    if (!followUpOptIn) {
      setCompletionFinished(true);
      return;
    }
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    if (!email) {
      setFormError("Enter an email address for the options you selected.");
      return;
    }
    setCompletionSaving(true);
    try {
      const response = await fetch("/api/study/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, email, newsletter: false, followUp: true }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Your contact preferences could not be saved.");
      setCompletionFinished(true);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : "Your contact preferences could not be saved.");
    } finally {
      setCompletionSaving(false);
    }
  }

  const isRating = phase === "rating";
  const taskLabel = isRating ? "Free play" : currentTask?.isPractice ? "Practice round" : `Scored task ${Math.max(1, taskIndex)} of 3`;
  const rootClass = `study-root${taskActive || isRating ? "" : " is-task-locked"}${isRating ? " is-rating" : ""}`;

  return (
    <div className={rootClass}>
      <header className="study-header">
        <div className="study-brand">
          <span className="study-mark" aria-hidden="true">20</span>
          <span><strong>Dice Interface Lab</strong><small>Virtual tabletop interaction study</small></span>
        </div>
        <div className="study-progress" aria-label="One randomly assigned interface">
          <span className="progress-label">One assigned interface</span>
          <span className="progress-dots" aria-hidden="true">
            <i className="is-current" />
          </span>
        </div>
        <div className="study-meta">
          <span className="variant-tag">Interface {interfaceId}</span>
          <span className="runtime-status" data-state={phase === "error" ? "error" : taskActive || phase === "rating" || phase === "complete" ? "ready" : "loading"}>
            {phase === "error" ? "Interface unavailable" : isRating ? "Free play" : taskActive ? "Task timing active" : phase === "complete" ? "Interface complete" : "Preparing interface"}
          </span>
        </div>
      </header>

      <aside id="roll-result-toast" role="status" aria-live="polite" aria-atomic="true" hidden>
        <span className="roll-result-toast-label">Roll result</span>
        <strong id="roll-result-toast-text" />
        <button id="roll-result-toast-close" type="button" aria-label="Close roll result">×</button>
      </aside>

      <main className="study-workspace">
        <aside id="rail">
          <div className="rail-heading">
            <span className="eyebrow">{taskLabel}</span>
            <h1>{isRating ? "Explore the dice set" : currentTask?.title ?? "Dice interface study"}</h1>
            <p>{isRating ? "Try any dice, roll mode, modifier, or size while you answer the questions." : currentTask?.instruction ?? "Your task will appear after the anonymous session is ready."}</p>
          </div>
          <div className="task-formula" aria-label={isRating ? "No target during free play" : `Target roll: ${currentTask?.formula ?? "not ready"}`}><span>{isRating ? "No target — experiment freely" : currentTask?.formula ?? "—"}</span></div>
          <button id="dice-open" type="button">Open dice controls</button>
          <div className="last-result"><span className="eyebrow">Last result</span><span className="status-detail" id="dice-result">Nothing thrown yet.</span></div>
          {!isRating && feedback && <p className={`task-feedback is-${feedback.kind}`} role="status">{feedback.text}</p>}
          {!isRating && canContinue && <button className="continue-button" type="button" onClick={continueToNextTask}>Continue</button>}
          {!isRating && <div className="help-accordion">
            <button className="help-button" type="button" onClick={openHelp} aria-expanded={helpOpen} aria-controls="task-help-content"><span>Task help</span><span className="help-chevron" aria-hidden="true">›</span></button>
            <div className="help-content" id="task-help-content" hidden={!helpOpen}>
              <p className="hint">Complete the target roll using the controls provided. <b>Hold</b> Roll to shake the cup, then release to pour.</p>
              <p className="hint" id="rail-character" />
              <div className="preview-note"><span aria-hidden="true">●</span>Anonymous development session. Practice is stored separately and excluded from the primary metric.</div>
            </div>
          </div>}
          {isRating && <p id="rail-character" hidden />}
          {isRating && <p className="hint">Free-play rolls are not included in scored task results.</p>}
          {isRating && <div className="preview-note"><span aria-hidden="true">●</span>The questionnaire remains available in the right panel while you explore.</div>}
        </aside>

        <section className="board-shell" aria-label="Virtual tabletop preview">
        </section>

        <div id="dice-stage" title="Click to clear the dice" hidden><canvas id="dice-stage-canvas" aria-label="Animated three-dimensional dice tray" /></div>
        <section id="dice-panel" aria-label={`Interface ${interfaceId} dice controls`} hidden>
          <div id="dice-panel-head"><span id="dice-panel-title">Roll Dice</span><button id="dice-settings" type="button" aria-label="Dice settings" aria-controls="dice-settings-layer" aria-expanded="false" title="Dice settings">⚙︎</button><button id="dice-sound" type="button" aria-pressed="true" aria-label="Sound">🔊</button><button id="dice-close" type="button" aria-label="Close">×</button></div>
          <div id="dice-type-block"><span className="dice-label">Dice</span><div className="dice-row" id="dice-type-row" /></div>
          <div id="dice-stepper-block" hidden><span className="dice-label">Dice</span><div id="dice-stepper-grid" /></div>
          <div id="dice-mode-block"><span className="dice-label">Advantage</span><div className="dice-row" id="dice-mode-row" /></div>
          <div id="dice-modifier-block"><span className="dice-label">Modifier</span><span id="dice-modifier-value" aria-live="polite">Current modifier +0</span><div className="dice-row" id="dice-modifier-row" /></div>
          <span id="dice-panel-line">Nothing thrown yet.</span>
          <div id="dice-actions"><button id="dice-reset" type="button">Reset</button><button id="dice-roll" type="button">Hold to roll</button></div>
          <button id="dice-clear" type="button">Clear dice</button>
        </section>
      </main>

      <div id="dice-settings-layer" hidden>
        <section id="dice-settings-modal" role="dialog" aria-modal="true" aria-labelledby="dice-settings-title" tabIndex={-1}>
          <div className="dice-settings-head"><h2 id="dice-settings-title">Dice settings</h2><button id="dice-settings-close" type="button" aria-label="Close dice settings">×</button></div>
          <p>Choose how large the dice appear in the three-dimensional tray.</p>
          <div id="dice-size-block"><span className="dice-label">Dice size</span><div className="dice-row" id="dice-size-row" /></div>
        </section>
      </div>

      {(phase === "boot" || phase === "onboarding") && !isPreview && (
        <div className="study-modal-layer">
          <form className="study-card onboarding-card" onSubmit={createSession}>
            <span className="eyebrow">Pre-Test Setup</span><h2>VTT Dice Roller Usability Test</h2>
            <p>You will test one randomly assigned dice-rolling interface. You&apos;ll complete 1 practice roll followed by 3 short tasks and a brief rating. Participation is completely anonymous—no personal data or emails are collected.</p>
            <div className="onboarding-questions">
              <div className="profile-grid">
                <fieldset className="profile-question">
                  <legend>Which virtual tabletop (VTT) or digital tools have you used?</legend>
                  <p className="question-helper">Select all that apply.</p>
                  <div className="vtt-tool-options">
                    {VTT_TOOL_CHOICES.map(([value, label]) => (
                      <label className="choice-option" key={value}>
                        <input type="checkbox" name="vttTools" value={value} checked={vttTools.includes(value)} onChange={(event) => toggleVttTool(value, event.currentTarget.checked)} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  {vttTools.includes("other") && <label className="other-vtt-input">Which other tool?<input type="text" name="vttOther" required maxLength={120} autoComplete="off" /></label>}
                </fieldset>

                <fieldset className="profile-question">
                  <legend>How experienced are you with virtual tabletop platforms?</legend>
                  <div className="scale-options" aria-label="Virtual tabletop experience from 1 to 5">
                    {[1, 2, 3, 4, 5].map((level) => <label className="scale-option" key={level}><input type="radio" name="vttComfort" value={level} required /><span>{level}</span></label>)}
                  </div>
                  <div className="scale-ends"><span><strong>Complete beginner</strong> / Rare user</span><span><strong>Power user</strong> / Frequent GM or player</span></div>
                </fieldset>

                <fieldset className="profile-question">
                  <legend>How familiar are you with standard polyhedral TTRPG dice (d4, d6, d8, d10, d12, d20)?</legend>
                  <div className="familiarity-options">
                    {[["unfamiliar", "Not Familiar", "New to tabletop dice systems"], ["somewhat", "Somewhat Familiar", "Recognize basic dice, still learning notations"], ["familiar", "Very Familiar", "Know standard sets, modifiers, and rolling notations"]].map(([value, label, description]) => <label className="scale-option familiarity-option" key={value}><input type="radio" name="diceFamiliarity" value={value} required /><span><strong>{label}</strong><small>{description}</small></span></label>)}
                  </div>
                </fieldset>
              </div>
              <label className="consent-row"><input type="checkbox" name="consent" required /><span>I agree to anonymous interaction and timing data collection for this test.</span></label>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <button className="primary-button" type="submit" disabled={phase === "boot"}>{phase === "boot" ? "Starting…" : "Begin Test"}</button>
            </div>
          </form>
        </div>
      )}

      {phase === "rating" && !isPreview && (
        <aside className="rating-dock" aria-label="Interface rating questions">
          <form className="study-card rating-card" onSubmit={submitRating}>
            <span className="eyebrow">Interface {interfaceId} complete</span><h2>Rate this interface</h2>
            <p>Use the dice playground on the left if you want to revisit the controls before answering.</p>
            <StudySelect name="ease" label="How easy was it to build the intended rolls?" options={ratingOptions("Very difficult", "Very easy")} />
            <StudySelect name="confidence" label="How confident were you that your rolls were correct?" options={ratingOptions("Not confident", "Very confident")} />
            <label>What would you keep, remove or add?<textarea name="comment" required maxLength={1000} rows={4} placeholder={'Tell us the "why" behind your thoughts.'} /></label>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button className="primary-button" type="submit">Save rating</button>
            {!dicePanelOpen && <button className="reopen-dice-button" type="button" onClick={reopenDicePanel}>Open dice controls</button>}
          </form>
        </aside>
      )}

      {phase === "rating" && isPreview && (
        <aside className="rating-dock" aria-label="Interactive interface preview">
          <section className="study-card rating-card">
            <span className="eyebrow">Interactive preview</span><h2>Interface {interfaceId}</h2>
            <p>Explore this dice-control variation directly. This preview does not record any participant data or affect the study results.</p>
            {!dicePanelOpen && <button className="reopen-dice-button" type="button" onClick={reopenDicePanel}>Open dice controls</button>}
            <a className="preview-return-link" href="/dashboard">Return to research dashboard</a>
          </section>
        </aside>
      )}

      {phase === "complete" && !completionFinished && (
        <div className="study-modal-layer">
          <div className="completion-shell">
            <section className="study-card completion-card post-study-card">
              <span className="completion-mark" aria-hidden="true">✓</span>
              <h2>That&apos;s the last roll. Thanks.</h2>
              <p>Your answers are already saved, anonymously. Nothing below is required.</p>
              <div className="beehiiv-signup-block">
                <h3>Get Alviss Quest updates</h3>
                <p>Join the email list for news, updates, and launch dates.</p>
                <div className="beehiiv-signup" ref={beehiivMountRef} />
              </div>
              <form className="post-study-followup-form" onSubmit={finishStudy}>
                <label className="post-study-choice"><input type="checkbox" checked={followUpOptIn} onChange={(event) => setFollowUpOptIn(event.currentTarget.checked)} /><span>I&apos;d be up for a follow-up question about my session.</span></label>
                {followUpOptIn && <label className="post-study-email">Email address<input type="email" name="email" autoComplete="email" maxLength={254} required /></label>}
                {followUpOptIn && <p className="post-study-privacy">Choosing session follow-up links this email to your anonymous session so we can contact you about it.</p>}
                {formError && <p className="form-error" role="alert">{formError}</p>}
                <button className="primary-button" type="submit" disabled={completionSaving}>{completionSaving ? "Saving…" : "Done"}</button>
              </form>
            </section>
            <nav className="completion-links" aria-label="Study completion links"><a href="/dashboard">View analytics dashboard</a></nav>
          </div>
        </div>
      )}

      {phase === "complete" && completionFinished && (
        <div className="study-modal-layer">
          <div className="completion-shell">
            <section className="study-card completion-card final-thanks-card">
              <span className="completion-mark" aria-hidden="true">✓</span><h2>You&apos;re all set.</h2><p>Your study is complete. You can close this window.</p>
            </section>
            <nav className="completion-links" aria-label="Study completion links"><a href="/dashboard">View analytics dashboard</a></nav>
          </div>
        </div>
      )}

      {phase === "error" && <div className="study-modal-layer"><section className="study-card"><span className="eyebrow">Study paused</span><h2>The interface needs to be reloaded</h2><p>Your completed trials are stored. Refreshing will resume at the first incomplete task.</p></section></div>}
    </div>
  );
}

function StudySelect({ name, label, options }: { name: string; label: string; options: readonly (readonly [string, string])[] }) {
  return <label>{label}<select name={name} required defaultValue=""><option value="" disabled>Select one</option>{options.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>;
}

function ratingOptions(low: string, high: string): readonly (readonly [string, string])[] {
  return [["1", `1 — ${low}`], ["2", "2"], ["3", "3"], ["4", "4"], ["5", `5 — ${high}`]];
}

function describeClickTarget(element: HTMLElement): string {
  const label = element.getAttribute("aria-label")
    || element.getAttribute("title")
    || element.id
    || (element instanceof HTMLInputElement ? `${element.type}:${element.name || "input"}` : "")
    || (element instanceof HTMLSelectElement ? `select:${element.name || "select"}` : "")
    || element.textContent
    || element.tagName.toLowerCase();
  return label.replace(/\s+/g, " ").trim().slice(0, 100);
}

async function postStudyEvent(sessionId: string, eventType: string, interfaceId?: string, taskId?: string, payload?: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch("/api/study/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        eventType,
        interfaceId,
        taskId,
        payload: { ...(payload ?? {}), viewport: viewportSnapshot() },
      }),
    });
    return response.ok;
  } catch (error: unknown) {
    console.error("Unable to record study event", error);
    return false;
  }
}

function viewportSnapshot(): ViewportSnapshot {
  const visual = window.visualViewport;
  const viewportWidth = Math.max(1, Math.round(window.innerWidth));
  const viewportHeight = Math.max(1, Math.round(window.innerHeight));
  return {
    viewportWidth,
    viewportHeight,
    visualViewportWidth: Math.max(1, Math.round(visual?.width ?? viewportWidth)),
    visualViewportHeight: Math.max(1, Math.round(visual?.height ?? viewportHeight)),
    visualViewportScale: visual?.scale ?? 1,
    screenWidth: Math.max(1, Math.round(window.screen.width)),
    screenHeight: Math.max(1, Math.round(window.screen.height)),
    devicePixelRatio: window.devicePixelRatio || 1,
    orientation: viewportWidth >= viewportHeight ? "landscape" : "portrait",
    capturedAt: Date.now(),
  };
}

function viewportSignature(snapshot: ViewportSnapshot): string {
  return [
    snapshot.viewportWidth,
    snapshot.viewportHeight,
    snapshot.visualViewportWidth,
    snapshot.visualViewportHeight,
    snapshot.visualViewportScale,
    snapshot.screenWidth,
    snapshot.screenHeight,
    snapshot.devicePixelRatio,
    snapshot.orientation,
  ].join(":");
}

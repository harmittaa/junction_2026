"use client";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { apiErrorSchema, viewSchema, type CoachView, type CoachRequest } from "@/shared/contracts";
import { useVoice } from "@/client/use-voice";
import { Coach } from "./coach";
import { Activities } from "./activities";
import { NoticedRow } from "./answer-cards";
import { CheckupWelcome, IdeasButton, IdeasSheet, Jar, WeeklyReward } from "./checkup-visuals";
import { StreakScreen } from "./streak-screen";
import "./checkup-screen.css";

type RequestState = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string; outdated?: boolean };
const ribbon = <svg viewBox="0 0 120 120"><path d="M69 10C107 34 39 80 77 110M43 10C81 34 13 80 51 110" /></svg>;
const bankCards = [["Accounts", "S-Tili · Taloustili"], ["Payments and e-invoices", "Make a new payment or view e-invoices"], ["Cards", "S-Etukortti Visa Credit/Debit"], ["Säästäjä", "Oma tavoitteeni"], ["Investments", "Value of your investments"]];
const questions = {
  pace: "Am I still on track?", usual: "What have I spent more on than usual?",
  profile: "What kind of spender am I?", taxi: "How much did I spend on taxis this year?",
  whatif: "What if I cut dining out by 20%?", days: "Which days pushed me over?", jar: "Show my jar",
};

class SessionLoadError extends Error {
  constructor(message: string, readonly outdated = false) { super(message); }
}
function sessionError(error: unknown): RequestState {
  return { kind: "error", message: error instanceof SessionLoadError ? error.message : "Could not open your coach. Check your connection and retry.", outdated: error instanceof SessionLoadError && error.outdated };
}
async function loadSession(signal?: AbortSignal, restart = false) {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch("/api/session", {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store",
    ...(restart ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new SessionLoadError(apiErrorSchema.parse(data).error, response.status === 409);
  return viewSchema.parse(data);
}

export function Sponky() {
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState<CoachView | null>(null);
  const [requestState, setRequestState] = useState<RequestState>({ kind: "idle" });
  const [voiceError, setVoiceError] = useState("");
  const [question, setQuestion] = useState("");
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [streakOpen, setStreakOpen] = useState(false);
  const [content, setContent] = useState(false);
  const [reward, setReward] = useState(false);
  const [revealKey, setRevealKey] = useState<number | undefined>();
  const [entryCaption, setEntryCaption] = useState(true);
  const activeRequest = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const lastRequest = useRef<CoachRequest | null>(null);
  const orb = useRef<HTMLDivElement>(null);
  const travelFrom = useRef<DOMRect | null>(null);
  const titleHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateTaps = useRef<number[]>([]);
  const streakPillRef = useRef<HTMLButtonElement>(null);
  const sounds = useRef<AudioContext | null>(null);
  const voice = useVoice({
    onTranscript: transcript => { if (view) void send({ action: "ask", revision: view.revision, text: transcript }); },
    onError: setVoiceError,
  });
  const busy = requestState.kind === "sending";
  const hasContent = content || !!view?.jar.overCents || (view?.activity.kind !== undefined && view.activity.kind !== "none");
  const { prepare } = voice;
  const ready = entered && view !== null;
  useEffect(() => { if (ready) prepare(); }, [ready, prepare]);
  const initialSessionLoaded = useEffectEvent((next: CoachView) => {
    setView(next);
    if (entered) void voice.speak(next.revision, true);
  });
  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal).then(next => {
      if (!controller.signal.aborted) initialSessionLoaded(next);
    }).catch(error => { if (!controller.signal.aborted) setRequestState(sessionError(error)); });
    return () => { controller.abort(); activeRequest.current?.abort(); sounds.current?.close(); if (titleHold.current) clearTimeout(titleHold.current); };
  }, []);
  useLayoutEffect(() => {
    const from = travelFrom.current;
    const element = orb.current;
    travelFrom.current = null;
    if (!from || !element || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = element.querySelector(".sp-coach-orb")!.getBoundingClientRect();
    const x = from.x + from.width / 2 - to.x - to.width / 2;
    const y = from.y + from.height / 2 - to.y - to.height / 2;
    const animation = element.animate([
      { transform: `translate(${x}px,${y}px) scale(${from.width / to.width})`, offset: 0 },
      { transform: `translate(${x + 62}px,${y * .48}px) scale(1.5)`, offset: .45 },
      { transform: "translate(-5px,5px) scale(.94)", offset: .84 },
      { transform: "translate(0,-3px) scale(1.03)", offset: .94 },
      { transform: "none", offset: 1 },
    ], { duration: 1150, easing: "cubic-bezier(.22,1,.36,1)" });
    return () => animation.cancel();
  }, [hasContent]);

  function unlockSound() {
    if (voice.muted) return;
    try { sounds.current ??= new AudioContext(); void sounds.current.resume(); } catch { /* Sound is optional. */ }
  }
  function chime() {
    const context = sounds.current;
    if (!context || voice.muted || context.state !== "running") return;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * .09;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.035, start + .015);
      gain.gain.exponentialRampToValueAtTime(.001, start + .35);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start); oscillator.stop(start + .36);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }
  function beginAnswer() {
    if (!hasContent) travelFrom.current = orb.current?.querySelector(".sp-coach-orb")?.getBoundingClientRect() ?? null;
    setContent(true); setEntryCaption(false);
  }
  function cancelRequest() {
    requestId.current++; activeRequest.current?.abort(); activeRequest.current = null;
    setRequestState({ kind: "idle" });
  }
  async function openSession(restart = false) {
    cancelRequest(); voice.cancel(); setReward(false);
    const controller = new AbortController(); activeRequest.current = controller;
    setRequestState({ kind: "sending" });
    try {
      const next = await loadSession(controller.signal, restart);
      if (controller.signal.aborted) return;
      setView(next); setRequestState({ kind: "idle" }); setVoiceError("");
      setContent(false); setQuestion(""); setEntryCaption(true); setRevealKey(undefined);
      if (entered) void voice.speak(next.revision, true);
    } catch (error) { if (!controller.signal.aborted) setRequestState(sessionError(error)); }
  }
  async function send(request: CoachRequest) {
    cancelRequest(); voice.cancel(); setVoiceError(""); unlockSound(); beginAnswer();
    if (request.action === "ask") setQuestion(request.text);
    if (request.action === "weekly-checkup") setQuestion("Let's do my check-up");
    if (request.action === "next-week") setQuestion("");
    const controller = new AbortController(); activeRequest.current = controller;
    const current = ++requestId.current; lastRequest.current = request;
    setRequestState({ kind: "sending" });
    try {
      const response = await fetch("/api/coach", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          lastRequest.current = null;
          setView(await loadSession(controller.signal));
          throw new Error("This session changed. Review the current answer before choosing another action.");
        }
        throw new Error(apiErrorSchema.parse(data).error);
      }
      const next = viewSchema.parse(data);
      if (current !== requestId.current) return;
      setView(next); setRequestState({ kind: "idle" });
      const completed = view && next.checkup.completedDates.length > view.checkup.completedDates.length;
      if (completed) setReward(true);
      else {
        const moved = next.move && (!view?.move || next.move.transactionId !== view.move.transactionId
          || next.move.from !== view.move.from || next.move.to !== view.move.to);
        if (moved) setRevealKey(undefined);
        else if ((next.activity.kind === "jar" || next.activity.kind === "spend_week") && request.action !== "select-month") setRevealKey(next.revision);
        void voice.speak(next.revision);
      }
    } catch (error) {
      if (current !== requestId.current || controller.signal.aborted) return;
      setRequestState({ kind: "error", message: error instanceof Error ? error.message : "Please retry. Your saved state is safe." });
    }
  }
  const nextWeek = useEffectEvent(() => { if (entered && view && !busy && !reward) void send({ action: "next-week", revision: view.revision }); });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "n" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
        && !(event.target instanceof HTMLElement && event.target.closest("input,textarea,[contenteditable=true]"))) nextWeek();
    };
    window.addEventListener("keydown", onKey);
    const cancelHold = () => { if (titleHold.current) clearTimeout(titleHold.current); titleHold.current = null; };
    window.addEventListener("blur", cancelHold);
    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener("copy", prevent);
    document.addEventListener("selectstart", prevent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", cancelHold);
      document.removeEventListener("copy", prevent);
      document.removeEventListener("selectstart", prevent);
    };
  }, []);
  function startCoach() { cancelRequest(); setVoiceError(""); unlockSound(); void voice.start(); }
  function clearHold() { if (titleHold.current) clearTimeout(titleHold.current); titleHold.current = null; }
  const coachState = voice.state === "listening" ? "listening" : voice.state === "speaking" ? "speaking"
    : busy || ["starting", "transcribing", "loading"].includes(voice.state) ? "thinking" : "ready";
  const isProfileAnalysis = view?.activity.kind === "analysis" && view.activity.analysis.kind === "profile";
  const hideCaptionVisual = !hasContent || !view || ["save", "goal", "spend_week", "jar"].includes(view.activity.kind) || isProfileAnalysis;
  const hideQuestionVisual = ["save", "goal"].includes(view?.activity.kind ?? "") || isProfileAnalysis;
  const showQuestion = Boolean(question && !hideQuestionVisual);
  const suggested = view?.jar.overCents
    ? [questions.days, questions.usual, questions.whatif, questions.profile, questions.taxi, questions.jar]
    : [questions.pace, questions.usual, questions.profile, questions.taxi, questions.whatif, questions.jar];
  const suggestions = suggested.filter(value => value !== question);

  if (!entered) return <main className="app bank">
    <header className="bank-header"><h1>S-Bank</h1></header>
    <ul className="bank-cards">{bankCards.map(([title, detail]) => <li key={title}><span className="bank-icon" aria-hidden="true">{ribbon}</span><span><strong>{title}</strong>{detail}</span><span className="bank-chevron" aria-hidden="true">›</span></li>)}</ul>
    <div className={`sponky-entry${view?.entryNoticed ? " has-bubble" : ""}`}>
      {view?.entryNoticed ? <button type="button" className="sponky-entry-bubble" onClick={() => {
        unlockSound();
        setEntered(true);
        if (view && view.entryNoticed) void send({ action: "ask", revision: view.revision, text: view.entryNoticed.question });
      }}>
        <span className="sponky-entry-kicker">Sponky noticed</span>
        <span className="sponky-entry-text">{view.entryNoticed.text}</span>
        <span className="sponky-entry-action">{view.entryNoticed.rule === "balance_lower" ? "Ask Sponky why ›" : `${view.entryNoticed.question} ›`}</span>
      </button> : <button type="button" className="sponky-entry-label-btn" onClick={() => {
        unlockSound();
        setEntered(true);
        if (view) void voice.speak(view.revision, true);
      }}>Ask Sponky</button>}
      <button type="button" className="sponky-entry-trigger" aria-label="Talk to Sponky" onClick={() => {
        unlockSound();
        setEntered(true);
        if (view) void voice.speak(view.revision, true);
      }}>
        <span className="sponky-entry-orb" aria-hidden="true">{ribbon}</span>
      </button>
    </div>
    <nav className="bank-tabs" aria-label="Bank app"><span>Home</span><span>S-Etukortti</span><span aria-current="page">Bank</span><span>Me</span></nav>
  </main>;

  return <main className={`app checkup-screen${hasContent ? "" : " intro"}`}>
    <header className="checkup-header">
      <button className="icon-button checkup-back" aria-label="Back to entry" onClick={() => { voice.cancel(); cancelRequest(); setEntered(false); }}>‹</button>
      <div className="checkup-heading"><h1 onPointerDown={event => { if (event.button !== 0) return; clearHold(); titleHold.current = setTimeout(() => void openSession(true), 1100); }}
        onPointerUp={clearHold} onPointerLeave={clearHold} onPointerCancel={clearHold} onContextMenu={event => event.preventDefault()}>Sponky</h1></div>
      <button ref={streakPillRef} type="button" className="checkup-streak" aria-label={`${view?.checkup.streak ?? 0} week check-up streak, open`} onClick={() => { const now = performance.now(); dateTaps.current = [...dateTaps.current.filter(t => now - t < 800), now]; if (dateTaps.current.length === 3) { dateTaps.current = []; if (view && !busy) void send({ action: "next-week", revision: view.revision }); return; } setStreakOpen(true); }}><span aria-hidden="true">♨</span> {view?.checkup.streak ?? 0} weeks</button>
      <button className="checkup-setting" aria-label={voice.muted ? "Sound off" : "Sound on"} aria-pressed={voice.muted} onClick={() => { voice.toggleMute(); if (!voice.muted) void sounds.current?.suspend(); }}>{voice.muted ? "♪̸" : "♪"}</button>
    </header>
    <section className="checkup-canvas" aria-label="Current answer" aria-busy={busy}>
      {view && !hasContent && <>
        <CheckupWelcome firstName={view.profile.firstName} date={view.demoDate} due={view.checkup.due} />
        <div className="checkup-welcome-stack">
          {view.entryNoticed && <NoticedRow noticed={view.entryNoticed} busy={busy} revision={view.revision} onAction={request => void send(request)} />}
          {view.upcomingNoticed && <NoticedRow noticed={view.upcomingNoticed} busy={busy} revision={view.revision} onAction={request => void send(request)} />}
          <IdeasButton due={view.checkup.due} onClick={() => setIdeasOpen(true)} className="checkup-ideas-welcome" />
          {view.checkup.due && <button type="button" className="checkup-welcome-checkup" disabled={busy} onClick={() => void send({ action: "weekly-checkup", revision: view.revision })}>Let&apos;s do my check-up</button>}
        </div>
      </>}
      {view && hasContent && !reward && <div className="checkup-answer" key={view.activity.kind === "jar" || view.activity.kind === "spend_week" ? "jar" : `${view.activity.kind}:${view.revision}`}>
        {(entryCaption && view.jar.overCents > 0) || view.activity.kind === "jar" || view.activity.kind === "spend_week" ? <Jar jar={view.jar} move={view.move} spendWeek={view.activity.kind === "spend_week" ? view.spendWeek : undefined} goal={view.goal} noticed={view.noticed} revision={view.revision} onAction={request => void send(request)} onAsk={text => void send({ action: "ask", revision: view.revision, text })} revealKey={revealKey} demoDate={view.demoDate} busy={busy} onSelectMonth={month => void send({ action: "select-month", revision: view.revision, month })} /> : <Activities view={view} busy={busy} countActive={voice.state !== "loading"} onAction={request => void send(request)} />}
      </div>}
    </section>
    {view && hasContent && !reward && <IdeasButton due={view.checkup.due} onClick={() => setIdeasOpen(true)} className="checkup-ideas-answer" />}
    <section className="checkup-talk" aria-label="Conversation">
      {showQuestion && <p className="checkup-question">{question}</p>}
      <p className={`coach-message${hideCaptionVisual ? " sr-only" : ""}`} aria-live="polite">{view ? entryCaption ? view.entryMessage : view.message : requestState.kind === "error" ? "Your coach could not open." : "Opening your coach…"}</p>
      {(requestState.kind === "error" || voiceError) && <div className="error" role="alert">
        <p>{requestState.kind === "error" ? requestState.message : voiceError}</p>
        {requestState.kind === "error" && <button className="text-button" onClick={() => { if (!view) void openSession(!!requestState.outdated); else if (lastRequest.current) void send(lastRequest.current); else void openSession(); }}>{requestState.outdated ? "Start fresh" : "Retry"}</button>}
        {voiceError && <>
          <button className="text-button" onClick={() => setIdeasOpen(true)}>Open ideas</button>
          <button className="text-button" onClick={() => setVoiceError("")}>Dismiss</button>
        </>}
      </div>}
      {view && <div className="checkup-chips" key={view.revision}>
        {view.move && <button disabled={busy} onClick={() => void send({ action: "undo-move", revision: view.revision })}>Undo basket move</button>}
        {suggestions.map(text => <button key={text} disabled={busy} onClick={() => void send({ action: "ask", revision: view.revision, text })}>{text}</button>)}
      </div>}
      {voice.state === "starting" && <p className="meta" role="status">Starting microphone…</p>}
      {voice.state === "transcribing" && <p className="meta" role="status">Finishing your words…</p>}
      {["starting", "transcribing", "loading"].includes(voice.state) && <button className="text-button" onClick={voice.cancel}>Cancel voice</button>}
      {busy && <button className="text-button" onClick={cancelRequest}>Stop waiting</button>}
    </section>
    <div ref={orb} className="checkup-orb"><Coach state={coachState} readBands={voice.readBands} onStart={startCoach}
      onRelease={() => void voice.stop()} onCancel={voice.cancel} starting={voice.state === "starting"} disabled={!view || reward} /></div>
    {view && reward && <WeeklyReward streak={view.checkup.streak} onChime={chime} onFinish={() => { setReward(false); setRevealKey(view.revision); void voice.speak(view.revision); }} />}
    {view && streakOpen && <StreakScreen view={view} streakJars={view.streakJars} busy={busy} onClose={() => { setStreakOpen(false); streakPillRef.current?.focus({ preventScroll: true }); }} onDoCheckup={() => { setStreakOpen(false); void send({ action: "weekly-checkup", revision: view.revision }); }} />}
    {view && ideasOpen && <IdeasSheet due={view.checkup.due} busy={busy} onClose={() => setIdeasOpen(false)} onCheckup={() => { setIdeasOpen(false); void send({ action: "weekly-checkup", revision: view.revision }); }} onAsk={text => { setIdeasOpen(false); void send({ action: "ask", revision: view.revision, text }); }} />}
  </main>;
}

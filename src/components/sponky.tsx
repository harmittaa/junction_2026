"use client";
import { useEffect, useRef, useState } from "react";
import { apiErrorSchema, viewSchema, type CoachView, type CoachRequest } from "@/shared/contracts";
import { useVoice } from "@/client/use-voice";
import { Coach } from "./coach";
import { Activities } from "./activities";
import { History } from "./history";

type RequestState = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string };
const ribbon = <svg viewBox="0 0 120 120"><path d="M69 10C107 34 39 80 77 110M43 10C81 34 13 80 51 110" /></svg>;
const bankCards = [["Accounts", "S-Tili · Taloustili"], ["Payments and e-invoices", "Make a new payment or view e-invoices"], ["Cards", "S-Etukortti Visa Credit/Debit"], ["Säästäjä", "Oma tavoitteeni"], ["Investments", "Value of your investments"]];
type HistoryEntry = { role: "user" | "coach"; text: string };

async function loadSession(signal?: AbortSignal) {
  const response = await fetch("/api/session", { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorSchema.parse(data).error);
  return viewSchema.parse(data);
}

export function Sponky() {
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState<CoachView | null>(null);
  const [text, setText] = useState("");
  const [requestState, setRequestState] = useState<RequestState>({ kind: "idle" });
  const [voiceError, setVoiceError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [dark, setDark] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const lastRequest = useRef<{ request: CoachRequest; draft?: number } | null>(null);
  const draftVersion = useRef(0);
  const voice = useVoice({
    onTranscript: transcript => {
      if (view) void send({ action: "ask", revision: view.revision, text: transcript });
    },
    onError: message => setVoiceError(message),
  });
  const busy = requestState.kind === "sending";

  async function refresh(signal?: AbortSignal) {
    const next = await loadSession(signal);
    setView(next);
    return next;
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadSession(controller.signal).then(next => {
      if (!controller.signal.aborted) setView(next);
    }).catch(() => {
      if (!controller.signal.aborted) setRequestState({ kind: "error", message: "Could not load the demo. Try reconnecting." });
    });
    return () => { controller.abort(); activeRequest.current?.abort(); };
  }, []);
  // The session cookie exists once the view loads; prefetch so holding to talk starts capture at once.
  const { prepare } = voice;
  const ready = entered && view !== null;
  useEffect(() => { if (ready) prepare(); }, [ready, prepare]);
  useEffect(() => {
    if (!celebrate) return;
    const timer = setTimeout(() => setCelebrate(false), 900);
    return () => clearTimeout(timer);
  }, [celebrate]);

  function cancelRequest() {
    requestId.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setRequestState({ kind: "idle" });
  }
  async function send(request: CoachRequest, submittedDraft?: number) {
    cancelRequest();
    voice.cancel();
    setVoiceError("");
    const controller = new AbortController();
    activeRequest.current = controller;
    const current = ++requestId.current;
    lastRequest.current = { request, draft: submittedDraft };
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
          await refresh(controller.signal);
          throw new Error("This session changed. Review the current activity before confirming a new action.");
        }
        throw new Error(apiErrorSchema.parse(data).error);
      }
      const next = viewSchema.parse(data);
      if (current !== requestId.current) return;
      setView(next);
      setHistory(previous => [...previous, ...(request.action === "ask" ? [{ role: "user" as const, text: request.text }] : []), { role: "coach" as const, text: next.message }].slice(-20));
      if (request.action === "ask" && draftVersion.current === submittedDraft) setText("");
      if (request.action === "complete" && view && next.completedDates.length > view.completedDates.length) setCelebrate(true);
      setRequestState({ kind: "idle" });
      void voice.speak(next.revision);
    } catch (error) {
      if (current !== requestId.current || controller.signal.aborted) return;
      setRequestState({ kind: "error", message: error instanceof Error ? error.message : "Please retry. Your saved state is safe." });
    }
  }
  function startCoach() {
    cancelRequest();
    setVoiceError("");
    void voice.start();
  }
  const coachState = voice.state === "listening" ? "listening" : voice.state === "speaking" ? "speaking"
    : busy || ["starting", "transcribing", "loading"].includes(voice.state) ? "thinking" : celebrate ? "celebrate" : "ready";
  function toggleTheme() {
    setDark(!dark);
    document.documentElement.dataset.theme = dark ? "light" : "dark";
  }

  if (!entered) return <main className="app bank">
    <header className="bank-header"><h1>S-Bank</h1></header>
    <ul className="bank-cards">
      {bankCards.map(([title, detail]) => <li key={title}><span className="bank-icon" aria-hidden="true">{ribbon}</span><span><strong>{title}</strong>{detail}</span><span className="bank-chevron" aria-hidden="true">›</span></li>)}
    </ul>
    <button className="sponky-entry" onClick={() => setEntered(true)}><span className="sponky-entry-label">Ask Sponky</span><span className="sponky-entry-orb" aria-hidden="true">{ribbon}</span><span className="sr-only">Talk to Sponky</span></button>
    <nav className="bank-tabs" aria-label="Bank app"><span>Home</span><span>S-Etukortti</span><span aria-current="page">Bank</span><span>Me</span></nav>
  </main>;

  return <main className="app">
    <header className="app-header"><button className="icon-button" aria-label="Back to entry" onClick={() => { voice.cancel(); cancelRequest(); setEntered(false); }}>‹</button><h1>Sponky<span>Your money, a little clearer</span></h1><button className="icon-button" aria-label={dark ? "Light appearance" : "Dark appearance"} onClick={toggleTheme}>{dark ? "☀" : "◐"}</button></header>
    <div className="toolbar"><button className="text-button" aria-pressed={voice.muted} onClick={voice.toggleMute}>{voice.muted ? "Sound off" : "Sound on"}</button><button className="text-button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>History</button></div>
    {showHistory && <History entries={history} onClose={() => setShowHistory(false)} />}
    <Coach state={coachState} readBands={voice.readBands} onStart={startCoach}
      onRelease={() => void voice.stop()} onCancel={voice.cancel} starting={voice.state === "starting"}
      disabled={!view} />
    {voice.state === "starting" && <p className="meta" role="status">Starting microphone…</p>}
    {voice.state === "transcribing" && <p className="meta" role="status">Finishing your words…</p>}
    {["starting", "transcribing", "loading"].includes(voice.state) && <button className="text-button replay" onClick={voice.cancel}>Cancel voice</button>}
    <p className="coach-message" aria-live="polite">{view?.message ?? "Opening your coach…"}</p>
    <form className="typing" data-visible={!!voiceError} onSubmit={event => { event.preventDefault(); if (view && text.trim()) void send({ action: "ask", revision: view.revision, text }, draftVersion.current); }}><label><span className="sr-only">Message</span><input value={text} maxLength={600} onChange={event => { draftVersion.current++; setText(event.target.value); }} placeholder="Type a message" /></label><button disabled={!view || busy || !text.trim()}>Send</button></form>
    {!view?.habit && view?.activity.kind === "none" && <div className="starters"><button disabled={busy} onClick={() => void send({ action: "ask", revision: view.revision, text: "How much did I spend on groceries last month?" })}>My August groceries ↗</button><button disabled={busy} onClick={() => void send({ action: "ask", revision: view.revision, text: "I've had a long day." })}>Talk about my day ↗</button></div>}
    {view && <Activities view={view} busy={busy} onAction={request => void send(request)} />}
    {view?.habit && view.activity.kind !== "checkin" && <button className="checkin-entry" disabled={busy} onClick={() => void send({ action: "checkin", revision: view.revision })}>Daily check-in <span aria-hidden="true">↗</span></button>}
    {requestState.kind === "error" && <div className="error" role="alert"><p>{requestState.message}</p><button className="text-button" onClick={() => {
      if (lastRequest.current) void send(lastRequest.current.request, lastRequest.current.draft);
      else void refresh().then(() => setRequestState({ kind: "idle" })).catch(() => setRequestState({ kind: "error", message: "Still unavailable. Please try again shortly." }));
    }}>Retry</button></div>}
    {voiceError && <div className="error" role="alert"><p>{voiceError}</p><p>Typing is always available.</p><button className="text-button" onClick={() => setVoiceError("")}>Dismiss</button></div>}
    {busy && <button className="text-button" onClick={cancelRequest}>Stop waiting</button>}
    {view && !busy && voice.state === "ready" && view.revision > 0 && <button className="text-button replay" disabled={voice.muted} onClick={() => void voice.speak(view.revision)}>Play reply</button>}
    <details className="demo-controls"><summary>Demo controls</summary><p className="demo-date">Simulated date {view?.demoDate ?? "2026-09-01"}</p><button className="secondary" disabled={!view || busy} onClick={() => { if (view) void send({ action: "advance", revision: view.revision, confirmed: true }); }}>Advance simulated day</button></details>
  </main>;
}

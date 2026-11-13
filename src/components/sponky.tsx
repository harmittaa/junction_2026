"use client";
import { useEffect, useState } from "react";
import { viewSchema, type CoachView, type CoachRequest } from "@/shared/contracts";
import { euros } from "@/domain/spending";

export function Sponky() {
  const [view, setView] = useState<CoachView | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/session").then(r => r.json()).then(data => setView(viewSchema.parse(data))).catch(() => setError("Could not load the demo. Please refresh.")); }, []);
  async function send(request: CoachRequest) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setView(viewSchema.parse(data)); setText("");
    } catch (e) { setError(e instanceof Error ? e.message : "Please retry."); }
    finally { setBusy(false); }
  }
  return <main className="app"><header><span className="eyebrow">SYNTHETIC DATA · DEMO</span><h1>Sponky</h1></header>
    <p className="meta">Simulated date: {view?.demoDate ?? "2024-11-04"}</p>
    <div className="stage"><div className="coach" data-state={busy ? "thinking" : "ready"}><svg viewBox="0 0 120 120" aria-hidden="true"><path d="M69 10C107 34 39 80 77 110M43 10C81 34 13 80 51 110" /></svg></div><strong>{busy ? "Thinking…" : "Your money, a little clearer"}</strong></div>
    <p aria-live="polite">{view?.message ?? "Opening your coach…"}</p>
    {view?.activity.kind === "invitation" && <section className="card"><h2>Curious what it adds up to?</h2><button disabled={busy} onClick={() => send({ action: "reveal", revision: view.revision, guessCents: null })}>Show me</button></section>}
    {view?.activity.kind === "reveal" && <section className="card"><h2>{view.activity.spending.query.category}</h2><p className="amount">{euros(view.activity.spending.totalCents)}</p><details><summary>See {view.activity.spending.evidence.length} transactions</summary>{view.activity.spending.evidence.map(row => <p key={row.id}>{row.date} · {row.merchant} · {euros(row.amountCents)} <small>Source row {row.sourceRow}</small></p>)}</details></section>}
    {error && <p role="alert" className="error">{error}</p>}
    <form className="typing" onSubmit={e => { e.preventDefault(); if (view && text.trim()) void send({ action: "ask", revision: view.revision, text }); }}><label><span className="sr-only">Message</span><input value={text} maxLength={600} onChange={e => setText(e.target.value)} placeholder="Or type here" /></label><button disabled={!view || busy || !text.trim()}>Send</button></form>
    <p className="meta">Historical records. No bank connection. No money moves.</p>
  </main>;
}

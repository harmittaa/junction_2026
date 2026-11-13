"use client";

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { basketLabels, type Basket, type CoachRequest, type CoachView, type Habit, type Spending, type SpendingQuery } from "@/shared/contracts";
import { euros, percentageScenario } from "@/domain/spending";
import "./activities.css";

type Actions = { busy: boolean; onAction: (request: CoachRequest) => void; revision: number };
const baskets: Basket[] = ["regular", "unexpected", "everyday"];
const subscribeMotion = (notify: () => void) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotion = () => true;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="sp-card"><h2>{title}</h2>{children}</section>;
}

function Period({ query, count }: { query: SpendingQuery; count?: number }) {
  return <p className="sp-meta">Historical · {query.start} – {query.end}
    {count !== undefined && <> · {count} {count === 1 ? "transaction" : "transactions"}</>}</p>;
}

export function GuessCard({ query, busy, revision, onAction }: Actions & { query: SpendingQuery }) {
  const [guessing, setGuessing] = useState(false);
  const [guess, setGuess] = useState("20");
  const id = useId();
  // Parse the decimal input into cents without floating-point euro arithmetic.
  const valid = /^\d+(?:\.\d{1,2})?$/.test(guess);
  const [whole, fraction = ""] = guess.split(".");
  const cents = valid ? Number(whole) * 100 + Number(fraction.padEnd(2, "0")) : NaN;
  const canSubmit = Number.isSafeInteger(cents) && cents >= 0 && cents <= 10000000;
  return <Card title={guessing ? `Your guess for ${query.category.toLowerCase()}?` : "Curious what it adds up to?"}>
    <Period query={query} />
    <fieldset disabled={busy}>
      {!guessing ? <><p>Try an estimate, or go straight to the real number.</p>
        <div className="sp-actions"><button type="button" onClick={() => setGuessing(true)}>Guess first</button>
          <button className="sp-secondary" type="button" onClick={() => onAction({ action: "reveal", revision, guessCents: null })}>Show me</button></div></> :
        <form onSubmit={e => { e.preventDefault(); if (canSubmit) onAction({ action: "reveal", revision, guessCents: cents }); }}>
          <label className="sp-guess-amount" htmlFor={`${id}-number`}>Your estimate (€)
            <input id={`${id}-number`} type="number" inputMode="decimal" min="0" max="100000" step="0.01"
              value={guess} onChange={e => setGuess(e.target.value)} aria-describedby={`${id}-hint`} required /></label>
          <label className="sp-sr" htmlFor={`${id}-range`}>Estimate slider, 0 to 200 euros</label>
          <input id={`${id}-range`} className="sp-range" type="range" min="0" max="200" step="5"
            value={canSubmit ? Math.min(200, cents / 100) : 0} onChange={e => setGuess(e.target.value)} />
          <div className="sp-range-labels"><span>0 €</span><span>200 €</span></div>
          <p id={`${id}-hint`} className="sp-meta">Thinking above 200 €? Type any amount up to 100 000 €.</p>
          <div className="sp-actions"><button disabled={!canSubmit}>Lock in my guess</button>
            <button className="sp-secondary" type="button" onClick={() => onAction({ action: "reveal", revision, guessCents: null })}>Show me instead</button></div>
        </form>}
    </fieldset>
  </Card>;
}

function CountAmount({ cents }: { cents: number }) {
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let frame: number;
    let start: number | undefined;
    const tick = (time: number) => {
      start ??= time;
      const progress = Math.min(1, (time - start) / 950);
      setAnimated(Math.round(cents * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents, reduced]);
  return <><span aria-hidden="true">{euros(reduced ? cents : animated)}</span><span className="sp-sr">{euros(cents)}</span></>;
}

export function RevealCard({ spending, guessCents, children }: {
  spending: Spending; guessCents: number | null; children?: ReactNode;
}) {
  const maximum = Math.max(spending.totalCents, guessCents ?? 0, 1);
  return <Card title={spending.query.category}>
    <Period query={spending.query} count={spending.evidence.length} />
    <p className="sp-amount"><CountAmount key={spending.totalCents} cents={spending.totalCents} /></p>
    {guessCents !== null && <div className="sp-comparison">
      <div className="sp-bar-label"><span>Your guess</span><strong>{euros(guessCents)}</strong></div>
      <div className="sp-track"><div className="sp-bar sp-bar-guess" style={{ width: `${guessCents / maximum * 100}%` }} /></div>
      <div className="sp-bar-label"><span>Actual</span><strong>{euros(spending.totalCents)}</strong></div>
      <div className="sp-track"><div className="sp-bar" style={{ width: `${spending.totalCents / maximum * 100}%` }} /></div>
      <p className="sp-meta">{guessCents === spending.totalCents ? "Right on the number." : `Your estimate was ${euros(Math.abs(guessCents - spending.totalCents))} ${guessCents < spending.totalCents ? "below" : "above"} the actual amount.`} No right or wrong way to start noticing.</p>
    </div>}
    {children}
  </Card>;
}

function CorrectionRow({ row, busy, revision, onAction }: Actions & { row: Spending["evidence"][number] }) {
  const [basket, setBasket] = useState<Basket>(row.basket);
  const id = useId();
  return <li className="sp-evidence-row">
    <div className="sp-bar-label"><strong>{row.merchant}</strong><strong>{euros(row.amountCents)}</strong></div>
    <p className="sp-meta">{row.date} · Source row {row.sourceRow}</p>
    <label htmlFor={id}>Basket interpretation</label>
    <select id={id} value={basket} disabled={busy} onChange={e => {
      const selected = baskets.find(b => b === e.target.value);
      if (selected) setBasket(selected);
    }}>{baskets.map(b => <option key={b} value={b}>{basketLabels[b]}</option>)}</select>
    {basket !== row.basket && <button type="button" disabled={busy}
      onClick={() => onAction({ action: "correct", revision, transactionId: row.id, basket, confirmed: true })}>Confirm correction</button>}
  </li>;
}

export function EvidenceCard({ spending, ...actions }: Actions & { spending: Spending }) {
  return <Card title="Three ways to understand spending">
    <p>These baskets are interpretations, not judgments. Everyday spending can include essentials such as groceries. You know the context best.</p>
    <ul className="sp-basket-list">{baskets.map(basket => <li key={basket} className="sp-basket" data-basket={basket}>
      <span>{basketLabels[basket]}</span><strong>{euros(spending.baskets[basket])}</strong>
    </li>)}</ul>
    <details><summary>Evidence & basket corrections ({spending.evidence.length})</summary>
      <p className="sp-meta">A correction changes the interpretation, never the historical amount.</p>
      <ul className="sp-evidence">{spending.evidence.map(row => <CorrectionRow key={`${row.id}:${row.basket}`} row={row} {...actions} />)}</ul>
      {spending.evidence.length === 0 && <p>No recorded spending in this period.</p>}
    </details>
  </Card>;
}

export function ScenarioCard({ spending, confirmed, busy, revision, onAction }: Actions & {
  spending: Spending; confirmed: Extract<CoachView["activity"], { kind: "reveal" }>["scenario"];
}) {
  const [percent, setPercent] = useState(confirmed?.percent ?? 20);
  const id = useId();
  const preview = percentageScenario(spending.baskets.everyday, percent);
  const matches = confirmed && confirmed.percent === percent && confirmed.baseCents === preview.baseCents;
  return <Card title="A little what-if">
    <p>Hypothetically reduce the selected everyday basket. This is an experiment, not a recommendation to cut necessities.</p>
    <fieldset disabled={busy}>
      <label htmlFor={id}>Reduction · <strong>{percent}%</strong></label>
      <input id={id} className="sp-range" type="range" min="0" max="100" step="1" value={percent} onChange={e => setPercent(Number(e.target.value))} />
      <div className="sp-scenario"><span>Everyday base <strong>{euros(preview.baseCents)}</strong></span>
        <span>Hypothetical reduction <strong>{euros(preview.reductionCents)}</strong></span>
        <span>Would remain <strong>{euros(preview.remainingCents)}</strong></span></div>
      <p className="sp-meta">{matches ? `Calculation confirmed: ${euros(confirmed.reductionCents)} hypothetical reduction. No money has been saved or moved.` : "Instant preview · ask Sponky to confirm the calculation. Historical spending stays unchanged."}</p>
      <button type="button" disabled={!!matches} onClick={() => onAction({ action: "scenario", revision, percent })}>{matches ? "Calculation confirmed" : "Confirm what-if"}</button>
    </fieldset>
  </Card>;
}

export function HabitCard({ habit, category, onCancel, busy, revision, onAction }: Actions & {
  habit: Habit | null; category: string; onCancel: () => void;
}) {
  const [action, setAction] = useState(habit?.action ?? `Notice my ${category.toLowerCase()} spending each day`);
  const [goal, setGoal] = useState(habit?.goal ?? "");
  const [selectedCategory, setSelectedCategory] = useState(habit?.category ?? category);
  const id = useId();
  return <Card title={habit ? "Make this habit yours" : "One small daily habit"}>
    <p>Choose something worth noticing. No spending target required.</p>
    <form onSubmit={e => { e.preventDefault(); if (action.trim().length >= 3 && selectedCategory.trim()) onAction({ action: "habit", revision,
      habit: { category: selectedCategory.trim(), action: action.trim(), goal: goal.trim() }, confirmed: true }); }}>
      <fieldset disabled={busy}>
        <label htmlFor={`${id}-category`}>Category</label>
        <input id={`${id}-category`} value={selectedCategory} maxLength={60} required onChange={e => setSelectedCategory(e.target.value)} />
        <label htmlFor={`${id}-action`}>My daily action</label>
        <textarea id={`${id}-action`} value={action} minLength={3} maxLength={160} required onChange={e => setAction(e.target.value)} />
        <label htmlFor={`${id}-goal`}>Goal label <span className="sp-meta">(optional)</span></label>
        <input id={`${id}-goal`} value={goal} maxLength={80} onChange={e => setGoal(e.target.value)} placeholder="Something I’m working towards" />
        <div className="sp-actions"><button disabled={action.trim().length < 3 || !selectedCategory.trim()}>Confirm habit</button>
          <button type="button" className="sp-secondary" onClick={onCancel}>Not now</button></div>
      </fieldset>
    </form>
  </Card>;
}

export function CheckinCard({ spending, completed, habit, completedDates, demoDate, busy, revision, onAction }: Actions & {
  spending: Spending; completed: boolean; habit: Habit | null; completedDates: string[]; demoDate: string;
}) {
  const [reflection, setReflection] = useState<"done" | "adjust" | "reflect" | null>(null);
  const id = useId();
  return <Card title={completed ? "A moment well spent" : "A moment for your day"}>
    <p className="sp-meta">Simulated historical date · {demoDate}</p>
    <p>{spending.query.category} · daily spending</p><p className="sp-amount">{euros(spending.totalCents)}</p>
    <Period query={spending.query} count={spending.evidence.length} />
    {spending.totalCents === 0 && <p>No recorded spending today. There is still room to reflect.</p>}
    {habit && <div className="sp-habit-context"><strong>Your daily action</strong><p>{habit.action}</p>{habit.goal && <p className="sp-meta">For: {habit.goal}</p>}</div>}
    {completed ? <><p className="sp-complete" role="status">✓ Check-in complete</p>
      <p className="sp-days"><strong>{new Set(completedDates).size}</strong> completed reflection {new Set(completedDates).size === 1 ? "day" : "days"}</p>
      <p className="sp-meta">Your reflections count. No points or missed-day penalties.</p></> :
      <form onSubmit={e => { e.preventDefault(); if (reflection) onAction({ action: "complete", revision, reflection, confirmed: true }); }}>
        <fieldset disabled={busy}><legend>How did your action fit today?</legend>
          {([{ value: "done", label: "I followed my action" }, { value: "adjust", label: "I’d like to adjust" }, { value: "reflect", label: "I’m just reflecting today" }] as const).map(option =>
            <label className="sp-radio" key={option.value}><input type="radio" name={id} checked={reflection === option.value} onChange={() => setReflection(option.value)} />{option.label}</label>)}
          <button disabled={!reflection}>Complete check-in</button>
        </fieldset>
      </form>}
  </Card>;
}

function RevealedActivity({ view, activity, ...actions }: Actions & {
  view: CoachView; activity: Extract<CoachView["activity"], { kind: "reveal" }>;
}) {
  const [branch, setBranch] = useState<"summary" | "explore" | "habit">("summary");
  return <>
    <RevealCard spending={activity.spending} guessCents={activity.guessCents}>
      <div className="sp-actions">
        {branch !== "explore" && <button type="button" className="sp-secondary" disabled={actions.busy} onClick={() => setBranch("explore")}>Explore this</button>}
        {branch !== "habit" && !view.habit && <button type="button" disabled={actions.busy} onClick={() => setBranch("habit")}>Keep an eye on it</button>}
        {branch !== "summary" && <button className="sp-secondary" type="button" onClick={() => setBranch("summary")}>Close details</button>}
      </div>
    </RevealCard>
    {branch === "explore" && <><EvidenceCard spending={activity.spending} {...actions} />
      <ScenarioCard spending={activity.spending} confirmed={activity.scenario} {...actions} /></>}
    {branch === "habit" && <HabitCard key={JSON.stringify(view.habit)} habit={view.habit} category={activity.spending.query.category}
      onCancel={() => setBranch("summary")} {...actions} />}
  </>;
}

export function Activities({ view, busy, onAction }: { view: CoachView; busy: boolean; onAction: (request: CoachRequest) => void }) {
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const editingHabit = editingRevision === view.revision;
  const { activity } = view;
  const actions = { busy, onAction, revision: view.revision };
  const activityKey = activity.kind === "none" ? "none" : JSON.stringify(activity.kind === "invitation" ? activity.query : activity.spending.query);
  return <div className="sp-activities" aria-busy={busy}>
    {view.habit && <aside className="sp-saved-habit"><div><strong>My daily habit · {view.habit.category}</strong><p>{view.habit.action}</p>
      {view.habit.goal && <span className="sp-meta">For: {view.habit.goal}</span>}</div>
      <button type="button" className="sp-secondary" disabled={busy} onClick={() => setEditingRevision(editingHabit ? null : view.revision)}>{editingHabit ? "Close edit" : "Edit"}</button></aside>}
    {editingHabit && view.habit && <HabitCard key={JSON.stringify(view.habit)} habit={view.habit} category={view.habit.category} onCancel={() => setEditingRevision(null)} {...actions} />}
    {activity.kind === "invitation" && <GuessCard key={activityKey} query={activity.query} {...actions} />}
    {activity.kind === "reveal" && <RevealedActivity key={`${activityKey}:${JSON.stringify(view.habit)}`} view={view} activity={activity} {...actions} />}
    {activity.kind === "checkin" && <CheckinCard key={view.demoDate} spending={activity.spending} completed={activity.completed}
      habit={view.habit} completedDates={view.completedDates} demoDate={view.demoDate} {...actions} />}
  </div>;
}

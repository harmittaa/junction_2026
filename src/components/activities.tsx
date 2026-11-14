"use client";

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { basketLabels, type Analysis, type Basket, type CoachRequest, type CoachView, type Habit, type Spending, type SpendingQuery } from "@/shared/contracts";
import { euros, percentageScenario, queryLabel } from "@/domain/spending";
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
  return <p className="sp-meta">{query.start} – {query.end}
    {count !== undefined && <> · {count} {count === 1 ? "transaction" : "transactions"}</>}</p>;
}

function Assumptions({ assumptions }: { assumptions: string[] }) {
  return assumptions.length > 0 ? <details className="sp-assumptions"><summary>How it adds up</summary>
    <ul className="sp-meta">{assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
  </details> : null;
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
  return <Card title={guessing ? `Your guess for ${queryLabel(query).toLowerCase()}?` : "Curious what it adds up to?"}>
    {!guessing && <p>{queryLabel(query)}</p>}
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
  return <Card title={queryLabel(spending.query)}>
    <Period query={spending.query} count={spending.evidenceCount} />
    <p className="sp-amount"><CountAmount key={spending.totalCents} cents={spending.totalCents} /></p>
    <Assumptions assumptions={spending.assumptions} />
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

function CorrectionRow({ row, correctable, busy, revision, onAction }: Actions & { row: Spending["evidence"][number]; correctable: boolean }) {
  const [basket, setBasket] = useState<Basket>(row.basket);
  const id = useId();
  return <li className="sp-evidence-row">
    <div className="sp-bar-label"><strong>{row.merchant}</strong><strong>{euros(row.amountCents)}</strong></div>
    <p className="sp-meta">{row.date} · {row.category} · Source row {row.sourceRow}</p>
    {correctable && <><label htmlFor={id}>Basket interpretation</label>
    <select id={id} value={basket} disabled={busy} onChange={e => {
      const selected = baskets.find(b => b === e.target.value);
      if (selected) setBasket(selected);
    }}>{baskets.map(b => <option key={b} value={b}>{basketLabels[b]}</option>)}</select>
    {basket !== row.basket && <button type="button" disabled={busy}
      onClick={() => onAction({ action: "correct", revision, transactionId: row.id, basket, confirmed: true })}>Confirm correction</button>}</>}
  </li>;
}

function Evidence({ evidence, evidenceCount, correctable, ...actions }: Actions & {
  evidence: Spending["evidence"]; evidenceCount: number; correctable: boolean;
}) {
  const limited = evidence.length < evidenceCount;
  return <details><summary>Evidence{correctable ? " & basket corrections" : ""} ({evidenceCount})</summary>
    <p className="sp-meta">Showing {evidence.length} of {evidenceCount} source transactions{limited ? "; this list is limited. Calculated results use all matching records." : "."}</p>
    {correctable && <p className="sp-meta">A correction changes the basket, never the payment amount.</p>}
    <ul className="sp-evidence">{evidence.map(row => <CorrectionRow key={`${row.id}:${row.basket}`} row={row} correctable={correctable} {...actions} />)}</ul>
    {evidenceCount === 0 && <p>No matching source transactions in this period.</p>}
  </details>;
}

export function AnalysisCard({ analysis, ...actions }: Actions & { analysis: Analysis }) {
  return <Card title={analysis.title}>
    <p className="sp-meta">{queryLabel(analysis.query)}</p>
    <Period query={analysis.query} count={analysis.kind === "comparison" || analysis.kind === "whatif" ? undefined : analysis.evidenceCount} />
    {analysis.kind === "whatif" && <p className="sp-meta">Hypothetical calculation · no money has been saved or moved.</p>}
    {analysis.sections.map((section, sectionIndex) => <section className="sp-analysis-section" key={sectionIndex} aria-label={section.label}>
      <h3>{section.label}</h3>
      <ul className="sp-analysis-rows">{section.rows.map((row, rowIndex) => {
        const countUnit = row.label === "Monthly average (complete months)" || section.label === "Most variable category (monthly range)" ? "month" : "transaction";
        return <li key={rowIndex}>
        <div className="sp-bar-label"><span>{row.label}</span><strong>{analysis.kind === "comparison" && row.label === "Difference (selected period minus comparison period)" && row.amountCents > 0 ? "+" : ""}{euros(row.amountCents)}</strong></div>
        {(row.count !== null || row.sharePercent !== null) && <p className="sp-meta">
          {row.count !== null && <>{row.count} {countUnit}{row.count === 1 ? "" : "s"}</>}
          {row.count !== null && row.sharePercent !== null && " · "}
          {row.sharePercent !== null && <>{new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 }).format(row.sharePercent)}% of selected spending</>}
        </p>}
        {row.sharePercent !== null && <div className="sp-track" aria-hidden="true"><div className="sp-bar" style={{ width: `${row.sharePercent}%` }} /></div>}
      </li>; })}</ul>
      {section.rows.length === 0 && <p className="sp-meta">No matching results for this section.</p>}
    </section>)}
    <Assumptions assumptions={analysis.assumptions} />
    <Evidence evidence={analysis.evidence} evidenceCount={analysis.evidenceCount} correctable={analysis.kind !== "cashflow"} {...actions} />
  </Card>;
}

export function EvidenceCard({ spending, ...actions }: Actions & { spending: Spending }) {
  return <Card title="Three ways to understand spending">
    <p>These baskets are interpretations, not judgments. Everyday spending can include essentials such as groceries. You know the context best.</p>
    <ul className="sp-basket-list">{baskets.map(basket => <li key={basket} className="sp-basket" data-basket={basket}>
      <span>{basketLabels[basket]}</span><strong>{euros(spending.baskets[basket])}</strong>
    </li>)}</ul>
    <Evidence evidence={spending.evidence} evidenceCount={spending.evidenceCount} correctable {...actions} />
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
    <p>{queryLabel(spending.query)} · daily spending</p><p className="sp-amount">{euros(spending.totalCents)}</p>
    <Period query={spending.query} count={spending.evidenceCount} />
    <Assumptions assumptions={spending.assumptions} />
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

export function Activities({ view, busy, onAction }: { view: CoachView; busy: boolean; onAction: (request: CoachRequest) => void }) {
  const { activity, jar } = view;
  const actions = { busy, onAction, revision: view.revision };
  return <div className="sp-activities" aria-busy={busy}>
    {activity.kind === "reveal" && <RevealCard spending={activity.spending} guessCents={null}>
      <Evidence evidence={activity.spending.evidence} evidenceCount={activity.spending.evidenceCount} correctable={false} {...actions} />
    </RevealCard>}
    {activity.kind === "analysis" && <AnalysisCard analysis={activity.analysis} {...actions} />}
    {activity.kind === "pace" && <Card title={jar.overCents ? "Let's take a closer look" : "A little room each day"}>
      <div className="checkup-pace"><p className="sp-amount">{euros(jar.overCents || jar.dailyRemainingCents)}</p><p>{jar.overCents ? "over this month's everyday limit" : `per day for the ${jar.daysLeft} days left`}</p></div>
      <div className="sp-bar-label"><span>Your pace so far</span><strong>{euros(jar.dailySpentCents)} / day</strong></div>
      <p className="sp-meta">{jar.overCents ? `You're ${euros(jar.overCents)} over your ${euros(jar.limitCents)} limit.` : `${euros(jar.leftCents)} left in your ${euros(jar.limitCents)} everyday limit.`}</p>
      <p className="sp-meta">{jar.period.start} – {jar.period.end}. {jar.projectedOverCents > 0 ? `At the same pace, the month would finish ${euros(jar.projectedOverCents)} over.` : "The same pace would stay inside the limit."}</p>
    </Card>}
    {activity.kind === "usual" && <Card title="This month, compared with usual">
      <p className="sp-meta">So far: {activity.comparison.period.start} – {activity.comparison.period.end}. Usual is a full month, averaged across {activity.comparison.baseline.start} – {activity.comparison.baseline.end}.</p>
      {activity.comparison.rows.map(row => {
        const maximum = Math.max(row.currentCents, row.usualCents, 1) * 1.15;
        return <section key={row.category} className="sp-analysis-section">
          <div className="checkup-usual-label"><span>{row.category}</span><strong>{euros(row.currentCents)}</strong></div>
          <div className="checkup-usual-track" data-over={row.currentCents > row.usualCents} aria-hidden="true"><b style={{ width: `${row.currentCents / maximum * 100}%` }} /><i style={{ left: `${row.usualCents / maximum * 100}%` }} /></div>
          <p className="sp-meta">Usual month {euros(row.usualCents)} · paid {row.paymentDates.map(date => date.slice(8)).join(", ") || "—"}</p>
        </section>;
      })}
      <Evidence evidence={activity.comparison.evidence} evidenceCount={activity.comparison.evidence.length} correctable={false} {...actions} />
    </Card>}
    {activity.kind === "overspend" && <Card title="The days that filled your jar">
      <p className="sp-meta">{jar.contributionPeriod.start} – {jar.contributionPeriod.end}</p>
      {jar.topDays.map(day => <section key={day.date} className="sp-analysis-section"><div className="checkup-usual-label"><span>{day.date}<small> · {day.count} payments</small></span><strong>{euros(day.amountCents)}</strong></div>
        <ul className="sp-analysis-rows">{jar.evidence.filter(row => row.date === day.date && row.basket === "everyday").map(row => <li key={row.id}><div className="sp-bar-label"><span>{row.category}<small> · {row.merchant}</small></span><strong>{euros(row.amountCents)}</strong></div></li>)}</ul>
      </section>)}
      <p className="sp-meta">Only everyday spending counts towards the rim.</p>
    </Card>}
  </div>;
}

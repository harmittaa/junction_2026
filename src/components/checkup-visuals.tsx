"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { NoticedRow } from "./answer-cards";
import type { BasketMove, CoachRequest, Goal, JarStatus, Noticed, SafeToSpendWeek } from "@/shared/contracts";
import { euros } from "@/domain/spending";
import { carSeasonQuestion } from "@/domain/coaching";
import "./checkup-visuals.css";

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const reducedMotion = () => window.matchMedia(motionQuery).matches;
const serverMotion = () => false;
function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);
}

function calendarDate(date: string) {
  // These are calendar dates, not instants in the browser's timezone.
  return new Date(`${date.slice(0, 10)}T12:00:00Z`);
}
const dateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });
const shortMonthFormat = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

export function formatDaysToSunday(days: number): string {
  if (days <= 0) return "Sunday today";
  return `${days} ${days === 1 ? "day" : "days"} to Sunday`;
}

export function CheckupWelcome({ firstName, date, due }: { firstName: string; date: string; due: boolean }) {
  return <section className="checkup-welcome">
    <h2 aria-label={`Hey ${firstName}`} key={firstName}>
      {Array.from(`Hey ${firstName}`).map((letter, index) => <span
        key={index} aria-hidden="true" className={index < 4 ? "checkup-hello" : undefined}
        style={{ "--letter": index } as CSSProperties}>{letter}</span>)}
    </h2>
    <p key={date}><time dateTime={date}>{dateFormat.format(calendarDate(date))}</time>{due ? " · your check-up day" : ""}</p>
  </section>;
}

// Over the limit the liquid keeps rising past the limit line (y 44) and that part turns amber.
const riseFor = (dome: number) => Math.min(16, Math.max(0, dome) * .55);

type LiquidState = { fill: number; velocity: number; dome: number; mini: number; amount: number; spent: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function wave(y: number, amplitude: number, phase: number) {
  let path = `M40 ${y}`;
  for (let x = 40; x <= 200; x += 8) path += ` L${x} ${y + Math.sin(x * .045 + phase) * amplitude}`;
  return `${path} L200 232 L40 232 Z`;
}

export function Jar({
  jar,
  move = null,
  spendWeek,
  goal = null,
  noticed = null,
  revision = 0,
  onAction,
  onAsk,
  revealKey,
  demoDate,
  busy = false,
  onSelectMonth,
}: {
  jar: JarStatus;
  move?: BasketMove | null;
  spendWeek?: SafeToSpendWeek;
  goal?: Goal | null;
  noticed?: Noticed | null;
  revision?: number;
  onAction?: (request: CoachRequest) => void;
  onAsk?: (question: string) => void;
  revealKey?: number;
  demoDate?: string;
  busy?: boolean;
  onSelectMonth?: (month: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const monthsRef = useRef<HTMLOListElement>(null);
  const liquid = useRef<LiquidState | null>(null);
  const previous = useRef<{ revealKey?: number; move: string } | null>(null);
  const calm = useReducedMotion();
  const id = useId().replaceAll(":", "");
  const over = jar.overCents > 0;
  const month = monthFormat.format(calendarDate(jar.period.start));
  const currentMonth = (demoDate ?? jar.period.start).slice(0, 7);
  const selectedMonth = jar.period.start.slice(0, 7);
  const moveKey = move ? `${move.transactionId}:${move.from}:${move.to}:${move.amountCents}` : "";
  const movesToUnexpected = move?.to === "unexpected" && move.from !== "unexpected" && jar.evidence.some(row => row.id === move.transactionId);
  const showUnexpected = movesToUnexpected;
  const label = `${over ? "over the rim of" : "left in"} your ${month} jar`;
  const isCurrentMonth = selectedMonth === currentMonth;
  const isSafeToSpend = isCurrentMonth && !over && spendWeek !== undefined;
  const heroAmount = isSafeToSpend ? spendWeek.amountCents : (over ? jar.overCents : jar.leftCents);
  const heroLabel = isSafeToSpend ? "safe to spend this week" : label;
  void onAsk;

  useEffect(() => {
    const list = monthsRef.current;
    if (!list) return;
    const calm = reducedMotion();
    const timer = setTimeout(() => {
      list.scrollTo({ left: list.scrollWidth, behavior: calm ? "auto" : "smooth" });
    }, calm ? 0 : 200);
    return () => clearTimeout(timer);
  }, [currentMonth, revealKey]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    // Read the actual preference here too: the first hydration snapshot is server-safe.
    const calm = reducedMotion();
    const counter = element.querySelector<HTMLElement>("[data-counter]")!;
    const contents = element.querySelector<SVGGElement>("[data-liquid]")!;
    const front = element.querySelector<SVGPathElement>("[data-liquid-front]")!;
    const back = element.querySelector<SVGPathElement>("[data-liquid-back]")!;
    const mini = element.querySelector<SVGRectElement>("[data-mini-liquid]")!;
    const spentAmount = element.querySelector<SVGTextElement>("[data-spent-amount]")!;
    const spentLabel = element.querySelector<SVGTextElement>("[data-spent-label]")!;
    const bubble = element.querySelector<SVGGElement>("[data-bubble]")!;
    const target = {
      fill: jar.limitCents > 0 ? clamp(jar.spentCents / jar.limitCents) : jar.spentCents > 0 ? 1 : 0,
      dome: over ? Math.min(30, 6 + (jar.overCents / Math.max(1, jar.limitCents)) * 300) : 0,
      // Both jars use the same monthly-limit scale; no invented mini-jar capacity.
      mini: jar.limitCents > 0 ? clamp(jar.unexpectedCents / jar.limitCents) : jar.unexpectedCents > 0 ? 1 : 0,
      amount: heroAmount, spent: jar.spentCents,
    };
    const reveal = revealKey !== undefined && (!previous.current || previous.current.revealKey !== revealKey);
    const flight = !reveal && movesToUnexpected && previous.current?.move !== moveKey;
    if (reveal && !calm) liquid.current = { fill: 0, velocity: 0, dome: 0, mini: 0, amount: 0, spent: 0 };
    if (flight && !calm && !liquid.current && move) {
      // A correction can arrive from an evidence card, with no jar mounted yet.
      // Reconstruct its previous level from the confirmed move, not an invented value.
      const spent = jar.spentCents + (move.from === "everyday" ? move.amountCents : 0);
      const excess = Math.max(0, spent - jar.limitCents);
      liquid.current = { fill: clamp(spent / Math.max(1, jar.limitCents)), velocity: 0,
        dome: excess ? Math.min(30, 6 + excess / Math.max(1, jar.limitCents) * 300) : 0,
        mini: clamp((jar.unexpectedCents - move.amountCents) / Math.max(1, jar.limitCents)),
        amount: excess || Math.max(0, jar.limitCents - spent), spent };
    }
    if (!liquid.current && !calm && !reveal && !flight) {
      liquid.current = { fill: 0, velocity: 0, dome: 0, mini: 0, amount: 0, spent: 0 };
    }
    const state = liquid.current ??= { ...target, velocity: 0 };
    const fromAmount = state.amount;
    const fromSpent = state.spent;
    const pause = calm ? 0 : reveal ? 1300 : flight ? 750 : 0;
    const duration = reveal ? 1000 : 800;
    let frame = 0;
    let start: number | undefined;
    let last: number | undefined;

    function paint(now: number) {
      // Commit the trigger only once a frame runs, so Strict Mode's setup/cleanup probe cannot consume it.
      previous.current = { revealKey, move: moveKey };
      start ??= now;
      const elapsed = now - start;
      const dt = Math.min(.033, (now - (last ?? now - 16)) / 1000);
      last = now;
      const progress = calm ? 1 : clamp((elapsed - pause) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const pouring = elapsed >= pause;
      if (calm || elapsed > pause + 2400) {
        Object.assign(state, target, { velocity: 0 });
      } else if (pouring) {
        state.velocity += (90 * (target.fill - state.fill) - 9 * state.velocity) * dt;
        state.fill += state.velocity * dt;
        const glide = 1 - Math.exp(-10 * dt);
        state.dome += (target.dome - state.dome) * glide;
        state.mini += (target.mini - state.mini) * glide;
        state.amount = fromAmount + (target.amount - fromAmount) * eased;
        state.spent = fromSpent + (target.spent - fromSpent) * eased;
      }
      element!.dataset.revealing = String(reveal && !calm && !pouring);
      // The changing number and liquid are decorative. The semantic final amount never spins.
      counter.textContent = reveal && !calm && !pouring
        ? `${String(Math.floor(elapsed / 70) % 10).repeat(3)},${String(Math.floor(elapsed / 90) % 10).repeat(2)} €`
        : euros(Math.round(state.amount));
      const y = 220 - 176 * clamp(state.fill) - (reveal && state.fill < .999 ? 0 : riseFor(state.dome));
      const amplitude = calm || state.fill <= 0
        ? 0
        : elapsed > pause + 2400
          ? 2.5
          : 2.5 + Math.min(9, Math.abs(state.velocity) * 40) * (1 - progress);
      const phase = elapsed / 420;
      contents.setAttribute("visibility", state.fill > 0 ? "visible" : "hidden");
      front.setAttribute("d", wave(y, amplitude, phase));
      back.setAttribute("d", wave(y - 4, amplitude * 1.3, phase * .8 + 2));
      mini.setAttribute("y", String(220 - 98 * state.mini));
      const yAmount = Math.min(182, Math.max(80, y + 44));
      spentAmount.setAttribute("y", String(yAmount));
      spentLabel.setAttribute("y", String(yAmount + 22));
      const showSpent = state.fill > .18;
      spentAmount.textContent = showSpent ? euros(Math.round(state.spent)) : "";
      spentLabel.textContent = showSpent ? "spent" : "";
      const flying = flight && !calm && elapsed < pause;
      bubble.style.opacity = flying ? "1" : "0";
      if (flying) {
        const k = clamp(elapsed / 750);
        const e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const u = 1 - e;
        bubble.setAttribute("transform", `translate(${u * u * 120 + 2 * u * e * 215 + e * e * 268} ${u * u * 20 - 2 * u * e * 40 + e * e * 165}) scale(${1 + Math.sin(e * Math.PI) * .3})`);
        bubble.classList.toggle("checkup-bubble-arriving", e > .5);
      }
      if (!calm) frame = requestAnimationFrame(paint);
    }
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [calm, heroAmount, jar.limitCents, jar.overCents, jar.period.start, jar.spentCents, jar.unexpectedCents, move, moveKey, movesToUnexpected, over, revealKey]);

  const initialRise = over ? riseFor(Math.min(30, 6 + jar.overCents / Math.max(1, jar.limitCents) * 300)) : 0;
  const initialFill = jar.limitCents > 0 ? clamp(jar.spentCents / jar.limitCents) : jar.spentCents > 0 ? 1 : 0;
  const months = jar.months.filter(result => result.month < currentMonth);
  return <section className="checkup-jar" ref={root} data-over={over} data-two={showUnexpected} aria-label={`${month} spending jar`}>
    <div className="checkup-jar-hero">
      <span className="checkup-visually-hidden">{euros(heroAmount)} {heroLabel}.</span>
      <div className="checkup-jar-amount" data-counter aria-hidden="true">{euros(heroAmount)}</div>
      <div className="checkup-jar-label" aria-hidden="true">{heroLabel}</div>
      <div className="checkup-jar-tags">
        {isSafeToSpend ? <>
          <span>{euros(spendWeek.dailyCents)} a day</span>
          <span>{formatDaysToSunday(spendWeek.daysLeftInWeek)}</span>
        </> : selectedMonth < currentMonth ? <>
          <span>Closed month</span>
          <span>{euros(jar.dailySpentCents)} a day</span>
        </> : <>
          <span>{jar.daysLeft} {jar.daysLeft === 1 ? "day" : "days"} to go</span>
          {!over && jar.daysLeft > 0 ? <span>{euros(jar.dailyRemainingCents)} a day</span> : null}
        </>}
      </div>
    </div>
    <svg className="checkup-jar-stage" viewBox="0 -12 344 274" role="img" aria-label={`${euros(jar.spentCents)} of ${euros(jar.limitCents)} spent`}>
      <title id={`${id}-title`}>{`${euros(jar.spentCents)} of ${euros(jar.limitCents)} spent`}</title>
      <desc id={`${id}-description`}>{`Monthly limit ${euros(jar.limitCents)}.${showUnexpected ? ` Unexpected necessities ${euros(jar.unexpectedCents)}. Both fill levels are relative to the monthly limit.` : ""}`}</desc>
      <defs>
        <clipPath id={`${id}-jar`}><path d="M42 26V180a38 38 0 0 0 38 38H160a38 38 0 0 0 38-38V26Z" /></clipPath>
        <linearGradient id={`${id}-front`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
          <stop offset=".44" style={{ stopColor: "var(--status-warningBorder)" }} />
          <stop offset=".44" style={{ stopColor: "var(--fill-action, var(--primaryPressed))" }} />
        </linearGradient>
        <linearGradient id={`${id}-back`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
          <stop offset=".44" style={{ stopColor: "var(--status-warningBorder)" }} />
          <stop offset=".44" style={{ stopColor: "var(--brand-greenBright)" }} />
        </linearGradient>
        <clipPath id={`${id}-mini`}><rect x="242" y="122" width="52" height="98" rx="14" /></clipPath>
      </defs>
      <g className="checkup-main-jar" aria-hidden="true">
        <g className="checkup-jar-body">
          <g data-liquid visibility={initialFill > 0 ? "visible" : "hidden"} clipPath={`url(#${id}-jar)`}>
            <path className="checkup-liquid-back" data-liquid-back style={over ? { fill: `url(#${id}-back)` } : undefined} d={wave(216 - initialFill * 176 - initialRise, 0, 0)} />
            <path className="checkup-liquid-front" data-liquid-front style={over ? { fill: `url(#${id}-front)` } : undefined} d={wave(220 - initialFill * 176 - initialRise, 0, 0)} />
            <text className="checkup-spent-amount" data-spent-amount x="120" y={Math.min(182, 224 - initialFill * 176)} textAnchor="middle">{initialFill > .18 ? euros(jar.spentCents) : ""}</text>
            <text className="checkup-spent-label" data-spent-label x="120" y={Math.min(204, 246 - initialFill * 176)} textAnchor="middle">{initialFill > .18 ? "spent" : ""}</text>
          </g>
          <path className="checkup-glass" d="M40 24V180a40 40 0 0 0 40 40H160a40 40 0 0 0 40-40V24" />
        </g>
      </g>
      <g className="checkup-rim-group" key={jar.limitCents} aria-hidden="true">
        <path className="checkup-limit-tick" d="M244 44H254" />
        <text className="checkup-rim-amount" x="258" y="51">{euros(jar.limitCents)}</text>
        <text className="checkup-rim-label" x="258" y="70">{goal ? "goal jar" : "Limit"}</text>
      </g>
      <g className="checkup-mini-jar" aria-hidden="true">
        <text className="checkup-mini-label" x="268" y="112" textAnchor="middle">Unexpected</text>
        <g clipPath={`url(#${id}-mini)`}><rect className="checkup-mini-liquid" data-mini-liquid x="242" width="52" height="100" y={220 - 98 * (jar.limitCents > 0 ? clamp(jar.unexpectedCents / jar.limitCents) : jar.unexpectedCents > 0 ? 1 : 0)} /></g>
        <rect className="checkup-glass checkup-mini-glass" x="240" y="120" width="56" height="100" rx="16" />
        <text className="checkup-mini-label" x="268" y="242" textAnchor="middle">{euros(jar.unexpectedCents)}</text>
      </g>
      <g className="checkup-payment-bubble" data-bubble opacity="0" aria-hidden="true"><circle r="15" /></g>
    </svg>
    <ol ref={monthsRef} className="checkup-months" aria-label="Monthly jar results" key={`${currentMonth}:${revealKey ?? "static"}`}>
      {months.map((result, index) => {
        const isSelected = result.month === selectedMonth;
        return <li key={result.month} style={{ "--month": index } as CSSProperties} data-inside={result.inside}>
          <button
            type="button"
            disabled={busy}
            aria-pressed={isSelected}
            data-selected={isSelected}
            onClick={() => onSelectMonth?.(result.month)}
          >
            <span className="checkup-month-mark" aria-hidden="true">{result.inside ? "✓" : "!"}</span>
            <span className="checkup-visually-hidden">{result.inside ? "Within limit" : "Over limit"}, </span>
            <time dateTime={result.month}>{shortMonthFormat.format(calendarDate(`${result.month}-01`))}</time>
          </button>
        </li>;
      })}
      <li className="checkup-month-current" aria-current="date" style={{ "--month": months.length } as CSSProperties}>
        <button
          type="button"
          disabled={busy}
          aria-pressed={currentMonth === selectedMonth}
          data-selected={currentMonth === selectedMonth}
          onClick={() => onSelectMonth?.(currentMonth)}
        >
          <span className="checkup-month-mark" aria-hidden="true">·</span>
          <time dateTime={currentMonth}>{shortMonthFormat.format(calendarDate(`${currentMonth}-01`))}</time>
          <span className="checkup-visually-hidden">, current month</span>
        </button>
      </li>
    </ol>
    {isCurrentMonth && noticed && onAction && (
      <div className="checkup-jar-noticed">
        <NoticedRow noticed={noticed} busy={busy} revision={revision} onAction={onAction} />
      </div>
    )}
  </section>;
}

export function WeeklyReward({ streak, onFinish, onChime }: { streak: number; onFinish: () => void; onChime?: () => void }) {
  const calm = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onFinish, onChime });
  const lifecycle = useRef({ streak, finished: false, chimed: false });
  // Callback identity changes must not restart the celebration or replay its sound.
  useEffect(() => { callbacks.current = { onFinish, onChime }; }, [onFinish, onChime]);
  function finish() {
    if (lifecycle.current.finished) return;
    lifecycle.current.finished = true;
    callbacks.current.onFinish();
  }
  useEffect(() => {
    if (lifecycle.current.streak !== streak) lifecycle.current = { streak, finished: false, chimed: false };
    const calm = reducedMotion();
    const element = root.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.focus({ preventScroll: true });
    const count = element.querySelector<HTMLElement>("[data-reward-count]")!;
    element.dataset.landed = String(calm);
    count.textContent = String(calm ? streak : Math.max(0, streak - 1));
    const land = () => {
      if (lifecycle.current.finished) return;
      count.textContent = String(streak);
      element.dataset.landed = "true";
      if (!lifecycle.current.chimed) {
        lifecycle.current.chimed = true;
        callbacks.current.onChime?.();
      }
    };
    const landTimer = setTimeout(land, calm ? 0 : 1100);
    return () => {
      clearTimeout(landTimer);
      // Passive cleanup can run after removal has already returned focus to body.
      if ((document.activeElement === element || document.activeElement === document.body) && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [calm, streak]);

  return <div className="checkup-reward" key={streak} ref={root} role="button" tabIndex={0}
    aria-label={`${streak} ${streak === 1 ? "week" : "weeks"} in a row. Check-up complete. Continue.`}
    onClick={finish} onKeyDown={event => {
      if (["Enter", " ", "Escape"].includes(event.key)) { event.preventDefault(); finish(); }
      // The short overlay owns focus only while visible; Tab dismisses rather than hiding focus behind it.
      if (event.key === "Tab") finish();
    }}>
    <div className="checkup-reward-surface" aria-hidden="true" />
    <div className="checkup-reward-content" aria-hidden="true">
      <svg viewBox="0 0 16 16" className="checkup-reward-flame"><path d="M8 1c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1.5.7-2.5 1.5-3.2C6 7.5 7.5 5 8 1Z" /></svg>
      <div className="checkup-reward-count" data-reward-count>{streak}</div>
      <div className="checkup-reward-heading">{streak === 1 ? "week" : "weeks"} in a row</div>
      <p>You showed up for your money again.<br />That is the whole trick.</p>
      <span className="checkup-reward-skip">Click to continue</span>
    </div>
    <div className="checkup-reward-particles" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => {
      const angle = index * Math.PI * 2 / 28;
      const distance = 70 + index % 4 * 24;
      return <i key={index} style={{ "--x": `${Math.cos(angle) * distance}px`, "--y": `${Math.sin(angle) * distance - 40}px`, "--particle": index } as CSSProperties} />;
    })}</div>
  </div>;
}

const ideaQuestions = [
  "Can I save 1 500 € by March?",
  "What is safe to spend this week?",
  "What have I spent more on than usual?",
  "What kind of spender am I?",
  "What if I cut dining out by 20%?",
  carSeasonQuestion,
];

export function IdeasButton({
  due,
  onClick,
  className = "",
}: {
  due: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`checkup-ideas-button ${className}`.trim()}
      aria-label={due ? "Ideas to ask. Check-up due." : "Ideas to ask"}
      onClick={onClick}
    >
      <span className="checkup-ideas-disc" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
          <path d="M9 18h6" />
          <path d="M10 22h4" />
        </svg>
        {due && <span className="checkup-ideas-dot" />}
      </span>
      <span className="checkup-ideas-label">Ideas</span>
    </button>
  );
}

export function IdeasSheet({
  due,
  busy,
  onClose,
  onCheckup,
  onAsk,
}: {
  due: boolean;
  busy: boolean;
  onClose: () => void;
  onCheckup: () => void;
  onAsk: (question: string) => void;
}) {
  const calm = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(() => {
    if (closing) return;
    if (calm) {
      onClose();
      return;
    }
    setClosing(true);
    setTimeout(onClose, 180);
  }, [calm, closing, onClose]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstButton = panelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    firstButton?.focus({ preventScroll: true });
    return () => {
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismiss]);

  const handleSelectCheckup = () => {
    onCheckup();
    dismiss();
  };

  const handleSelectQuestion = (text: string) => {
    onAsk(text);
    dismiss();
  };

  return (
    <>
      <div
        className="checkup-ideas-backdrop"
        data-closing={closing}
        aria-hidden="true"
        onClick={dismiss}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ideas to ask"
        className="checkup-ideas-panel"
        data-closing={closing}
      >
        <div className="checkup-ideas-grab" aria-hidden="true" />
        <div className="checkup-ideas-header">
          <p className="checkup-ideas-title">Try asking</p>
          <button
            type="button"
            aria-label="Close ideas"
            className="checkup-ideas-close"
            onClick={dismiss}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {due && (
          <button
            type="button"
            className="checkup-ideas-checkup"
            disabled={busy}
            onClick={handleSelectCheckup}
          >
            Let&apos;s do my check-up
          </button>
        )}
        {ideaQuestions.map(text => (
          <button
            key={text}
            type="button"
            className="checkup-ideas-row"
            disabled={busy}
            onClick={() => handleSelectQuestion(text)}
          >
            <span>{text}</span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </section>
    </>
  );
}

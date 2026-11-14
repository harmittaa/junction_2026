"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type CSSProperties } from "react";
import type { BasketMove, JarStatus } from "@/shared/contracts";
import { euros } from "@/domain/spending";
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

type LiquidState = { fill: number; velocity: number; dome: number; mini: number; amount: number; spent: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function wave(y: number, amplitude: number, phase: number) {
  let path = `M40 ${y}`;
  for (let x = 40; x <= 200; x += 8) path += ` L${x} ${y + Math.sin(x * .045 + phase) * amplitude}`;
  return `${path} L200 232 L40 232 Z`;
}

export function Jar({ jar, move = null, revealKey }: { jar: JarStatus; move?: BasketMove | null; revealKey?: number }) {
  const root = useRef<HTMLElement>(null);
  const liquid = useRef<LiquidState | null>(null);
  const previous = useRef<{ revealKey?: number; move: string } | null>(null);
  const calm = useReducedMotion();
  const id = useId().replaceAll(":", "");
  const over = jar.overCents > 0;
  const amount = over ? jar.overCents : jar.leftCents;
  const month = monthFormat.format(calendarDate(jar.period.start));
  const currentMonth = jar.period.start.slice(0, 7);
  const moveKey = move ? `${move.transactionId}:${move.from}:${move.to}:${move.amountCents}` : "";
  const movesToUnexpected = move?.to === "unexpected" && move.from !== "unexpected";
  const showUnexpected = jar.unexpectedCents > 0 || movesToUnexpected;
  const label = `${over ? "over the rim of" : "left in"} your ${month} jar`;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    // Read the actual preference here too: the first hydration snapshot is server-safe.
    const calm = reducedMotion();
    const counter = element.querySelector<HTMLElement>("[data-counter]")!;
    const contents = element.querySelector<SVGGElement>("[data-liquid]")!;
    const front = element.querySelector<SVGPathElement>("[data-liquid-front]")!;
    const back = element.querySelector<SVGPathElement>("[data-liquid-back]")!;
    const dome = element.querySelector<SVGEllipseElement>("[data-dome]")!;
    const mini = element.querySelector<SVGRectElement>("[data-mini-liquid]")!;
    const spent = element.querySelector<SVGTextElement>("[data-spent]")!;
    const bubble = element.querySelector<SVGGElement>("[data-bubble]")!;
    const target = {
      fill: jar.limitCents > 0 ? clamp(jar.spentCents / jar.limitCents) : jar.spentCents > 0 ? 1 : 0,
      dome: over ? Math.min(30, 6 + (jar.overCents / Math.max(1, jar.limitCents)) * 300) : 0,
      // Both jars use the same monthly-limit scale; no invented mini-jar capacity.
      mini: jar.limitCents > 0 ? clamp(jar.unexpectedCents / jar.limitCents) : jar.unexpectedCents > 0 ? 1 : 0,
      amount, spent: jar.spentCents,
    };
    const reveal = revealKey !== undefined && (!previous.current || previous.current.revealKey !== revealKey);
    const flight = !reveal && movesToUnexpected && previous.current?.move !== moveKey;
    if (reveal && !calm) liquid.current = { fill: 0, velocity: 0, dome: 0, mini: 0, amount: 0, spent: 0 };
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
      const y = 220 - 176 * clamp(state.fill);
      const amplitude = calm ? 0 : 2 + Math.min(9, Math.abs(state.velocity) * 40) * (1 - progress);
      const phase = elapsed / 420;
      contents.setAttribute("visibility", state.fill > 0 ? "visible" : "hidden");
      front.setAttribute("d", wave(y, amplitude, phase));
      back.setAttribute("d", wave(y - 4, amplitude * 1.3, phase * .8 + 2));
      dome.setAttribute("ry", String(Math.max(0, state.dome)));
      mini.setAttribute("y", String(220 - 98 * state.mini));
      spent.setAttribute("y", String(Math.min(204, y + 30)));
      spent.textContent = state.fill > .18 ? `${euros(Math.round(state.spent))} spent` : "";
      const flying = flight && !calm && elapsed < pause;
      bubble.style.opacity = flying ? "1" : "0";
      if (flying) {
        const k = clamp(elapsed / 750);
        const e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const u = 1 - e;
        bubble.setAttribute("transform", `translate(${u * u * 120 + 2 * u * e * 215 + e * e * 268} ${u * u * 20 - 2 * u * e * 40 + e * e * 165}) scale(${1 + Math.sin(e * Math.PI) * .3})`);
        bubble.classList.toggle("checkup-bubble-arriving", e > .5);
      }
      if (!calm && elapsed < pause + 2450) frame = requestAnimationFrame(paint);
    }
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [amount, calm, jar.limitCents, jar.overCents, jar.spentCents, jar.unexpectedCents, moveKey, movesToUnexpected, over, revealKey]);

  const initialFill = jar.limitCents > 0 ? clamp(jar.spentCents / jar.limitCents) : jar.spentCents > 0 ? 1 : 0;
  const months = jar.months.filter(result => result.month < currentMonth);
  return <section className="checkup-jar" ref={root} data-over={over} data-two={showUnexpected} aria-label={`${month} spending jar`}>
    <div className="checkup-jar-hero">
      <span className="checkup-visually-hidden">{euros(amount)} {label}.</span>
      <div className="checkup-jar-amount" data-counter aria-hidden="true">{euros(amount)}</div>
      <div className="checkup-jar-label" aria-hidden="true">{label}</div>
      <div className="checkup-jar-tags">
        <span>{jar.daysLeft} {jar.daysLeft === 1 ? "day" : "days"} to go</span>
        {!over && jar.daysLeft > 0 ? <span>{euros(jar.dailyRemainingCents)} a day</span> : null}
      </div>
    </div>
    <svg className="checkup-jar-stage" viewBox="0 -12 344 274" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{`${euros(jar.spentCents)} everyday spending`}</title>
      <desc id={`${id}-description`}>{`Monthly limit ${euros(jar.limitCents)}.${showUnexpected ? ` Unexpected necessities ${euros(jar.unexpectedCents)}. Both fill levels are relative to the monthly limit.` : ""}`}</desc>
      <defs>
        <clipPath id={`${id}-jar`}><path d="M42 26V180a38 38 0 0 0 38 38H160a38 38 0 0 0 38-38V26Z" /></clipPath>
        <clipPath id={`${id}-mini`}><rect x="242" y="122" width="52" height="98" rx="14" /></clipPath>
      </defs>
      <g className="checkup-main-jar" aria-hidden="true">
        <ellipse className="checkup-jar-dome" data-dome cx="120" cy="44" rx="77" ry={over ? Math.min(30, 6 + jar.overCents / Math.max(1, jar.limitCents) * 300) : 0} />
        <g data-liquid visibility={initialFill > 0 ? "visible" : "hidden"} clipPath={`url(#${id}-jar)`}>
          <path className="checkup-liquid-back" data-liquid-back d={wave(216 - initialFill * 176, 0, 0)} />
          <path className="checkup-liquid-front" data-liquid-front d={wave(220 - initialFill * 176, 0, 0)} />
          <text className="checkup-spent" data-spent x="120" y={Math.min(204, 250 - initialFill * 176)} textAnchor="middle">{initialFill > .18 ? `${euros(jar.spentCents)} spent` : ""}</text>
        </g>
        <path className="checkup-glass" d="M40 24V180a40 40 0 0 0 40 40H160a40 40 0 0 0 40-40V24" />
        <path className="checkup-limit-tick" d="M204 44H214" />
        <text className="checkup-rim" x="218" y="34">Limit</text>
        <text className="checkup-rim" x="218" y="49">{euros(jar.limitCents)}</text>
      </g>
      <g className="checkup-mini-jar" aria-hidden="true">
        <text className="checkup-mini-label" x="268" y="112" textAnchor="middle">Unexpected</text>
        <g clipPath={`url(#${id}-mini)`}><rect className="checkup-mini-liquid" data-mini-liquid x="242" width="52" height="100" y={220 - 98 * (jar.limitCents > 0 ? clamp(jar.unexpectedCents / jar.limitCents) : jar.unexpectedCents > 0 ? 1 : 0)} /></g>
        <rect className="checkup-glass checkup-mini-glass" x="240" y="120" width="56" height="100" rx="16" />
        <text className="checkup-mini-label" x="268" y="242" textAnchor="middle">{euros(jar.unexpectedCents)}</text>
      </g>
      <g className="checkup-payment-bubble" data-bubble opacity="0" aria-hidden="true"><circle r="15" /></g>
    </svg>
    <ol className="checkup-months" aria-label="Monthly jar results" key={`${currentMonth}:${revealKey ?? "static"}`}>
      {months.map((result, index) => <li key={result.month} style={{ "--month": index } as CSSProperties} data-inside={result.inside}>
        <span className="checkup-month-mark" aria-hidden="true">{result.inside ? "✓" : "!"}</span>
        <span className="checkup-visually-hidden">{result.inside ? "Within limit" : "Over limit"}, </span>
        <time dateTime={result.month}>{shortMonthFormat.format(calendarDate(`${result.month}-01`))}</time>
      </li>)}
      <li className="checkup-month-current" aria-current="date" style={{ "--month": months.length } as CSSProperties}>
        <span className="checkup-month-mark" aria-hidden="true">·</span>
        <time dateTime={currentMonth}>{shortMonthFormat.format(calendarDate(jar.period.start))}</time>
        <span className="checkup-visually-hidden">, current month</span>
      </li>
    </ol>
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
    const landTimer = setTimeout(land, calm ? 0 : 700);
    const finishTimer = setTimeout(() => {
      if (lifecycle.current.finished) return;
      lifecycle.current.finished = true;
      callbacks.current.onFinish();
    }, 2450);
    return () => {
      clearTimeout(landTimer);
      clearTimeout(finishTimer);
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
      <span className="checkup-reward-skip">Tap or press Enter to continue</span>
    </div>
    <div className="checkup-reward-particles" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => {
      const angle = index * Math.PI * 2 / 28;
      const distance = 70 + index % 4 * 24;
      return <i key={index} style={{ "--x": `${Math.cos(angle) * distance}px`, "--y": `${Math.sin(angle) * distance - 40}px`, "--particle": index } as CSSProperties} />;
    })}</div>
  </div>;
}

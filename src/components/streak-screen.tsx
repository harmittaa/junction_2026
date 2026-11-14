"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import type { CoachView, WeeklyCheckup } from "@/shared/contracts";
import { formatDueBy, formatLongDate, formatShortDate, longestRun, shiftDate } from "@/domain/streak";
import { euros } from "@/domain/spending";
import "./streak-screen.css";

export type StreakScreenProps = {
  checkup?: WeeklyCheckup;
  demoDate?: string;
  limitCents?: number;
  streakJars?: ReadonlyArray<{ date: string; leftCents: number }>;
  view?: CoachView;
  onClose: () => void;
  onDoCheckup?: () => void;
  busy?: boolean;
};

type Slot =
  | { kind: "done"; date: string; leftCents?: number; label: string; sub: string; ariaLabel: string }
  | { kind: "due"; label: string; sub: string; ariaLabel: string }
  | { kind: "mark"; date: string; filled: boolean; label: string; sub: string; ariaLabel: string }
  | { kind: "upcoming"; label: string; sub: string; ariaLabel: string };

export function StreakScreen({
  checkup: checkupProp,
  demoDate: demoDateProp,
  limitCents: limitCentsProp,
  streakJars: streakJarsProp,
  view,
  onClose,
  onDoCheckup,
  busy = false,
}: StreakScreenProps) {
  const backRef = useRef<HTMLButtonElement>(null);
  const baseId = useId().replaceAll(":", "");

  const checkup = checkupProp ?? view?.checkup ?? {
    weekStart: "2026-09-14",
    completed: false,
    due: true,
    streak: 0,
    completedDates: [],
  };
  const demoDate = demoDateProp ?? view?.demoDate ?? "2026-09-16";
  const limitCents =
    limitCentsProp ??
    view?.jar?.limitCents ??
    view?.profile?.everydayLimit?.amountCents ??
    220000;
  const streakJars =
    streakJarsProp ??
    (view as { streakJars?: ReadonlyArray<{ date: string; leftCents: number }> } | undefined)
      ?.streakJars;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [onClose]);

  const handleDoCheckup = () => {
    if (busy) return;
    onClose();
    onDoCheckup?.();
  };

  const streak = checkup.streak;
  const due = checkup.due;
  const completedDates = checkup.completedDates;
  const longest = longestRun(completedDates);

  const markDate = shiftDate(demoDate, 7);
  const markShortDate = formatShortDate(markDate);
  const markLongDate = formatLongDate(markDate);
  const markFilled = streak >= 4;

  const doneEntries: Array<{ date: string; leftCents?: number }> = [];
  if (streakJars && streakJars.length > 0) {
    doneEntries.push(...streakJars.slice(0, 4));
  } else if (completedDates.length > 0 && streak > 0) {
    const dates = completedDates.slice(-Math.min(streak, 4));
    for (const date of dates) {
      doneEntries.push({ date });
    }
  }

  const slots: Slot[] = [];
  const maxDoneToShow = streak >= 4 ? 3 : Math.min(doneEntries.length, 3);
  for (let i = 0; i < maxDoneToShow; i++) {
    const entry = doneEntries[i];
    const shortDate = formatShortDate(entry.date);
    const longDate = formatLongDate(entry.date);
    const amountStr = entry.leftCents !== undefined ? euros(entry.leftCents) : undefined;
    slots.push({
      kind: "done",
      date: entry.date,
      leftCents: entry.leftCents,
      label: shortDate,
      sub: amountStr ?? "",
      ariaLabel: amountStr
        ? `${longDate}: check-up done, ${amountStr} left in the jar`
        : `${longDate}: check-up done`,
    });
  }

  if (due && slots.length < 3) {
    slots.push({
      kind: "due",
      label: "This week",
      sub: "due",
      ariaLabel: "This week: check-up due",
    });
  }

  while (slots.length < 3) {
    slots.push({
      kind: "upcoming",
      label: "Next",
      sub: "upcoming",
      ariaLabel: "Upcoming check-up",
    });
  }

  slots.push({
    kind: "mark",
    date: markDate,
    filled: markFilled,
    label: markShortDate,
    sub: "4 weeks",
    ariaLabel: `${markLongDate}: 4-week mark`,
  });

  return (
    <div
      className="streak-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Your streak"
    >
      <header className="streak-header">
        <button
          ref={backRef}
          type="button"
          aria-label="Back to Sponky"
          className="streak-back"
          onClick={onClose}
        >
          ‹
        </button>
        <h1 className="streak-title">Your streak</h1>
      </header>

      <section
        aria-label={`${streak} ${streak === 1 ? "week" : "weeks"} in a row`}
        className="streak-hero"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="streak-flame"
        >
          <path d="M8 1c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1.5.7-2.5 1.5-3.2C6 7.5 7.5 5 8 1Z" />
        </svg>
        <div className="streak-count">{streak}</div>
        <div className="streak-unit">
          {streak === 1 ? "week" : "weeks"} in a row
        </div>
        <p className="streak-hero-copy">
          You check in on your money. That is the whole trick.
        </p>
      </section>

      <section aria-label="Road to 4 weeks" className="streak-road">
        <div className="streak-road-header">
          <span className="streak-road-label">Road to 4 weeks</span>
          <strong className="streak-road-progress">{Math.min(streak, 4)} of 4</strong>
        </div>
        <div className="streak-slots-wrapper">
          <ol className="streak-slots">
            {slots.map((slot, index) => {
              const clipId = `${baseId}_clip_${index}`;
              return (
                <li
                  key={index}
                  className="streak-slot"
                  aria-label={slot.ariaLabel}
                  style={{ "--jar-index": index } as CSSProperties}
                >
                  {slot.kind === "done" && (
                    <>
                      <svg aria-hidden="true" viewBox="0 0 44 52" className="streak-jar-svg">
                        <defs>
                          <clipPath id={clipId}>
                            <path d="M7 6V36a9 9 0 0 0 9 9H28a9 9 0 0 0 9-9V6Z" />
                          </clipPath>
                        </defs>
                        {slot.leftCents !== undefined && limitCents > 0 && (
                          <g clipPath={`url(#${clipId})`}>
                            <rect
                              className="streak-jar-liquid"
                              x="6"
                              y={46 - 40 * Math.max(0.05, Math.min(0.95, slot.leftCents / limitCents))}
                              width="32"
                              height={40 * Math.max(0.05, Math.min(0.95, slot.leftCents / limitCents))}
                              fill="#00EB5A"
                            />
                          </g>
                        )}
                        <path
                          d="M6 6V36a10 10 0 0 0 10 10H28a10 10 0 0 0 10-10V6"
                          fill="none"
                          stroke="#F7FCF7"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        <path
                          className="streak-jar-tick"
                          d="M16 21l4.5 4.5L28 17"
                          fill="none"
                          stroke="#004628"
                          strokeWidth="5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          className="streak-jar-tick"
                          d="M16 21l4.5 4.5L28 17"
                          fill="none"
                          stroke="#00EB5A"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="streak-slot-title">{slot.label}</span>
                      <span className="streak-slot-amount">{slot.sub}</span>
                    </>
                  )}
                  {slot.kind === "due" && (
                    <>
                      <svg aria-hidden="true" viewBox="0 0 44 52" className="streak-jar-svg">
                        <path
                          d="M6 6V36a10 10 0 0 0 10 10H28a10 10 0 0 0 10-10V6"
                          fill="none"
                          stroke="#00EB5A"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeDasharray="5 5"
                        />
                      </svg>
                      <span className="streak-slot-title due">{slot.label}</span>
                      <span className="streak-slot-amount due">{slot.sub}</span>
                    </>
                  )}
                  {slot.kind === "upcoming" && (
                    <>
                      <svg aria-hidden="true" viewBox="0 0 44 52" className="streak-jar-svg">
                        <path
                          d="M6 6V36a10 10 0 0 0 10 10H28a10 10 0 0 0 10-10V6"
                          fill="none"
                          stroke="#99D59F"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeDasharray="5 5"
                          opacity="0.6"
                        />
                      </svg>
                      <span className="streak-slot-title" style={{ color: "#99D59F" }}>
                        {slot.label}
                      </span>
                      <span className="streak-slot-amount" style={{ color: "#99D59F" }}>
                        {slot.sub}
                      </span>
                    </>
                  )}
                  {slot.kind === "mark" && (
                    <>
                      <svg aria-hidden="true" viewBox="0 0 44 52" className="streak-jar-svg">
                        <circle
                          cx="22"
                          cy="27"
                          r="19"
                          fill={slot.filled ? "#00EB5A" : "none"}
                          stroke={slot.filled ? "#00EB5A" : "#99D59F"}
                          strokeWidth="2.5"
                          strokeDasharray={slot.filled ? "none" : "5 5"}
                        />
                        <text
                          x="22"
                          y="36"
                          textAnchor="middle"
                          fill={slot.filled ? "#004628" : "#99D59F"}
                          className="streak-mark-number"
                        >
                          4
                        </text>
                      </svg>
                      <span
                        className="streak-slot-title"
                        style={{ color: slot.filled ? "#00EB5A" : "#99D59F" }}
                      >
                        {slot.label}
                      </span>
                      <span
                        className="streak-slot-amount"
                        style={{ color: slot.filled ? "#00EB5A" : "#99D59F" }}
                      >
                        {slot.sub}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        <p className="streak-road-footnote">
          Each jar shows what was left in your everyday jar at that check-up.
        </p>
      </section>

      <div className="streak-stats">
        <div className="streak-stat-card">
          <span className="streak-stat-label">Longest run</span>
          <strong className="streak-stat-value">
            {longest} {longest === 1 ? "week" : "weeks"}
          </strong>
        </div>
        <div className="streak-stat-card">
          <span className="streak-stat-label">Check-ups done</span>
          <strong className="streak-stat-value">{completedDates.length}</strong>
        </div>
      </div>

      {due && (
        <div className="streak-action">
          <button
            type="button"
            className="streak-btn"
            disabled={busy}
            onClick={handleDoCheckup}
          >
            Do this week&apos;s check-up
          </button>
          <p className="streak-due-text">{formatDueBy(checkup.weekStart)}</p>
        </div>
      )}
    </div>
  );
}

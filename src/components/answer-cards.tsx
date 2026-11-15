"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  basketLabels,
  type Basket,
  type Analysis,
  type CoachRequest,
  type CoachView,
  type GoalVerdict,
  type Noticed,
  type SafeToSave,
} from "@/shared/contracts";
import { changeGoalText } from "@/domain/replies";
import { euros } from "@/domain/spending";
import { goalAmount, lastDayOfMonth, monthRange, dayHeading, minusEuros } from "./answer-format";
import "./answer-cards.css";

export const subscribeMotion = (notify: () => void) => {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

export const reducedMotion = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

export const serverMotion = () => true;

export function CountAmount({
  cents,
  active = true,
  format = euros,
  durationMs = 950,
}: {
  cents: number;
  active?: boolean;
  format?: (cents: number) => string;
  durationMs?: number;
}) {
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);
  const [started, setStarted] = useState(active);
  const [animated, setAnimated] = useState(0);

  if (active && !started) setStarted(true);

  useEffect(() => {
    if (reduced || !started) return;
    let frame: number;
    let start: number | undefined;
    const tick = (time: number) => {
      start ??= time;
      const progress = Math.min(1, (time - start) / durationMs);
      setAnimated(Math.round(cents * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents, durationMs, reduced, started]);

  return (
    <>
      <span aria-hidden="true">{format(reduced ? cents : started ? animated : 0)}</span>
      <span className="sp-sr">{format(cents)}</span>
    </>
  );
}

export function NoticedRow({
  noticed,
  busy,
  revision,
  onAction,
  index,
}: {
  noticed: Noticed | null;
  busy: boolean;
  revision: number;
  onAction: (request: CoachRequest) => void;
  index?: number;
}) {
  if (!noticed) return null;

  return (
    <button
      type="button"
      className="ac-noticed ac-press"
      disabled={busy}
      style={index !== undefined ? ({ "--i": index } as React.CSSProperties) : undefined}
      onClick={() => onAction({ action: "ask", revision, text: noticed.question })}
    >
      <span className="ac-noticed-icon" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <path d="M69 10C107 34 39 80 77 110M43 10C81 34 13 80 51 110" />
        </svg>
      </span>
      <span className="ac-noticed-content">
        <span className="ac-noticed-eyebrow">Sponky noticed</span>
        <span className="ac-noticed-text">{noticed.text}</span>
        <span className="ac-noticed-question">
          <span className="sp-sr">Ask: </span>
          {noticed.question} <span aria-hidden="true">›</span>
        </span>
      </span>
    </button>
  );
}

export function SafeToSaveCard({
  save,
  noticed,
  busy,
  revision,
  countActive = true,
  onAction,
}: {
  save: SafeToSave;
  noticed: Noticed | null;
  busy: boolean;
  revision: number;
  countActive?: boolean;
  onAction: (request: CoachRequest) => void;
}) {
  const eyebrowId = useId();
  const usual = save.usual;
  const income = usual.incomeCents || 1;
  const regShare = (usual.regularCents / income) * 100;
  const unexpShare = (usual.unexpectedCents / income) * 100;
  const saveShare = (save.safeToSaveCents / income) * 100;

  return (
    <section className="ac-card" aria-labelledby={eyebrowId}>
      <h2 id={eyebrowId} className="ac-eyebrow ac-stagger" style={{ "--i": 0 } as React.CSSProperties}>
        Safe to save · a usual month
      </h2>
      <p className="ac-amount">
        <CountAmount cents={save.safeToSaveCents} active={countActive} durationMs={600} />
      </p>
      <p className="ac-sentence ac-stagger" style={{ "--i": 1 } as React.CSSProperties}>
        {save.safeToSaveCents === 0 ? "A usual month leaves nothing after your three baskets." : "left after your three baskets"}
      </p>

      <div className="ac-bar ac-stagger" aria-hidden="true" style={{ "--i": 2 } as React.CSSProperties}>
        <span
          className="ac-bar-segment ac-bar-regular"
          style={{ flex: `0 0 ${regShare}%`, "--k": 0 } as React.CSSProperties}
        />
        <span
          className="ac-bar-segment ac-bar-unexpected"
          style={{ flex: `0 0 ${unexpShare}%`, "--k": 1 } as React.CSSProperties}
        />
        <span
          className="ac-bar-segment ac-bar-everyday"
          style={{ "--k": 2 } as React.CSSProperties}
        />
        {save.safeToSaveCents > 0 && (
          <span
            className="ac-bar-segment ac-bar-sliver"
            style={{ flex: `0 0 max(3px, ${saveShare}%)`, "--k": 3 } as React.CSSProperties}
          />
        )}
      </div>

      <ul className="ac-rows ac-stagger" style={{ "--i": 3 } as React.CSSProperties}>
        <li>
          <span style={{ fontWeight: 600 }}>Usual income</span>
          <strong style={{ fontWeight: 700 }}>{euros(usual.incomeCents)}</strong>
        </li>
        <li>
          <span className="ac-row-label">
            <span className="ac-dot ac-dot-regular" aria-hidden="true" />
            Regular essentials
          </span>
          <span>{minusEuros(usual.regularCents)}</span>
        </li>
        <li>
          <span className="ac-row-label">
            <span className="ac-dot ac-dot-unexpected" aria-hidden="true" />
            Unexpected necessities
          </span>
          <span>{minusEuros(usual.unexpectedCents)}</span>
        </li>
        <li>
          <span className="ac-row-label">
            <span className="ac-dot ac-dot-everyday" aria-hidden="true" />
            Everyday spending
          </span>
          <span>{minusEuros(usual.everydayCents)}</span>
        </li>
      </ul>

      {noticed && (
        <div style={{ marginBottom: 6 }}>
          <NoticedRow noticed={noticed} busy={busy} revision={revision} onAction={onAction} index={4} />
        </div>
      )}

      <p className="ac-footer ac-stagger" style={{ "--i": 5 } as React.CSSProperties}>
        Usual month: average of {monthRange(usual.baseline.start, usual.baseline.end)}.
      </p>
    </section>
  );
}

export function GoalCard({
  verdict,
  noticed,
  busy,
  revision,
  onAction,
}: {
  verdict: GoalVerdict;
  noticed: Noticed | null;
  busy: boolean;
  revision: number;
  countActive?: boolean;
  onAction: (request: CoachRequest) => void;
}) {
  const eyebrowId = useId();

  return (
    <section className="ac-card" aria-labelledby={eyebrowId}>
      <h2 id={eyebrowId} className="ac-eyebrow ac-stagger" style={{ "--i": 0 } as React.CSSProperties}>
        Your goal · {goalAmount(verdict.goal.amountCents)} by {lastDayOfMonth(verdict.goal.targetMonth)}
      </h2>

      <p className="ac-goal-headline" data-verdict={verdict.verdict}>
        {verdict.verdict === "on_track" && "On track"}
        {verdict.verdict === "stretch" && "Possible, but a stretch"}
        {verdict.verdict === "out_of_reach" && "Out of reach"}
      </p>

      <p className="ac-goal-line ac-stagger" style={{ "--i": 1 } as React.CSSProperties}>
        {euros(verdict.monthlyCents)} a month for {verdict.months} {verdict.months === 1 ? "month" : "months"}
      </p>

      <p className="ac-goal-copy ac-stagger" style={{ "--i": 2 } as React.CSSProperties}>
        {verdict.verdict === "on_track" && (
          <>Your everyday jar needs to be {euros(verdict.neededJarCents)}. Your usual month already fits inside it.</>
        )}
        {verdict.verdict === "stretch" && (
          <>
            Your everyday jar needs to be {euros(verdict.neededJarCents)}. That is {euros(verdict.cutCents)} less than your usual month. You stayed inside it in{" "}
            <strong>
              {verdict.monthsInside} of your last {verdict.history.length} months
            </strong>
            .
          </>
        )}
        {verdict.verdict === "out_of_reach" && (
          <>
            Your everyday jar would need to be {euros(verdict.neededJarCents)}. Your lowest month in the last six was{" "}
            <strong>{euros(verdict.lowestMonthCents)}</strong>.
          </>
        )}
      </p>

      <ol
        className="ac-month-marks ac-stagger"
        aria-label={
          verdict.monthsInside === 0
            ? "Last six months against the goal jar: all six over"
            : "Last six months against the goal jar"
        }
        style={{ "--i": 3 } as React.CSSProperties}
      >
        {verdict.history.map((item, index) => {
          const shortMonth = new Date(`${item.month}-01T12:00:00Z`).toLocaleDateString("en-GB", {
            month: "short",
            timeZone: "UTC",
          });
          return (
            <li key={item.month} className="ac-month-mark" style={{ "--k": index } as React.CSSProperties}>
              <span className="ac-mark-disc" data-inside={String(item.inside)} aria-hidden="true">
                {item.inside ? "✓" : "!"}
              </span>
              <span className="sp-sr">{item.inside ? "Inside, " : "Over, "}</span>
              {shortMonth}
            </li>
          );
        })}
      </ol>

      {verdict.verdict === "out_of_reach" ? (
        <>
          <p className="ac-subtext ac-stagger" style={{ "--i": 4 } as React.CSSProperties}>
            Try a smaller amount or a later month.
          </p>
          <div className="ac-card-actions ac-stagger" style={{ "--i": 5 } as React.CSSProperties}>
            <button
              type="button"
              className="ac-press"
              disabled={busy}
              onClick={() => onAction({ action: "ask", revision, text: changeGoalText })}
            >
              Change the goal
            </button>
          </div>
        </>
      ) : (
        <>
          {noticed && (
            <div style={{ marginBottom: 20 }}>
              <NoticedRow noticed={noticed} busy={busy} revision={revision} onAction={onAction} index={4} />
            </div>
          )}
          <div className="ac-card-actions ac-stagger" style={{ "--i": 5 } as React.CSSProperties}>
            <button
              type="button"
              className="ac-press"
              disabled={busy}
              onClick={() => onAction({ action: "set-goal", revision, goal: verdict.goal, confirmed: true })}
            >
              Set this goal
            </button>
            <button
              type="button"
              className="sp-secondary ac-press"
              disabled={busy}
              onClick={() => onAction({ action: "ask", revision, text: changeGoalText })}
            >
              Change it
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function PaymentsSheet({
  analysis,
  merchantNoticed,
  monthLabel,
  readOnly = false,
  busy,
  revision,
  onAction,
  onClose,
}: {
  analysis: Pick<Analysis, "evidence" | "evidenceCount" | "sections">;
  merchantNoticed?: CoachView["merchantNoticed"];
  monthLabel: string;
  readOnly?: boolean;
  busy: boolean;
  revision: number;
  onAction: (request: CoachRequest) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<"all" | Basket>("all");
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    if (reducedMotion()) {
      onClose();
    } else {
      setClosing(true);
    }
  }, [onClose]);

  const onAnimationEnd = (e: React.AnimationEvent) => {
    if (closing && e.currentTarget === e.target) {
      onClose();
    }
  };

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  const totalCount = analysis.evidenceCount || analysis.evidence.length;
  const regularCount = analysis.sections[0]?.rows.find(r => r.label === basketLabels.regular)?.count
    ?? analysis.evidence.filter(r => r.basket === "regular").length;
  const unexpectedCount = analysis.sections[0]?.rows.find(r => r.label === basketLabels.unexpected)?.count
    ?? analysis.evidence.filter(r => r.basket === "unexpected").length;
  const everydayCount = analysis.sections[0]?.rows.find(r => r.label === basketLabels.everyday)?.count
    ?? analysis.evidence.filter(r => r.basket === "everyday").length;

  const filteredEvidence = filter === "all"
    ? analysis.evidence
    : analysis.evidence.filter(r => r.basket === filter);

  const shownSum = filteredEvidence.reduce((sum, r) => sum + r.amountCents, 0);

  const dates = Array.from(new Set(filteredEvidence.map(r => r.date))).sort((a, b) => b.localeCompare(a));
  const noticedRow = merchantNoticed ? dates.flatMap(date => filteredEvidence.filter(row => row.date === date))
    .find(row => row.merchant === merchantNoticed.merchantId && row.date.slice(0, 7) === merchantNoticed.month) : undefined;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="sp-activities">
      <div className={`ac-sheet-backdrop${closing ? " ac-closing" : ""}`} onClick={handleClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${monthLabel} payments`}
        className={`ac-sheet${closing ? " ac-closing" : ""}`}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="ac-sheet-handle" aria-hidden="true" />
        <div className="ac-sheet-header">
          <div>
            <h2 className="ac-sheet-title">{monthLabel}</h2>
            <p className="ac-sheet-subtitle">
              {filteredEvidence.length} {filteredEvidence.length === 1 ? "payment" : "payments"} · {euros(shownSum)}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="ac-btn-close ac-press"
            aria-label="Close payments"
            onClick={handleClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {analysis.evidence.length < analysis.evidenceCount && (
          <p className="ac-sheet-limited">
            Showing {analysis.evidence.length} of {analysis.evidenceCount} payments.
          </p>
        )}

        <div className="ac-chips">
          <button
            type="button"
            className="ac-chip ac-press"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All {totalCount}
          </button>
          <button
            type="button"
            className="ac-chip ac-press"
            aria-pressed={filter === "everyday"}
            onClick={() => setFilter("everyday")}
          >
            <span className="ac-dot ac-dot-everyday" aria-hidden="true" />
            Everyday {everydayCount}
          </button>
          <button
            type="button"
            className="ac-chip ac-press"
            aria-pressed={filter === "regular"}
            onClick={() => setFilter("regular")}
          >
            <span className="ac-dot ac-dot-regular" aria-hidden="true" />
            Regular {regularCount}
          </button>
          <button
            type="button"
            className="ac-chip ac-press"
            aria-pressed={filter === "unexpected"}
            onClick={() => setFilter("unexpected")}
          >
            <span className="ac-dot ac-dot-unexpected" aria-hidden="true" />
            Unexpected {unexpectedCount}
          </button>
        </div>

        {!readOnly && <p className="ac-sheet-hint">Tap a payment to move it to another basket. The amount never changes.</p>}

        <div className="ac-sheet-list">
          {dates.map(date => {
            const dayRows = filteredEvidence.filter(r => r.date === date);
            return (
              <div key={date}>
                <p className="ac-day-heading">{dayHeading(date)}</p>
                {dayRows.map(row => {
                  const isExpanded = openRowId === row.id;
                  const otherBaskets = (["regular", "unexpected", "everyday"] as const).filter(b => b !== row.basket);
                  return (
                    <div key={row.id}>
                      <button
                        type="button"
                        className="ac-payment-row ac-press"
                        aria-expanded={isExpanded}
                        aria-label={`${row.category}, ${row.merchant}, ${euros(row.amountCents)}, ${row.basket} basket`}
                        onClick={() => { if (!readOnly) setOpenRowId(isExpanded ? null : row.id); }}
                      >
                        <span className={`ac-dot ac-dot-${row.basket}`} aria-hidden="true" />
                        <span className="ac-payment-main">
                          <span className="ac-payment-cat">{row.category}</span>
                          <span className="ac-payment-merchant">{row.merchant}</span>
                        </span>
                        <span className="ac-payment-amount">{euros(row.amountCents)}</span>
                        {!readOnly && <span className="ac-payment-chevron" aria-hidden="true">›</span>}
                      </button>
                      {merchantNoticed && row.id === noticedRow?.id && (
                        <NoticedRow
                          noticed={merchantNoticed.noticed}
                          busy={busy}
                          revision={revision}
                          onAction={request => { onClose(); onAction(request); }}
                        />
                      )}
                      {isExpanded && (
                        <div className="ac-payment-panel">
                          <p className="ac-panel-title">Move to another basket</p>
                          <div className="ac-panel-actions">
                            {otherBaskets.map(b => (
                              <button
                                key={b}
                                type="button"
                                className="sp-secondary ac-press"
                                disabled={busy}
                                onClick={() =>
                                  onAction({
                                    action: "correct",
                                    revision,
                                    transactionId: row.id,
                                    basket: b,
                                    confirmed: true,
                                  })
                                }
                              >
                                {basketLabels[b]}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>
    </div>,
    document.body
  );
}

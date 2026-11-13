"use client";

import type { CSSProperties } from "react";
import "./activities.css";

export type CoachState = "ready" | "listening" | "thinking" | "speaking" | "celebrate";
const labels: Record<CoachState, [string, string]> = {
  ready: ["Ready", "Tap to talk"],
  listening: ["Listening", "Stop and send"],
  thinking: ["Thinking", ""],
  speaking: ["Speaking", "Speak instead"],
  celebrate: ["Check-in complete", ""],
};

export function Coach({ state, level, onPress, disabled = false, compact = false }: {
  state: CoachState;
  level: number;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [label, action] = labels[state];
  const energy = (state === "listening" || state === "speaking") && Number.isFinite(level)
    ? Math.min(1, Math.max(0, level)) : 0;
  return <div className="sp-coach" data-state={state} data-compact={compact}
    style={{ "--sp-level": energy } as CSSProperties}>
    <button className="sp-coach-trigger" type="button" onClick={onPress}
      disabled={disabled || !action} aria-label={`Sponky. ${action || label}`}>
      <span className="sp-coach-motion" key={state}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          {[3, -23].map((offset, i) => <g key={offset} transform={`translate(${offset} 0)`}>
            <g className={`sp-ribbon sp-ribbon-${i}`}>
              <path className="sp-ribbon-base" pathLength="100" d="M66 10C104 34 36 80 74 110" />
              <path className="sp-ribbon-highlight" pathLength="100" d="M66 10C104 34 36 80 74 110" />
            </g>
          </g>)}
        </svg>
      </span>
    </button>
    <div className="sp-coach-label"><strong role="status">{label}</strong>
      {action && <span aria-hidden="true">{action}</span>}</div>
  </div>;
}

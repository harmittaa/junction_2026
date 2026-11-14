"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import "./activities.css";

export type CoachState = "ready" | "listening" | "thinking" | "speaking" | "celebrate";
const labels: Record<CoachState, [string, string]> = {
  ready: ["Ready", "Hold to talk"],
  listening: ["Listening", "Release to send"],
  thinking: ["Thinking", ""],
  speaking: ["Speaking", "Hold to interrupt"],
  celebrate: ["Check-in complete", ""],
};

const directions = Array.from({ length: 32 }, (_, i) => ({
  x: Math.cos(i / 32 * Math.PI * 2), y: Math.sin(i / 32 * Math.PI * 2),
}));

type Hold = { kind: "pointer"; id: number } | { kind: "key"; key: string };

export function Coach({ state, readBands, onStart, onRelease, onCancel, connecting = false, disabled = false, compact = false }: {
  state: CoachState;
  readBands: (out: Float32Array) => boolean;
  onStart: () => void;
  onRelease: () => void;
  onCancel: () => void;
  connecting?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [label, action] = connecting ? ["Connecting", "Release to cancel"] : labels[state];
  const helpId = useId();
  const held = useRef<Hold | null>(null);
  const cancelHold = useCallback(() => {
    if (!held.current) return;
    held.current = null;
    onCancel();
  }, [onCancel]);
  function startHold(hold: Hold) {
    if (held.current || disabled || (state !== "ready" && state !== "speaking")) return;
    held.current = hold;
    onStart();
  }
  function releaseHold() {
    if (!held.current) return;
    held.current = null;
    onRelease();
  }
  useEffect(() => {
    const hide = () => { if (document.hidden) cancelHold(); };
    window.addEventListener("blur", cancelHold);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", cancelHold);
      document.removeEventListener("visibilitychange", hide);
      cancelHold();
    };
  }, [cancelHold]);
  const root = useRef<HTMLDivElement>(null);
  const lines = useRef<(SVGLineElement | null)[]>([]);
  const animation = useRef({
    values: new Float32Array(32), opacity: new Float32Array(32), mix: new Float32Array(32),
    bands: new Float32Array(32), previous: state, leftThinking: -Infinity,
    sweepSince: -Infinity, headAt: 0,
  });

  useEffect(() => {
    const a = animation.current;
    const now = performance.now();
    if (a.previous === "thinking" && state !== "thinking") a.leftThinking = now;
    if (a.previous === "thinking" && state === "speaking") {
      a.sweepSince = now;
      a.headAt = (now / 900) % 1;
    } else if (state !== "speaking") a.sweepSince = -Infinity;
    a.previous = state;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = now;
    const tick = (time: number) => {
      const dt = Math.max(0, time - last);
      last = time;
      const ease = (k: number) => 1 - (1 - k) ** (dt / 16.7);
      const lengthEase = ease(state === "thinking" || time - a.leftThinking < 1000 ? 0.12 : 0.3);
      const opacityEase = ease(0.15), colorEase = ease(0.1);
      const audio = (state === "listening" || state === "speaking") && readBands(a.bands);
      const hidden = state === "ready" || state === "celebrate";
      let settled = true;
      let energy = 0;
      for (let i = 0; i < 32; i++) {
        const waiting = state === "speaking" && audio && !motion.matches
          && time - a.sweepSince < ((i / 32 - a.headAt + 1) % 1) * 450;
        const spinner = state === "thinking" || waiting;
        const tail = Math.max(0, 1 - (((time / 900) % 1 - i / 32 + 1) % 1) / 0.4);
        const value = hidden ? 0 : spinner ? (motion.matches ? 0.12 : 0.06 + tail * 0.3)
          : audio ? (motion.matches ? 0.15 : a.bands[i]) : 0;
        const opacity = hidden ? 0 : spinner ? (motion.matches ? 0.6 : 0.2 + tail * 0.8) : audio ? 1 : 0;
        const mix = state === "speaking" && !waiting ? 1 : 0;
        a.values[i] = motion.matches ? value : a.values[i] + (value - a.values[i]) * lengthEase;
        a.opacity[i] += (opacity - a.opacity[i]) * opacityEase;
        a.mix[i] += (mix - a.mix[i]) * colorEase;
        // Snap only imperceptible fade remnants, allowing idle loops to stop.
        if (Math.abs(a.opacity[i] - opacity) < 0.001) a.opacity[i] = opacity;
        if (Math.abs(a.mix[i] - mix) < 0.001) a.mix[i] = mix;
        settled &&= Math.abs(a.opacity[i] - opacity) < 0.001 && (hidden || Math.abs(a.mix[i] - mix) < 0.001);
        const radius = 66 + 4 + a.values[i] * 28;
        const line = lines.current[i];
        line?.setAttribute("x2", String(100 + directions[i].x * radius));
        line?.setAttribute("y2", String(100 + directions[i].y * radius));
        line?.setAttribute("opacity", String(a.opacity[i]));
        if (line) line.style.stroke = `color-mix(in srgb, var(--coach) ${a.mix[i] * 100}%, var(--user))`;
        energy += audio ? a.bands[i] / 32 : 0;
      }
      // Preserve the ribbon's audio response without publishing frames to React.
      root.current?.style.setProperty("--sp-level", String(motion.matches ? 0 : energy));
      if ((!hidden && !motion.matches) || !settled) frame = requestAnimationFrame(tick);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    motion.addEventListener("change", restart);
    restart();
    return () => { cancelAnimationFrame(frame); motion.removeEventListener("change", restart); };
  }, [state, readBands]);

  return <div ref={root} className="sp-coach" data-state={state} data-compact={compact}>
    <button className="sp-coach-trigger" type="button"
      disabled={disabled || !action} aria-label={`Sponky. ${action || label}`} aria-describedby={helpId}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        startHold({ kind: "pointer", id: event.pointerId });
      }}
      onPointerUp={event => {
        if (held.current?.kind === "pointer" && held.current.id === event.pointerId) releaseHold();
      }}
      onPointerCancel={event => {
        if (held.current?.kind === "pointer" && held.current.id === event.pointerId) cancelHold();
      }}
      onLostPointerCapture={event => {
        if (held.current?.kind === "pointer" && held.current.id === event.pointerId) cancelHold();
      }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); cancelHold(); }
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) startHold({ kind: "key", key: event.key });
      }}
      onKeyUp={event => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (held.current?.kind === "key" && held.current.key === event.key) releaseHold();
      }}
      onBlur={cancelHold} onContextMenu={event => event.preventDefault()}>
      <svg className="sp-coach-bars" viewBox="0 0 200 200" aria-hidden="true">
        {directions.map(({ x, y }, i) => <line key={i} ref={node => { lines.current[i] = node; }}
          x1={100 + x * 66} y1={100 + y * 66} x2={100 + x * 70} y2={100 + y * 70}
          opacity="0" strokeWidth="4" strokeLinecap="round" />)}
      </svg>
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
    <span className="sp-sr" id={helpId}>Hold the button, Space or Enter to speak. Release to send. Escape cancels.</span>
  </div>;
}

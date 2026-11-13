"use client";

import { useId } from "react";
import "./activities.css";

export function History({ entries, onClose }: {
  entries: Array<{ role: "user" | "coach"; text: string }>;
  onClose: () => void;
}) {
  const id = useId();
  return <section className="sp-history" aria-labelledby={id}>
    <div className="sp-bar-label"><h2 id={id}>Conversation history</h2>
      <button className="sp-secondary" type="button" onClick={onClose}>Close history</button></div>
    {entries.length === 0 ? <p>Your conversation will appear here.</p> :
      <ol>{entries.map((entry, index) => <li key={index} data-role={entry.role}>
        <strong>{entry.role === "user" ? "You" : "Sponky"}</strong><p>{entry.text}</p>
      </li>)}</ol>}
  </section>;
}

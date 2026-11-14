"use client";

import { useEffect, useState } from "react";
import { type CoachRequest } from "@/shared/contracts";
import { SafeToSaveCard, GoalCard } from "@/components/answer-cards";
import { SpenderCard } from "@/components/activities";
import {
  saveFixture,
  saveNoticedFixture,
  stretchFixture,
  stretchNoticedFixture,
  outOfReachFixture,
  onTrackFixture,
  profileFixture,
  profileNoticedFixture,
} from "@/components/answer-cards.fixtures";

export default function AnswerCardsPreviewPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lastRequest, setLastRequest] = useState<CoachRequest | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const handleAction = (req: CoachRequest) => {
    setLastRequest(req);
  };

  return (
    <div style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 18, color: "var(--textBrand)" }}>Answer Cards Preview</h1>
        <button
          type="button"
          className="sp-secondary ac-press"
          style={{ minHeight: 48, padding: "8px 16px" }}
          onClick={() => setTheme(t => (t === "light" ? "dark" : "light"))}
        >
          Theme: {theme}
        </button>
      </header>

      <div className="app">
        <div className="sp-activities">
          <SafeToSaveCard
            save={saveFixture}
            noticed={saveNoticedFixture}
            busy={false}
            revision={1}
            onAction={handleAction}
          />
          <GoalCard
            verdict={stretchFixture}
            noticed={stretchNoticedFixture}
            busy={false}
            revision={1}
            onAction={handleAction}
          />
          <GoalCard
            verdict={outOfReachFixture}
            noticed={null}
            busy={false}
            revision={1}
            onAction={handleAction}
          />
          <GoalCard
            verdict={onTrackFixture}
            noticed={null}
            busy={false}
            revision={1}
            onAction={handleAction}
          />
          <SpenderCard
            analysis={profileFixture}
            noticed={profileNoticedFixture}
            busy={false}
            revision={1}
            onAction={handleAction}
          />
        </div>
      </div>

      <section style={{ marginTop: 24, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h2 style={{ fontSize: 14, color: "var(--textMuted)", margin: "0 0 8px" }}>Last request JSON</h2>
        <pre
          id="preview-last-request"
          style={{
            background: "var(--surfaceSubtle)",
            color: "var(--textPrimary)",
            padding: 12,
            borderRadius: 8,
            fontSize: 12,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(lastRequest, null, 2) ?? "None"}
        </pre>
      </section>
    </div>
  );
}

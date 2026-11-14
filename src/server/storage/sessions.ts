import "server-only";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { AppError } from "@/server/errors";
import { dataset } from "@/server/data";
import { initialState, migrateSessionState, sessionStateSchema, type SessionState } from "./state";

function database() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? "sponky-junction-2026";
  if (process.env.FIRESTORE_EMULATOR_HOST && !projectId.startsWith("demo-")) throw new Error("Emulator requires demo-* project");
  const app = getApps()[0] ?? initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  return getFirestore(app);
}
function sessionRef(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("Invalid session", 401);
  return database().collection("demoSessionsV1").doc(id);
}
function parseState(value: unknown) {
  const state = migrateSessionState(value);
  if (state.customerId !== dataset.customerId) throw new AppError("This session uses an older demo dataset. Start a new browser session.", 409);
  return state;
}
export async function readSession(id: string): Promise<SessionState> {
  const doc = await sessionRef(id).get();
  return doc.exists ? parseState(doc.data()?.state) : initialState();
}
export async function updateSession(id: string, revision: number, change: (state: SessionState) => SessionState) {
  const ref = sessionRef(id);
  return database().runTransaction(async tx => {
    const doc = await tx.get(ref);
    const current = doc.exists ? parseState(doc.data()?.state) : initialState();
    if (current.revision !== revision) throw new AppError("This session changed in another turn. Refresh and try again.", 409, true);
    const next = sessionStateSchema.parse({ ...change(current), revision: current.revision + 1 });
    tx.set(ref, { state: next }, { merge: true });
    return next;
  });
}

// Per-session bounds plus a shared daily ceiling protect the public demo's paid
// providers. This is not a billing cap; upstream pricing and abusive clients vary.
export async function consumeBudget(id: string, kind: "reasoning" | "speech" | "token", now = new Date(), units: 1 | 2 | 3 = 1) {
  const date = now.toISOString().slice(0, 10);
  const ref = sessionRef(id).collection("usage").doc(date);
  const global = database().collection("demoUsageV1").doc(date);
  const limits = { reasoning: [30, 250], speech: [40, 350], token: [20, 150] }[kind];
  await database().runTransaction(async tx => {
    const [sessionDoc, globalDoc] = await Promise.all([tx.get(ref), tx.get(global)]);
    const localCount = Number(sessionDoc.data()?.[kind] ?? 0);
    const globalCount = Number(globalDoc.data()?.[kind] ?? 0);
    const last = Number(sessionDoc.data()?.[`${kind}Last`] ?? 0);
    if (now.getTime() - last < 700 || localCount + units > limits[0] || globalCount + units > limits[1]) {
      throw new AppError("The demo's voice or reasoning limit is reached. Try typing later; saved activities still work.", 429, true);
    }
    // Reserve the maximum calls for this turn, including one composition retry.
    tx.set(ref, { [kind]: localCount + units, [`${kind}Last`]: now.getTime() }, { merge: true });
    tx.set(global, { [kind]: globalCount + units }, { merge: true });
  });
}

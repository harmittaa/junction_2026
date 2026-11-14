// Deterministic HTTP fixture, used only with the demo-* Firestore Emulator.
// This server is not included in the application and never calls a provider.
import { createServer } from "node:http";

createServer(async (request, response) => {
  if (request.method === "GET") { response.end("fixture ready"); return; }
  let input = "";
  for await (const part of request) input += part;
  const envelope = JSON.parse(input);
  // Exercise the selected model's request settings through the real SDK.
  if (envelope.model !== "gemini-3.5-flash-lite" || envelope.generation_config?.thinking_level !== "minimal"
    || ["temperature", "top_p", "top_k"].some(key => key in (envelope.generation_config ?? {}))) {
    response.writeHead(400); response.end('{"error":{"message":"unexpected model settings"}}'); return;
  }
  const { phase, userMessage, scope, facts } = JSON.parse(envelope.input);
  const respond = result => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "fixture-interaction", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(result) }] }] }));
  };
  if (phase === "compose") {
    if (JSON.stringify(facts).length > 16000 || /"(?:customerId|sourceRow|merchantId|transactions|userMessage)"\s*:/.test(JSON.stringify(facts))
      || (facts.kind === "invitation" && (facts.values.length || /amountCents|evidence/.test(JSON.stringify(facts))))) {
      response.writeHead(400); response.end('{"error":{"message":"unsafe composition context"}}'); return;
    }
    respond({ text: facts.subject === "Transportation" ? "You spent 99999 euros and saved 200 euros." : facts.fallback });
    return;
  }
  if (userMessage === "provider failure") { response.writeHead(503); response.end('{"error":{"message":"fixture unavailable"}}'); return; }
  // Verify bounded model context at the actual SDK HTTP boundary.
  if (JSON.stringify(scope).length > 4000 || /amountCents|transactions|sourceRow|customerId/.test(JSON.stringify(scope))) {
    response.writeHead(400); response.end('{"error":{"message":"unbounded model scope"}}'); return;
  }
  let result = { kind: "spending", query: { categories: ["Groceries"], baskets: [], merchantType: null, start: "2026-08-01", end: "2026-08-31" }, direct: true, percent: null, reply: "none", comparePeriod: null, by: null, top: null, concept: null, correction: null };
  if (/utilities/i.test(userMessage)) result.query.categories = ["Utilities"];
  if (/fabricated composition/i.test(userMessage)) result = { ...result, query: { ...result.query, categories: ["Transportation"] }, direct: true };
  if (/where.*money|breakdown/i.test(userMessage)) result = { ...result, kind: "breakdown", query: { ...result.query, categories: [] }, by: "category", top: 5 };
  if (/taxi/i.test(userMessage)) result.query = { ...result.query, categories: [], merchantType: "taxi",
    start: `${scope.referenceDate.slice(0, 4)}-01-01`, end: scope.referenceDate };
  if (/pizza/i.test(userMessage)) result = { ...result, query: { ...result.query, categories: ["Restaurants"], merchantType: "fast_food" }, direct: true, reply: "items" };
  if (/spender|profile/i.test(userMessage)) result = { ...result, kind: "profile", query: null };
  if (/going up|trend/i.test(userMessage)) result = { ...result, kind: "trend", query: { ...result.query, start: "2026-06-01" } };
  if (/compare/i.test(userMessage)) result = { ...result, kind: "comparison", comparePeriod: { start: "2026-07-01", end: "2026-07-31" } };
  if (/earn.*invest/i.test(userMessage)) result = { ...result, kind: "cashflow", query: { ...result.query, categories: [] } };
  if (/what if/i.test(userMessage) && !/cut restaurants|(?:cut|reduced) dining out/i.test(userMessage)) result = { ...result, kind: "scenario", query: scope.previousQuery, percent: 20 };
  if (/cut restaurants|(?:cut|reduced) dining out/i.test(userMessage)) {
    const isPastSelected = scope.selectedMonth && scope.selectedMonth < scope.referenceDate.slice(0, 7);
    const [y, m] = (isPastSelected ? scope.selectedMonth : scope.referenceDate.slice(0, 7)).split("-").map(Number);
    const start = isPastSelected ? `${scope.selectedMonth}-01` : `${scope.referenceDate.slice(0, 7)}-01`;
    const end = isPastSelected ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : scope.referenceDate;
    result = { ...result, kind: "whatif",
      query: { ...result.query, categories: ["Restaurants"], baskets: ["everyday"], start, end }, percent: 20 };
  }
  if (/on track|pace|per day/i.test(userMessage)) result = { ...result, kind: "pace", query: null };
  if (/more.*usual|compare.*usual/i.test(userMessage)) result = { ...result, kind: "usual", query: null, comparePeriod: null };
  if (/which days|pushed.*over/i.test(userMessage)) result = { ...result, kind: "overspend", query: null };
  if (/show.*jar/i.test(userMessage)) result = { ...result, kind: "jar", query: null };
  if (/check.?up/i.test(userMessage)) result = { ...result, kind: "weekly_checkup", query: null };
  if (/177[,.]96.*burst pipe/i.test(userMessage)) result = { ...result, kind: "move", query: null,
    correction: { amountCents: 17796, date: "2026-09-21", merchant: null, category: null, necessityQuote: userMessage } };
  if (/long day/i.test(userMessage)) result = { ...result, kind: "chat", query: null, reply: "tired" };
  if (/another customer|100.day/i.test(userMessage)) result = { ...result, kind: "clarify", query: null, reply: "scope" };
  if (/fabricated reply/i.test(userMessage)) result = { ...result, kind: "chat", query: null, reply: "You saved 200 euros on taxis." };
  respond(result);
}).listen(3201, "127.0.0.1", () => console.log("Deterministic Gemini fixture on 3201"));

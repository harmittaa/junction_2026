// Deterministic HTTP fixture, used only with the demo-* Firestore Emulator.
// This server is not included in the application and never calls a provider.
import { createServer } from "node:http";

createServer(async (request, response) => {
  if (request.method === "GET") { response.end("fixture ready"); return; }
  let input = "";
  for await (const part of request) input += part;
  const envelope = JSON.parse(input);
  const { userMessage, scope } = JSON.parse(envelope.input);
  if (userMessage === "provider failure") { response.writeHead(503); response.end('{"error":{"message":"fixture unavailable"}}'); return; }
  // Verify bounded model context at the actual SDK HTTP boundary.
  if (JSON.stringify(scope).length > 2000 || /amountCents|transactions|sourceRow|customerId/.test(JSON.stringify(scope))) {
    response.writeHead(400); response.end('{"error":{"message":"unbounded model scope"}}'); return;
  }
  let result = { kind: "spending", query: { category: "Groceries", start: "2024-10-01", end: "2024-10-31" }, direct: /just show/i.test(userMessage), percent: null, reply: "none" };
  if (/utilities/i.test(userMessage)) result.query.category = "Utilities";
  if (/what if/i.test(userMessage)) result = { ...result, kind: "scenario", query: scope.previousQuery, percent: 20 };
  if (/long day/i.test(userMessage)) result = { ...result, kind: "chat", query: null, reply: "tired" };
  if (/another customer|100.day/i.test(userMessage)) result = { ...result, kind: "clarify", query: null, reply: "scope" };
  if (/fabricated reply/i.test(userMessage)) result = { ...result, kind: "chat", query: null, reply: "You saved 200 euros on taxis." };
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ id: "fixture-interaction", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(result) }] }] }));
}).listen(3201, "127.0.0.1", () => console.log("Deterministic Gemini fixture on 3201"));

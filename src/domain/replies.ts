import { z } from "zod";

// Application facts, not a provider object. No user prose or transaction list is
// forwarded to the writer. A hidden answer has no quantities at all.
export type ReplyFacts = {
  kind: string;
  subject: string;
  period: string;
  values: { label: string; amountCents?: number; percent?: number; count?: number }[];
  notes: string[];
  required?: string[];
  fallback: string;
};
export const replySchema = z.object({ text: z.string().trim().min(1).max(480) }).strict();

export const changeGoalText = "I want to change my goal";

const small: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const numberWords = new RegExp(`\\b(?:${Object.keys(small).join("|")}|hundred|thousand|million)(?:[ -]+(?:and[ -]+)?(?:${Object.keys(small).join("|")}|hundred|thousand|million))*\\b`, "gi");
function digits(text: string) {
  return text.replace(numberWords, phrase => {
    let total = 0, part = 0;
    for (const word of phrase.toLowerCase().split(/[ -]+/)) {
      if (word === "and") continue;
      if (word === "hundred") part = (part || 1) * 100;
      else if (word === "thousand" || word === "million") { total += (part || 1) * (word === "thousand" ? 1000 : 1000000); part = 0; }
      else part += small[word];
    }
    return String(total + part);
  });
}
const numeral = "[+−-]?\\d+(?:(?:[ \\u00a0\\u202f.,]\\d{3})+)?(?:[.,]\\d{1,2})?";
function decimal(raw: string): number {
  let value = raw.replace(/[\s\u00a0\u202f]/g, "").replace("−", "-");
  // The final one/two-digit group is decimal; three-digit groups are thousands.
  const fraction = value.match(/[.,](\d{1,2})$/);
  value = fraction ? value.slice(0, -fraction[0].length).replace(/[.,]/g, "") + "." + fraction[1] : value.replace(/[.,]/g, "");
  return Number(value);
}

/** Extract ALL quantities, including spelled numbers; unknown syntax fails closed. */
export function quantities(text: string): string[] {
  let rest = digits(text.normalize("NFKC")).replace(/\b(?:minus|negative)\s+(?=\d)/gi, "-");
  const found: string[] = [];
  const take = (regex: RegExp, convert: (...args: string[]) => string) => {
    rest = rest.replace(regex, (...args) => { found.push(convert(...args)); return " "; });
  };
  take(/\b\d{4}-\d{2}(?:-\d{2})?\b/g, value => `date:${value}`);
  take(/\b(?:\d{1,2} )?(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/gi,
    value => `date:${value.toLowerCase()}`);
  take(new RegExp(`(?:€|EUR\\b)\\s*(${numeral})|(${numeral})\\s*(?:€|euros?\\b|EUR\\b)(?:\\s+and\\s+(\\d{1,2})\\s+cents?)?`, "gi"),
    (_all, before, after, cents) => `money:${Math.round(decimal(before || after) * 100) + (/^[−-]/.test(before || after) ? -1 : 1) * Number(cents || 0)}`);
  take(new RegExp(`(${numeral})\\s*(?:%|percent(?:age)?|per cent)`, "gi"), (_all, value) => `percent:${decimal(value)}`);
  take(new RegExp(`(${numeral})\\s*cents?\\b`, "gi"), (_all, value) => `money:${decimal(value)}`);
  take(new RegExp(numeral, "g"), value => `number:${decimal(value)}`);
  // Fractions, scientific notation and non-ASCII numerals are not supported.
  if (/\p{N}|\b(?:half|quarter|dozen|billion|trillion)\b/iu.test(rest)) found.push("unsupported");
  return found;
}

function spokenInteger(value: number): string {
  if (!Number.isSafeInteger(value)) return String(value);
  if (value < 0 || Object.is(value, -0)) return `minus ${spokenInteger(-value)}`;
  const exact = Object.entries(small).find(([, number]) => number === value)?.[0];
  if (exact) return exact;
  if (value < 100) return `${spokenInteger(Math.floor(value / 10) * 10)} ${spokenInteger(value % 10)}`;
  const [scale, name] = ([[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1000, "thousand"], [100, "hundred"]] as const).find(([scale]) => value >= scale)!;
  return `${spokenInteger(Math.floor(value / scale))} ${name}${value % scale ? ` ${spokenInteger(value % scale)}` : ""}`;
}

export function speechText(text: string): string {
  return text.replace(/([−-]?\d(?:[\d.\u00a0\u202f ]*\d)?),(\d{2})\s*€/g, (_match, euros: string, cents: string) => {
    const negative = euros.startsWith("-") || euros.startsWith("−");
    const whole = Number(euros.replace(/[\s.\u00a0\u202f−-]/g, ""));
    const centValue = Number(cents);
    const rounded = whole + (centValue >= 50 ? 1 : 0);
    const signed = negative && rounded > 0 ? -rounded : rounded;
    const unit = Math.abs(signed) === 1 ? "euro" : "euros";
    if (centValue === 0) return `${spokenInteger(signed)} ${unit}`;
    return `about ${spokenInteger(signed)} ${unit}`;
  });
}

export function verifyReply(text: string, facts: ReplyFacts): boolean {
  if (!replySchema.shape.text.safeParse(text).success || speechText(text).length > 600) return false;
  if (/\b(?:demo|simulated|historical|assumptions?)\b/i.test(text)) return false;
  if (/\b(?:was any|were any|was that|was this)\b.{0,50}\b(?:must|necessity|necessary|essential)\b/i.test(text)) return false;
  if (/\b(?:goal saved|you(?:'ve| have)?\s+(?:actually\s+)?saved)\b/i.test(text)) return false;
  if (quantities(text).filter(value => value.startsWith("money:")).length > 1) return false;
  if (["jar", "pace", "usual", "overspend", "save", "goal", "spend_week"].includes(facts.kind)) {
    if (!facts.required?.length || facts.required.some(note => text.split(note).length !== 2)) return false;
    const extra = facts.required.reduce((rest, note) => rest.replace(note, ""), text).trim();
    return ["", "We can look at it together.", "One step at a time.", "You've got this."].includes(extra);
  }
  if (/\d(?:e[+-]?\d|[kmb]\b)|\d\s*\/\s*\d|[$£¥]|\bpoint\b/i.test(text)) return false;
  const allowed = new Set<string>();
  for (const value of facts.values) {
    if (value.amountCents !== undefined) allowed.add(`money:${value.amountCents}`);
    if (value.percent !== undefined) allowed.add(`percent:${value.percent}`);
    if (value.count !== undefined) allowed.add(`number:${value.count}`);
  }
  // Dates and explanatory counts must also originate in application-owned text.
  for (const token of quantities([facts.period, ...facts.notes, ...(facts.required ?? []), ...facts.values.map(value => value.label)].join(" "))) {
    if (!token.startsWith("money:")) allowed.add(token);
  }
  if (quantities(text).some(value => !allowed.has(value))) return false;
  if (facts.required?.some(note => text.split(note).length !== 2)) return false;
  // Membership is necessary but not sufficient: forbid unsupported financial
  // interpretations even when the amount happens to occur elsewhere in facts.
  if (/\b(?:afford|affordable|safe to spend|safe to save|wealthy|poor|reckless|irresponsible|overspend\w*|underspend\w*|impulsive|frugal|compared (?:with|to) others)\b/i.test(text)) return false;
  if (/\b(?:you(?:'ve| have)?|we|i)\s+(?:actually\s+)?(?:saved|transferred|moved|earned interest|achieved|completed|updated|changed|paid off)\b/i.test(text)) return false;
  if (/\b(?:because you|you (?:always|never)|your (?:salary|balance|debt|savings goal))\b/i.test(text)) return false;
  if (/\b(?:pizza|coffee|sandwich|burger)\b/i.test(text) && !/\b(?:items?|cannot|can't|not available)\b/i.test(text)) return false;
  if (["invitation", "chat", "clarify", "explain"].includes(facts.kind) && /\b(?:you spent|your spending (?:is|was|has)|you earned|you invested|your transactions? (?:show|was|were)|your (?:largest|smallest|highest|lowest|biggest)|you spend (?:most|more|less))\b/i.test(text)) return false;
  if (facts.kind === "whatif" && !/hypothetical/i.test(text)) return false;
  if (facts.kind === "cashflow" && (!/recorded transfers to investments/i.test(text)
    || /\bsavings\b/i.test(text.replace(/not (?:proof of |verified )?savings\b/gi, "")))) return false;
  return true;
}

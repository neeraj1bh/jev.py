import type { Answer, Question, Response, Row } from "./types";

// A score's answer is its most probable level, not the rounded expected level.
const likeliestLevel = (probabilities: Record<string, number>) =>
  Object.entries(probabilities).reduce((best, next) => (next[1] > best[1] ? next : best))[0];

export const answerLabel = (answer: Answer) =>
  answer.type === "noul"
    ? answer.noul >= 0.5
      ? "yes"
      : "no"
    : answer.type === "choice"
      ? answer.choice
      : answer.probabilities && Object.keys(answer.probabilities).length
        ? likeliestLevel(answer.probabilities)
        : String(Math.round(answer.score));

const asText = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";

const normalize = (value: unknown) =>
  asText(value)
    .toLowerCase()
    .trim()
    .replace(/^true$/, "yes")
    .replace(/^false$/, "no");

export function matchesLabel(got: unknown, want: unknown) {
  const answer = normalize(got);
  const label = normalize(want);
  return answer === label || answer.split(/[\s(:,]/)[0] === label;
}

export const answerLabels = (answers: Record<string, Answer>) =>
  Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, answerLabel(answer)]));

/** Correct and total questions of one response against the dataset's labels. */
// A response belongs to one item, so its score never changes; replays re-score every row per frame.
const SCORES = new WeakMap<Response, [number, number]>();

export function scoreResponse(response: Response, truth: Record<string, string>): [number, number] {
  const cached = SCORES.get(response);
  if (cached) return cached;
  const ids = Object.keys(truth);
  const got = response.error ? {} : answerLabels(response.answers);
  const score: [number, number] = [
    ids.filter((id) => got[id] !== undefined && matchesLabel(got[id], truth[id])).length,
    ids.length,
  ];
  SCORES.set(response, score);
  return score;
}

export const percent = (correct: number, total: number) =>
  total ? `${((100 * correct) / total).toFixed(1)}%` : "–";

/** A written JSON reply as answers, each counted as certain. */
export function writtenAnswers(
  parsed: Record<string, unknown> | null,
  questions: Record<string, Question>,
) {
  const answers: Record<string, Answer> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (parsed?.[id] === undefined) continue;
    const value = asText(parsed[id]).trim().toLowerCase();
    const [firstWord = ""] = value.replace(/,/g, " ").split(/\s+/);
    if (question.type === "noul") {
      answers[id] = { type: "noul", noul: firstWord === "yes" || firstWord === "true" ? 1 : 0 };
    } else if (question.type === "choice") {
      const longestFirst = Object.keys(question.criteria ?? {}).sort((a, b) => b.length - a.length);
      const hit = longestFirst.find((option) => value.startsWith(option.toLowerCase()));
      if (hit !== undefined)
        answers[id] = { type: "choice", choice: hit, probabilities: { [hit]: 1 } };
    } else if (!Number.isNaN(Number.parseFloat(firstWord))) {
      answers[id] = { type: "score", score: Number.parseFloat(firstWord) };
    }
  }
  return answers;
}

export function parseWritten(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text.replace(/```\w*/g, "").trim());
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const inputSnippet = (state: unknown) =>
  (typeof state === "string"
    ? state
    : Object.values(state as Record<string, unknown>)
        .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
        .join(" · ")
  ).slice(0, 160);

export const readoutFooter = (response: Response) =>
  response.usage?.input_tokens
    ? `${response.usage.input_tokens.toLocaleString()} input tokens`
    : "";

export const fastestIndexes = (ms: number[]) => {
  const min = Math.min(...ms);
  return ms.filter((x) => x === min).length === 1 ? [ms.indexOf(min)] : [];
};

/** Column indexes fastest first, then the larger share right on a tie. */
export function rankColumns(rows: Row[], count: number) {
  const score = Array.from({ length: count }, (_, k) => {
    let correct = 0;
    let total = 0;
    let ms = 0;
    for (const row of rows) {
      const side = row.sides[k];
      if (!side) continue;
      const [c, n] = scoreResponse(side.response, row.item.truth);
      correct += c;
      total += n;
      ms += side.ms;
    }
    return { k, share: total ? correct / total : 0, ms };
  });
  return score.sort((a, b) => a.ms - b.ms || b.share - a.share).map(({ k }) => k);
}

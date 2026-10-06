import { describe, expect, it } from "vitest";

import {
  answerLabel,
  fastestIndexes,
  matchesLabel,
  parseWritten,
  percent,
  scoreResponse,
  writtenAnswers,
} from "./scoring";
import type { Question, Response } from "./types";

const intent: Record<string, Question> = {
  intent: { type: "choice", criteria: { time: null, timer: null, timezone: null, order: null } },
};

const writtenChoice = (text: string) => {
  const answer = writtenAnswers({ intent: text }, intent).intent;
  return answer?.type === "choice" ? answer.choice : undefined;
};

describe("writtenAnswers", () => {
  it("matches the longest option a written answer starts with", () => {
    expect(writtenChoice("timer")).toBe("timer");
    expect(writtenChoice("timezone please")).toBe("timezone");
  });

  it("still matches a shorter option on its own", () => {
    expect(writtenChoice("time")).toBe("time");
  });

  it("leaves out an answer that matches no option", () => {
    expect(writtenChoice("nothing")).toBeUndefined();
  });

  it("reads yes, true and a level from the first word", () => {
    const questions: Record<string, Question> = {
      refund: { type: "noul" },
      spam: { type: "noul" },
      level: { type: "score", criteria: ["calm", "annoyed", "angry"] },
    };
    const written = { refund: "Yes, a double charge", spam: false, level: "2 out of 3" };
    expect(writtenAnswers(written, questions)).toEqual({
      refund: { type: "noul", noul: 1 },
      spam: { type: "noul", noul: 0 },
      level: { type: "score", score: 2 },
    });
  });
});

describe("parseWritten", () => {
  it("reads a JSON object inside a code fence", () => {
    expect(parseWritten('```json\n{"refund": "yes"}\n```')).toEqual({ refund: "yes" });
  });

  it("rejects text that is not one JSON object", () => {
    expect(parseWritten("[1, 2]")).toBeNull();
    expect(parseWritten("not json")).toBeNull();
  });
});

describe("matchesLabel", () => {
  it("treats true and false as yes and no", () => {
    expect(matchesLabel(true, "yes")).toBe(true);
    expect(matchesLabel("False", "no")).toBe(true);
  });

  it("matches an answer that starts with the label", () => {
    expect(matchesLabel("billing (a double charge)", "billing")).toBe(true);
    expect(matchesLabel("shipping", "billing")).toBe(false);
  });
});

describe("answerLabel", () => {
  it("reads a yes/no answer as yes from one half up", () => {
    expect(answerLabel({ type: "noul", noul: 0.5 })).toBe("yes");
    expect(answerLabel({ type: "noul", noul: 0.49 })).toBe("no");
  });

  it("takes a score's most probable level, not its rounded mean", () => {
    const probabilities = { "0": 0.6, "1": 0, "2": 0.4 };
    expect(answerLabel({ type: "score", score: 0.8, probabilities })).toBe("0");
    expect(answerLabel({ type: "score", score: 1.6 })).toBe("2");
  });
});

describe("scoreResponse", () => {
  it("counts the answers that match the labels", () => {
    const response: Response = {
      answers: {
        refund: { type: "noul", noul: 0.9 },
        team: { type: "choice", choice: "shipping", probabilities: { shipping: 1 } },
      },
    };
    expect(scoreResponse(response, { refund: "yes", team: "billing" })).toEqual([1, 2]);
  });

  it("counts an error as no question right", () => {
    const failed: Response = { answers: {}, error: { message: "rate limited" } };
    expect(scoreResponse(failed, { refund: "yes" })).toEqual([0, 1]);
  });
});

describe("percent", () => {
  it("shows one decimal, and a dash when nothing was asked", () => {
    expect(percent(1, 3)).toBe("33.3%");
    expect(percent(0, 0)).toBe("–");
  });
});

describe("fastestIndexes", () => {
  it("names the single fastest column, and none on a tie", () => {
    expect(fastestIndexes([30, 10, 20])).toEqual([1]);
    expect(fastestIndexes([10, 10, 20])).toEqual([]);
  });
});

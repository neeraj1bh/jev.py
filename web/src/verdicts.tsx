import { Fragment } from "react";

import { answerLabel, fastestIndexes, matchesLabel } from "./scoring";
import type { GeneratedText, RecordedSide, Recording, Row, Side } from "./types";

export function timesSentence(names: string[], ms: number[]) {
  const [fastest] = fastestIndexes(ms);
  return names.map((name, k) => (
    <Fragment key={name}>
      {k > 0 && ", "}
      {name} {k === fastest ? <b>{ms[k]} ms</b> : `${ms[k]} ms`}
    </Fragment>
  ));
}

export function compareVerdict(names: string[], sides: RecordedSide[]) {
  const labelOf = (side: RecordedSide, id: string) => {
    const answer = side.response.answers[id];
    return answer && answerLabel(answer);
  };
  const disagreed = Object.keys(sides[0]?.response.answers ?? {}).filter(
    (id) => new Set(sides.map((side) => labelOf(side, id))).size > 1,
  );
  return (
    <>
      {timesSentence(
        names,
        sides.map((side) => side.ms),
      )}
      {disagreed.length ? (
        <>
          ; they disagreed on <span className="text-warn">{disagreed.join(", ")}</span>.
        </>
      ) : (
        `; ${names.length > 2 ? "all agreed" : "they agreed"} on every answer.`
      )}
    </>
  );
}

export function generateVerdict(written: GeneratedText, read: RecordedSide, sameMachine: boolean) {
  const ratio = written.ms / read.ms;
  const { parsed } = written;
  const mismatched = parsed
    ? Object.entries(read.response.answers)
        .filter(([id, answer]) => !matchesLabel(parsed[id], answerLabel(answer)))
        .map(([id]) => id)
    : [];
  const speed =
    ratio >= 1 ? (
      <>
        Reading the probabilities was <b>{ratio.toFixed(1)}× faster</b>
      </>
    ) : (
      <>
        Writing the text was <b>{(1 / ratio).toFixed(1)}× faster</b>
      </>
    );
  const agreement = !parsed ? (
    ", and the text was not valid JSON."
  ) : mismatched.length ? (
    <>
      {" "}
      and the text disagreed on <span className="text-warn">{mismatched.join(", ")}</span>.
    </>
  ) : (
    " and both gave the same answers."
  );
  return (
    <>
      Same model. {speed}
      {agreement}
      {sameMachine && " Run one after the other on this machine; Replay shows them side by side."}
    </>
  );
}

const sideFooter = (side: Side, name: string) =>
  name.endsWith("· text")
    ? "written answers, each counted as certain"
    : side.response.usage?.input_tokens
      ? `${side.response.usage.input_tokens} input tokens · a probability for every option`
      : "a probability for every option";

/** A finished batch row as something Replay can play back. */
export function rowRecording(rows: Row[], index: number, names: string[]): Recording | null {
  const row = rows[index];
  if (!row || row.sides.some((side) => side.response.error)) return null;
  const { sides } = row;
  return {
    sides: sides.map((side, k) => ({
      ms: side.ms,
      response: side.response,
      footer: sideFooter(side, names[k] ?? ""),
    })),
    verdict: (
      <>
        Item {index + 1}:{" "}
        {timesSentence(
          names,
          sides.map((side) => side.ms),
        )}
        .
      </>
    ),
  };
}

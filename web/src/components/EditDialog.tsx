import { useLayoutEffect, useRef } from "react";

import { cx, ghostButton, labelText } from "../styles";
import { Modal } from "./Modal";

interface EditDialogProps {
  open: boolean;
  onClose: () => void;
  state: string;
  questions: string;
  onStateChange: (value: string) => void;
  onQuestionsChange: (value: string) => void;
}

export function EditDialog({
  open,
  onClose,
  state,
  questions,
  onStateChange,
  onQuestionsChange,
}: EditDialogProps) {
  const stateEditor = useRef<HTMLTextAreaElement>(null);
  const questionsEditor = useRef<HTMLTextAreaElement>(null);

  // Both editors grow to the taller one's content, so neither scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text or visibility changes
  useLayoutEffect(() => {
    const editors = [stateEditor.current, questionsEditor.current].filter(
      (editor) => editor !== null,
    );
    for (const editor of editors) editor.style.height = "auto";
    const height = Math.max(...editors.map((editor) => editor.scrollHeight)) + 2;
    for (const editor of editors) editor.style.height = `${height}px`;
  }, [open, state, questions]);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="m-0 text-[15px] font-semibold">State and questions</h2>
        <button type="button" className={ghostButton} onClick={onClose}>
          Done
        </button>
      </div>
      <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 max-[860px]:grid-cols-1">
        <div>
          <label htmlFor="state" className={cx(labelText, "mb-1.5 block")}>
            State — the thing being judged
          </label>
          <textarea
            id="state"
            ref={stateEditor}
            value={state}
            onChange={(event) => onStateChange(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="questions" className={cx(labelText, "mb-1.5 block")}>
            Questions — what to ask about it
          </label>
          <textarea
            id="questions"
            ref={questionsEditor}
            value={questions}
            onChange={(event) => onQuestionsChange(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

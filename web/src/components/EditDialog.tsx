import { cn, ghostButton, labelText } from "../styles";
import { Modal } from "./Modal";

const editor = "max-h-[60vh] min-h-[160px] overflow-auto [field-sizing:content]";

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
          <label htmlFor="state" className={cn(labelText, "mb-1.5 block")}>
            State — the thing being judged
          </label>
          <textarea
            className={editor}
            id="state"
            value={state}
            onChange={(event) => onStateChange(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="questions" className={cn(labelText, "mb-1.5 block")}>
            Questions — what to ask about it
          </label>
          <textarea
            className={editor}
            id="questions"
            value={questions}
            onChange={(event) => onQuestionsChange(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

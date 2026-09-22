import { ghostButton, solidButton } from "../styles";
import { Modal } from "./Modal";

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

/** The page's own yes/no question, in place of the browser's confirm box. */
export function ConfirmDialog({ request }: { request: ConfirmRequest | null }) {
  if (!request) return null;
  return (
    <Modal
      open
      onClose={() => request.resolve(false)}
      className="w-[min(460px,calc(100vw-32px))] px-6 py-5"
    >
      <h2 className="mt-0 mb-2 text-[15px] font-semibold">{request.title}</h2>
      <p className="mt-0 mb-5 text-sm break-words text-dim">{request.body}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={ghostButton} onClick={() => request.resolve(false)}>
          Cancel
        </button>
        <button type="button" className={solidButton} onClick={() => request.resolve(true)}>
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

import type { Backend } from "../types";
import { KeyForm } from "./KeyForm";
import { Modal } from "./Modal";

interface KeyDialogProps {
  backend: Backend;
  onCancel: () => void;
  onSaved: (backendId: string) => void;
}

/** Asks for a hosted backend's key when a model that needs it is picked. */
export function KeyDialog({ backend, onCancel, onSaved }: KeyDialogProps) {
  return (
    <Modal open onClose={onCancel} className="w-[min(440px,calc(100vw-32px))]">
      <h2 className="mt-0 mb-3.5 text-[15px] font-semibold">{backend.label} API key</h2>
      <KeyForm
        target={backend.id}
        label={`${backend.label} API key`}
        hint={backend.key ?? "API key"}
        onCancel={onCancel}
        onSaved={() => onSaved(backend.id)}
      />
    </Modal>
  );
}

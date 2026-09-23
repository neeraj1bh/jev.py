import { Key, X } from "@phosphor-icons/react";

import type { Backend } from "../types";
import { Icon } from "./Icon";
import { KeyForm } from "./KeyForm";
import { DialogFrame, Modal, RoundButton } from "./Modal";

interface KeyDialogProps {
  backend: Backend;
  onCancel: () => void;
  onSaved: (backendId: string) => void;
}

/** Asks for a hosted backend's key when a model that needs it is picked. */
export function KeyDialog({ backend, onCancel, onSaved }: KeyDialogProps) {
  return (
    <Modal
      open
      onClose={onCancel}
      className="w-[min(460px,calc(100vw-32px))] bg-lift p-1.5 open:flex open:animate-pop open:flex-col"
    >
      <DialogFrame
        icon={Key}
        title={`${backend.label} API key`}
        subtitle="Needed for this model; checked with one small request first"
        actions={
          <RoundButton label="Close" onClick={onCancel}>
            <Icon icon={X} size={14} />
          </RoundButton>
        }
        bodyClassName="px-4 py-3.5"
      >
        <KeyForm
          target={backend.id}
          label={`${backend.label} API key`}
          hint={backend.key ?? "API key"}
          onCancel={onCancel}
          onSaved={() => onSaved(backend.id)}
        />
      </DialogFrame>
    </Modal>
  );
}

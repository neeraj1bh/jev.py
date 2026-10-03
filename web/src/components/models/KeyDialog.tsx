import { KeyIcon, XIcon } from "@phosphor-icons/react";

import { Icon } from "../ui/Icon";
import { DialogFrame, Modal, RoundButton } from "../ui/Modal";
import { KeyForm } from "./KeyForm";

interface KeyDialogProps {
  /** The backend id or setting name the key is saved for. */
  target: string;
  label: string;
  hint: string;
  subtitle: string;
  secret?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

/** Asks for one key: when a model that needs it is picked, or from the list of keys. */
export function KeyDialog({
  target,
  label,
  hint,
  subtitle,
  secret,
  onCancel,
  onSaved,
}: KeyDialogProps) {
  return (
    <Modal
      open
      onClose={onCancel}
      className="w-[min(460px,calc(100vw-32px))] bg-lift p-1.5 open:flex open:animate-pop open:flex-col"
    >
      <DialogFrame
        icon={KeyIcon}
        title={label}
        subtitle={subtitle}
        actions={
          <RoundButton label="Close" onClick={onCancel}>
            <Icon icon={XIcon} size={14} />
          </RoundButton>
        }
        bodyClassName="px-4 py-3.5"
      >
        <KeyForm
          target={target}
          label={label}
          hint={hint}
          secret={secret}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      </DialogFrame>
    </Modal>
  );
}

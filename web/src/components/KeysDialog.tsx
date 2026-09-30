import {
  ArrowSquareOut,
  Cloud,
  Globe,
  HardDrives,
  Key,
  type Icon as PhosphorIcon,
  Smiley,
  Sparkle,
  Triangle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { clearKey, fetchKeys } from "../api";
import { chipButton, cn } from "../styles";
import type { KeyInfo } from "../types";
import { Icon, IconTile } from "./Icon";
import { KeyDialog } from "./KeyDialog";
import { DialogFrame, Modal, RoundButton } from "./Modal";
import { Skeleton } from "./Skeleton";

/** Settings that are addresses or paths, typed in the open rather than as secrets. */
const HINTS: Record<string, string> = {
  LLAMACPP_URL: "The llama-server address, e.g. http://localhost:8081/v1/chat/completions",
  LAYA_URL: "The laya-serve address, e.g. http://localhost:8000/v1/systemone",
};

/** What each key reaches, at a glance: the real Jev, a hosted API, a gateway, a server. */
const ICONS: Record<string, PhosphorIcon> = {
  TYPESAFE_API_KEY: Sparkle,
  OPENROUTER_API_KEY: Globe,
  AI_GATEWAY_API_KEY: Triangle,
  HF_TOKEN: Smiley,
  LLAMACPP_URL: HardDrives,
  LAYA_URL: HardDrives,
};

const quiet =
  "rounded-full border-0 bg-transparent px-2.5 py-1 text-xs text-dim transition-colors hover:bg-lift hover:text-ink";

interface KeyRowProps {
  info: KeyInfo;
  armed: boolean;
  onEdit: () => void;
  onArm: (armed: boolean) => void;
  onRemove: () => void;
}

function KeyRow({ info, armed, onEdit, onArm, onRemove }: KeyRowProps) {
  return (
    <li className="group border-0 border-b border-dashed border-rule last:border-b-0">
      <div className="flex items-center gap-3 px-1 py-2.5" title={info.unlocks}>
        <IconTile icon={ICONS[info.var] ?? Cloud} tone={info.set ? "ink" : "idle"} large />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className="truncate">{info.label}</span>
            {info.set && (
              <span className="inline-flex flex-none items-center gap-1 text-[11px] font-normal text-good">
                <span className="size-1.5 rounded-full bg-good" />
                <span className="max-[600px]:sr-only">connected</span>
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-[11px] text-dim">{info.var}</span>
        </span>
        {info.set ? (
          <span
            className={cn(
              "flex items-center gap-0.5 transition-opacity",
              armed
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-[600px]:opacity-100",
            )}
          >
            <button type="button" className={quiet} onClick={onEdit}>
              Replace
            </button>
            <button
              type="button"
              aria-label={`Remove the ${info.label} key`}
              className={cn(
                quiet,
                armed ? "bg-warn/10 text-warn hover:text-warn" : "hover:text-warn",
              )}
              onClick={() => (armed ? onRemove() : onArm(true))}
              onBlur={() => onArm(false)}
            >
              {armed ? "Click again to remove" : "Remove"}
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            {info.url && (
              <a
                href={info.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-dim no-underline transition-colors hover:text-ink"
              >
                Get a key
                <Icon icon={ArrowSquareOut} size={11} />
              </a>
            )}
            <button type="button" className={chipButton(true)} onClick={onEdit}>
              Add
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

interface KeysDialogProps {
  open: boolean;
  onClose: () => void;
  /** A key changed, so what the pickers can use may have too. */
  onChanged: () => void;
}

/** Every key and token in one place: which are set, what each unlocks, and a way to set it. */
export function KeysDialog({ open, onClose, onChanged }: KeysDialogProps) {
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [editing, setEditing] = useState("");
  const [armed, setArmed] = useState("");

  useEffect(() => {
    if (open) fetchKeys().then(setKeys);
  }, [open]);

  const refresh = () => {
    fetchKeys().then(setKeys);
    onChanged();
  };
  const row = (info: KeyInfo) => (
    <KeyRow
      key={info.var}
      info={info}
      armed={armed === info.var}
      onEdit={() => setEditing(info.var)}
      onArm={(on) => setArmed(on ? info.var : "")}
      onRemove={async () => {
        await clearKey(info.backend ?? info.var);
        setArmed("");
        refresh();
      }}
    />
  );
  const editingKey = keys?.find((info) => info.var === editing);
  const set = keys?.filter((info) => info.set) ?? [];
  const unset = keys?.filter((info) => !info.set) ?? [];
  const heading = "mt-1 mb-0.5 px-1 text-[10.5px] font-medium tracking-[0.08em] text-dim uppercase";

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-h-[calc(92vh-16px)] w-[min(620px,calc(100vw-32px))] bg-lift p-1.5 open:flex open:animate-pop open:flex-col"
    >
      <DialogFrame
        icon={Key}
        title="Keys and tokens"
        badge={keys ? `${set.length} / ${keys.length} set` : undefined}
        subtitle="Kept on this machine; each is checked with one small request before it is used"
        actions={
          <RoundButton label="Close" onClick={onClose}>
            <Icon icon={X} size={14} />
          </RoundButton>
        }
        bodyClassName="px-4 py-3"
        footer={
          <span>
            A key saved to <span className="font-mono">.env</span> stays on this machine; git
            ignores the file.
          </span>
        }
      >
        {keys === null ? (
          <ul className="m-0 list-none p-0">
            {["a", "b", "c", "d"].map((k) => (
              <li key={k} className="flex items-center gap-3 px-1 py-3">
                <Skeleton className="size-7 rounded-lg" />
                <Skeleton className="w-48" />
              </li>
            ))}
          </ul>
        ) : (
          <>
            {set.length > 0 && (
              <>
                <h3 className={heading}>Connected</h3>
                <ul className="m-0 list-none p-0">{set.map(row)}</ul>
              </>
            )}
            {unset.length > 0 && (
              <>
                <h3 className={cn(heading, set.length > 0 && "mt-4")}>Not set</h3>
                <ul className="m-0 list-none p-0">{unset.map(row)}</ul>
              </>
            )}
          </>
        )}
      </DialogFrame>
      {editingKey && (
        <KeyDialog
          target={editingKey.backend ?? editingKey.var}
          label={editingKey.label}
          hint={HINTS[editingKey.var] ?? `Paste your ${editingKey.label} key`}
          subtitle={editingKey.unlocks}
          secret={!(editingKey.var in HINTS)}
          onCancel={() => setEditing("")}
          onSaved={() => {
            setEditing("");
            refresh();
          }}
        />
      )}
    </Modal>
  );
}

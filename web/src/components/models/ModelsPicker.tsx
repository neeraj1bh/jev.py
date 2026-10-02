import { Stack } from "@phosphor-icons/react";

import { isOffline, statusText } from "../../lib/backends";
import { backendIcon } from "../../lib/icons";
import { cn } from "../../lib/styles";
import type { Backend } from "../../lib/types";
import { IconTile } from "../ui/Icon";
import { Dropdown } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import { type LocalModelActions, ModelMenu } from "./ModelMenu";
import type { MenuState } from "./ModelPicker";

export const MAX_COMPARE = 6;

export function PickedModels({ picked }: { picked: Backend[] }) {
  if (!picked.length) return <>Pick models</>;
  const names = picked.map((backend) => backend.label);
  return (
    <>
      <span className="flex self-center -space-x-1.5">
        {picked.slice(0, 3).map((backend) => (
          <IconTile
            key={backend.id}
            icon={backendIcon(backend)}
            tone="ink"
            className="ring-2 ring-panel"
          />
        ))}
      </span>
      {picked.length} models
      <span className="truncate text-[12.5px] text-dim">
        {names.slice(0, 2).join(", ")}
        {names.length > 2 && ` +${names.length - 2}`}
      </span>
    </>
  );
}

interface ModelsPickerProps extends MenuState {
  backends: Backend[];
  selected: string[];
  onToggle: (id: string) => void;
  local: LocalModelActions;
}

export function ModelsPicker({
  backends,
  selected,
  onToggle,
  local,
  open,
  onOpenChange,
}: ModelsPickerProps) {
  const picked = selected.flatMap((id) => backends.filter((backend) => backend.id === id));
  const chosen = (backend: Backend) => selected.includes(backend.id);
  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      icon={selected.length ? undefined : Stack}
      buttonClassName={cn("max-w-[min(560px,60vw)]", selected.length > 0 && "pl-1")}
      menuClassName="w-[360px]"
      button={
        backends.length === 0 ? (
          <Skeleton className="my-1 w-44" />
        ) : (
          <PickedModels picked={picked} />
        )
      }
    >
      <ModelMenu
        backends={backends}
        showChecks
        hint={
          selected.length >= MAX_COMPARE
            ? `${MAX_COMPARE} of ${MAX_COMPARE} picked · remove one to add another`
            : `Up to ${MAX_COMPARE} models · click to add or remove`
        }
        isSelected={chosen}
        isDisabled={(backend) =>
          (!chosen(backend) && selected.length >= MAX_COMPARE) || isOffline(backend)
        }
        detail={statusText}
        onSelect={onToggle}
        {...local}
      />
    </Dropdown>
  );
}

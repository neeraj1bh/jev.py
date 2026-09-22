import { isOffline, statusText } from "../backends";
import type { Backend } from "../types";
import { Dropdown } from "./Menu";
import { type LocalModelActions, ModelMenu } from "./ModelMenu";
import type { MenuState } from "./ModelPicker";
import { Skeleton } from "./Skeleton";

export const MAX_COMPARE = 6;

interface ModelsPickerProps extends MenuState {
  backends: Backend[];
  selected: string[];
  onToggle: (id: string) => void;
  local: LocalModelActions;
}

/** Up to six models for Compare; the menu stays open between picks. */
export function ModelsPicker({
  backends,
  selected,
  onToggle,
  local,
  open,
  onOpenChange,
}: ModelsPickerProps) {
  const names = selected.map((id) => backends.find((backend) => backend.id === id)?.label ?? id);
  const chosen = (backend: Backend) => selected.includes(backend.id);
  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      title={names.join(", ")}
      buttonClassName="max-w-[min(560px,60vw)]"
      menuClassName="w-[360px]"
      button={
        backends.length === 0 ? (
          <Skeleton className="my-1 w-44" />
        ) : selected.length === 0 ? (
          "Pick models"
        ) : (
          <>
            {selected.length} models
            <span className="truncate text-[12.5px] text-dim">
              {names.slice(0, 2).join(", ")}
              {names.length > 2 && ` +${names.length - 2}`}
            </span>
          </>
        )
      }
    >
      <ModelMenu
        backends={backends}
        showChecks
        hint={`Up to ${MAX_COMPARE} models · click to add or remove`}
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

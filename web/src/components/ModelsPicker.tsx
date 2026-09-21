import { isOffline, statusText } from "../backends";
import type { Backend } from "../types";
import { Dropdown } from "./Menu";
import { ModelMenu } from "./ModelMenu";
import type { MenuState } from "./ModelPicker";
import { Skeleton } from "./Skeleton";

const MAX_MODELS = 6;

interface ModelsPickerProps extends MenuState {
  backends: Backend[];
  selected: string[];
  onToggle: (id: string) => void;
}

/** Two to six models for Compare; the menu stays open between picks. */
export function ModelsPicker({
  backends,
  selected,
  onToggle,
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
        hint={`Compare 2 to ${MAX_MODELS} · click to add or remove`}
        isSelected={chosen}
        isDisabled={(backend) =>
          (chosen(backend) && selected.length <= 2) ||
          (!chosen(backend) && selected.length >= MAX_MODELS) ||
          isOffline(backend)
        }
        detail={statusText}
        onSelect={onToggle}
      />
    </Dropdown>
  );
}

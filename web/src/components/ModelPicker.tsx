import { isOffline, location, pickerSubtitle, statusText, TEXTLESS } from "../backends";
import type { Backend } from "../types";
import { Dropdown } from "./Menu";
import { ModelMenu } from "./ModelMenu";
import { Skeleton } from "./Skeleton";

export interface MenuState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ModelPickerProps extends MenuState {
  backends: Backend[];
  value: string;
  onPick: (id: string) => void;
}

/** One model for generate vs readout; Jev never writes text, so it is marked compare only. */
export function ModelPicker({ backends, value, onPick, open, onOpenChange }: ModelPickerProps) {
  const current = backends.find((backend) => backend.id === value);
  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      title={location(current)}
      menuClassName="w-[360px]"
      button={
        backends.length === 0 ? (
          <Skeleton className="my-1 w-44" />
        ) : (
          <>
            {current?.label ?? "Pick a model"}
            <span className="text-[12.5px] whitespace-nowrap text-dim">
              {pickerSubtitle(current)}
            </span>
          </>
        )
      }
    >
      <ModelMenu
        backends={backends}
        textlessLast
        hint="Claude and Groq return no probabilities, so they are not listed"
        isSelected={(backend) => backend.id === value}
        isDisabled={isOffline}
        detail={(backend) => (TEXTLESS.has(backend.id) ? "compare only" : statusText(backend))}
        onSelect={onPick}
      />
    </Dropdown>
  );
}

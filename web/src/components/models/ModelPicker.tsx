import { isOffline, location, pickerSubtitle, statusText, TEXTLESS } from "../../lib/backends";
import { backendIcon } from "../../lib/icons";
import type { Backend } from "../../lib/types";
import { Dropdown } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import { type LocalModelActions, ModelMenu } from "./ModelMenu";

export interface MenuState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ModelPickerProps extends MenuState {
  backends: Backend[];
  value: string;
  onPick: (id: string) => void;
  local: LocalModelActions;
}

/** One model for generate vs readout: only models that both write text and return probabilities. */
export function ModelPicker(props: ModelPickerProps) {
  const { backends, value, onPick, local, open, onOpenChange } = props;
  const current = backends.find((backend) => backend.id === value);
  const bothWays = backends.filter((backend) => !TEXTLESS.has(backend.id));
  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      title={location(current)}
      icon={backendIcon(current)}
      active={!!current}
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
        backends={bothWays}
        hint="Models that write text and return probabilities · Jev only compares"
        isSelected={(backend) => backend.id === value}
        isDisabled={isOffline}
        detail={statusText}
        onSelect={onPick}
        {...local}
      />
    </Dropdown>
  );
}

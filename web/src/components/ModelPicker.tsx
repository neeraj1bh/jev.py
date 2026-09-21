import { Fragment } from "react";

import {
  groupBackends,
  isOffline,
  location,
  pickerSubtitle,
  statusText,
  TEXTLESS,
} from "../backends";
import type { Backend } from "../types";
import { Dropdown, MenuHeading, MenuHint, MenuItem } from "./Menu";

export interface MenuState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ModelPickerProps extends MenuState {
  backends: Backend[];
  value: string;
  onPick: (id: string) => void;
}

/** One model for generate vs readout; Jev is listed as compare only. */
export function ModelPicker({ backends, value, onPick, open, onOpenChange }: ModelPickerProps) {
  const current = backends.find((backend) => backend.id === value);
  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      title={location(current)}
      button={
        <>
          <i
            className={
              current?.ready
                ? "size-[7px] flex-none rounded-full bg-good"
                : "size-[7px] flex-none rounded-full bg-bar"
            }
          />
          {current?.label ?? "Pick a model"}
          <span className="text-[12.5px] whitespace-nowrap text-dim">
            {pickerSubtitle(current)}
          </span>
        </>
      }
    >
      {groupBackends(backends, true).map(({ group, heading, backends: members }) => (
        <Fragment key={group}>
          <MenuHeading>{heading}</MenuHeading>
          {members.map((backend) => {
            const textless = TEXTLESS.has(backend.id);
            return (
              <MenuItem
                key={backend.id}
                selected={backend.id === value}
                disabled={isOffline(backend)}
                onSelect={() => onPick(backend.id)}
                label={backend.label}
                detail={textless ? "compare only" : statusText(backend)}
                highlightDetail={backend.ready && !textless}
              />
            );
          })}
          {group === "hosted" && (
            <MenuHint title="See docs/providers.md">Claude, Groq: no probabilities</MenuHint>
          )}
        </Fragment>
      ))}
    </Dropdown>
  );
}

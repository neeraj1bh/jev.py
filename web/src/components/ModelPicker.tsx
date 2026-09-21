import { Fragment } from "react";

import { isOffline, location, pickerSubtitle, statusText, TEXTLESS } from "../backends";
import type { Backend, BackendGroup } from "../types";
import { CheckMark } from "./CheckMark";
import { Dropdown, MenuHeading, MenuHint, MenuItem } from "./Menu";

const GROUPS: [BackendGroup, string][] = [
  ["local", "On this machine"],
  ["server", "Local server"],
  ["hosted", "Hosted"],
];

/** Usable backends first; with `textlessLast`, Jev (which cannot write text) after the rest. */
function grouped(backends: Backend[], textlessLast: boolean) {
  const rank = (backend: Backend) =>
    textlessLast && TEXTLESS.has(backend.id)
      ? 1
      : backend.ready || backend.group === "local"
        ? 0
        : 2;
  const device = backends.find((backend) => backend.group === "local")?.device ?? "";
  return GROUPS.map(([group, name]) => ({
    group,
    heading: group === "local" ? `${name} · ${device}` : name,
    backends: backends
      .filter((backend) => backend.group === group)
      .sort((a, b) => rank(a) - rank(b)),
  }));
}

interface MenuState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ModelsPickerProps extends MenuState {
  backends: Backend[];
  selected: string[];
  onToggle: (id: string) => void;
}

export function ModelsPicker({
  backends,
  selected,
  onToggle,
  open,
  onOpenChange,
}: ModelsPickerProps) {
  const names = selected.map((id) => backends.find((backend) => backend.id === id)?.label ?? id);
  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      title={names.join(", ")}
      buttonClassName="max-w-[min(560px,60vw)]"
      menuClassName="w-[340px]"
      button={
        <>
          {selected.length} models
          <span className="truncate text-[12.5px] text-dim">
            {names.slice(0, 2).join(", ")}
            {names.length > 2 && ` +${names.length - 2}`}
          </span>
        </>
      }
    >
      <MenuHeading>Compare 2 to 6 · click to add or remove</MenuHeading>
      {grouped(backends, false).map(({ group, heading, backends: members }) => (
        <Fragment key={group}>
          <MenuHeading>{heading}</MenuHeading>
          {members.map((backend) => {
            const isSelected = selected.includes(backend.id);
            const locked =
              (isSelected && selected.length <= 2) ||
              (!isSelected && selected.length >= 6) ||
              isOffline(backend);
            return (
              <MenuItem
                key={backend.id}
                selected={isSelected}
                disabled={locked}
                onSelect={() => onToggle(backend.id)}
                label={
                  <>
                    <i className="inline-block w-[18px] text-good">
                      {isSelected && <CheckMark ok />}
                    </i>
                    {backend.label}
                  </>
                }
                detail={statusText(backend)}
                highlightDetail={backend.ready}
              />
            );
          })}
        </Fragment>
      ))}
    </Dropdown>
  );
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
      {grouped(backends, true).map(({ group, heading, backends: members }) => (
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

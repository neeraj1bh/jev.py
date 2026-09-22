import { Fragment } from "react";

import { blockingBackend } from "../backends";
import type { Backend, Dataset } from "../types";
import { Dropdown, MenuHeading, MenuItem } from "./Menu";
import { Skeleton } from "./Skeleton";

const answerShape = (dataset: Dataset) =>
  dataset.frozen
    ? "frozen mix of sets"
    : dataset.yes_no
      ? "yes / no"
      : dataset.options
        ? `pick 1 of ${dataset.options}`
        : "several questions each";

interface DatasetMenuProps {
  datasets: Dataset[];
  value: string;
  onChange: (name: string) => void;
  /** Sets with more options than one of these can read are shown but cannot be picked. */
  pickedBackends: (Backend | undefined)[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The public datasets, with each one's answer shape and whether it is on disk yet. */
export function DatasetMenu({
  datasets,
  value,
  onChange,
  pickedBackends,
  open,
  onOpenChange,
}: DatasetMenuProps) {
  return (
    <Dropdown
      compact
      active={!!value}
      open={open}
      onOpenChange={onOpenChange}
      button={value || "Choose a set"}
    >
      {!datasets.some((set) => set.group) && <MenuHeading>Public datasets</MenuHeading>}
      {datasets.length === 0 &&
        ["w-32", "w-24", "w-36", "w-28"].map((width) => (
          <div key={width} className="px-2.5 py-2">
            <Skeleton className={width} />
          </div>
        ))}
      {datasets.map((set, k) => {
        const blocker = blockingBackend(set, pickedBackends);
        const heading = set.group && set.group !== datasets[k - 1]?.group ? set.group : null;
        return (
          <Fragment key={set.name}>
            {heading && <MenuHeading>{heading}</MenuHeading>}
            <MenuItem
              label={set.name}
              title={blocker ? `${blocker.label} reads ${blocker.max} options at most` : set.about}
              selected={set.name === value}
              disabled={!!blocker}
              onSelect={() => onChange(set.name)}
              highlightDetail={set.local && !blocker}
              detail={
                blocker
                  ? `1 of ${set.options} · too many for this model`
                  : set.needs_token
                    ? "needs a Hugging Face token"
                    : answerShape(set) + (set.local ? " · on disk" : " · download")
              }
            />
          </Fragment>
        );
      })}
    </Dropdown>
  );
}

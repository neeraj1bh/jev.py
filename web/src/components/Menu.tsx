import { CaretUpDown, Check } from "@phosphor-icons/react";
import { motion } from "motion/react";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { cn } from "../styles";
import { Icon, type IconGlyph, IconTile } from "./Icon";
import { Tip } from "./Tip";

/** The row under the pointer or keyboard; its highlight slides from one row to the next. */
const Hot = createContext<{ group: string; hot: string; setHot: (id: string) => void }>({
  group: "",
  hot: "",
  setHot: () => undefined,
});

/** Up and down move between the options that can be picked; Enter picks, as on any button. */
function moveFocus(event: KeyboardEvent<HTMLElement>, list: HTMLElement | null) {
  if (!list || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
  const options = [...list.querySelectorAll<HTMLElement>("[data-row]:not(:disabled)")];
  if (!options.length) return;
  event.preventDefault();
  const at = options.indexOf(document.activeElement as HTMLElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = at === -1 ? (step === 1 ? 0 : options.length - 1) : at + step;
  options[(next + options.length) % options.length]?.focus();
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="grid h-[18px] min-w-[18px] place-items-center rounded-[5px] border-0 bg-panel px-1 font-mono text-[10.5px] text-dim shadow-[0_1px_1px_var(--color-shadow)] ring-1 ring-rule">
      {children}
    </kbd>
  );
}

interface DropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  button: ReactNode;
  children: ReactNode;
  title?: string;
  /** Something is chosen; the trigger's icon tile fills in. */
  active?: boolean;
  compact?: boolean;
  icon?: IconGlyph;
  buttonClassName?: string;
  menuClassName?: string;
}

export function Dropdown({
  open,
  onOpenChange,
  button,
  children,
  title,
  active,
  compact,
  icon,
  buttonClassName,
  menuClassName,
}: DropdownProps) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const group = useId();
  const [hot, setHot] = useState("");

  useEffect(() => {
    if (!open) return;
    // The path is fixed when the click starts, so an item the click replaced still counts as inside.
    const onClick = (event: MouseEvent) => {
      if (root.current && !event.composedPath().includes(root.current)) onOpenChange(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    // Deferred so the click that opened the menu does not close it.
    const timer = setTimeout(() => document.addEventListener("click", onClick));
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={root} className="relative min-w-0">
      <Tip content={title}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          onKeyDown={(event) => open && moveFocus(event, list.current)}
          className={cn(
            "inline-flex max-w-full items-center gap-2 rounded-full border-0 bg-panel shadow-[0_1px_2px_var(--color-shadow)] ring-1 ring-rule transition-shadow hover:ring-dim aria-expanded:ring-dim",
            compact ? "py-1 pr-2.5 text-[13.5px]" : "py-1.5 pr-3 text-sm",
            icon ? "pl-1" : compact ? "pl-3" : "pl-3.5",
            active || !compact ? "text-ink" : "text-dim",
            buttonClassName,
          )}
        >
          {icon && <IconTile icon={icon} tone={active ? "ink" : "idle"} />}
          <span className="flex min-w-0 items-baseline gap-2 truncate">{button}</span>
          <Icon icon={CaretUpDown} size={12} className="text-dim" />
        </button>
      </Tip>
      {open && (
        <div
          className={cn(
            "absolute top-[calc(100%+6px)] left-0 z-10 flex max-h-[70vh] w-[320px] max-w-[calc(100vw-32px)] animate-pop flex-col overflow-hidden rounded-2xl bg-panel shadow-(--surface-shadow)",
            menuClassName,
          )}
        >
          <Hot.Provider value={{ group, hot, setHot }}>
            <div
              ref={list}
              role="listbox"
              tabIndex={-1}
              onKeyDown={(event) => moveFocus(event, list.current)}
              onMouseLeave={() => setHot("")}
              className="flex min-h-0 flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto p-1.5"
            >
              {children}
            </div>
          </Hot.Provider>
          <div className="flex items-center gap-1.5 border-0 border-t border-rule bg-lift/60 px-3 py-2 text-[11px] text-dim max-[600px]:hidden">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span className="mr-2">Move</span>
            <Kbd>↵</Kbd>
            <span>Pick</span>
            <span className="ml-auto flex items-center gap-1.5">
              <Kbd>esc</Kbd>
              Close
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mx-2 mt-3 mb-1 text-[10.5px] font-medium tracking-[0.08em] text-dim uppercase first:mt-1.5">
      {children}
    </h3>
  );
}

/** The tinted row highlight, shared by every row of one menu so it slides between them. */
function useHot() {
  const id = useId();
  const { group, hot, setHot } = useContext(Hot);
  const highlight = hot === id && (
    <motion.span
      aria-hidden
      layoutId={`${group}-hot`}
      transition={{ type: "spring", stiffness: 600, damping: 45 }}
      className="absolute inset-0 rounded-lg bg-lift"
    />
  );
  return { highlight, onMouseEnter: () => setHot(id), onFocus: () => setHot(id) };
}

interface MenuItemProps {
  label: ReactNode;
  detail: ReactNode;
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
  highlightDetail?: boolean;
  title?: string;
  icon?: IconGlyph;
  /** Several can be chosen: a checkbox leads the row instead of a check trailing it. */
  multi?: boolean;
}

export function MenuItem({
  label,
  detail,
  onSelect,
  selected,
  disabled,
  highlightDetail,
  title,
  icon,
  multi,
}: MenuItemProps) {
  const { highlight, ...hover } = useHot();
  return (
    <Tip content={title} side="right">
      <button
        type="button"
        role="option"
        data-row
        aria-selected={!!selected}
        disabled={disabled}
        onClick={onSelect}
        {...hover}
        className="relative flex w-full items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-[13.5px] text-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!disabled && highlight}
        {multi && (
          <span
            className={cn(
              "relative grid size-4 flex-none place-items-center rounded-[5px] ring-1 transition-colors",
              selected ? "bg-ink text-paper ring-ink" : "bg-panel ring-rule",
            )}
          >
            {selected && <Icon icon={Check} size={11} />}
          </span>
        )}
        {icon && <IconTile icon={icon} tone={selected ? "ink" : "idle"} className="relative" />}
        <span className={cn("relative min-w-0 flex-1 truncate", selected && "font-medium")}>
          {label}
        </span>
        <span
          className={cn(
            "relative text-xs whitespace-nowrap",
            highlightDetail ? "text-good" : "text-dim",
          )}
        >
          {detail}
        </span>
        {!multi && (
          <Icon
            icon={Check}
            size={12}
            className={cn("relative text-ink", selected ? "opacity-100" : "opacity-0")}
          />
        )}
      </button>
    </Tip>
  );
}

/** A plain row in a menu that acts rather than picks, e.g. "Add a model". */
export function MenuAction({
  children,
  onClick,
  expanded,
}: {
  children: ReactNode;
  onClick: () => void;
  expanded?: boolean;
}) {
  const { highlight, ...hover } = useHot();
  return (
    <button
      type="button"
      data-row
      aria-expanded={expanded}
      onClick={onClick}
      {...hover}
      className="relative flex w-full items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-[13.5px] text-dim transition-colors hover:text-ink focus-visible:outline-none"
    >
      {highlight}
      <span className="relative flex min-w-0 flex-1 items-center gap-2.5">{children}</span>
    </button>
  );
}

export function MenuHint({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <Tip content={title} side="right">
      <div className="mx-2 mt-0.5 mb-1 text-xs whitespace-nowrap text-dim">{children}</div>
    </Tip>
  );
}

import { ChevronRight, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { groupBackends, isOffline, providerName, statusText } from "../backends";
import { cn } from "../styles";
import type { Backend } from "../types";
import { CheckMark } from "./CheckMark";
import { Icon } from "./Icon";
import { Dropdown, MenuHeading, MenuHint, MenuItem } from "./Menu";
import type { MenuState } from "./ModelPicker";
import { Skeleton } from "./Skeleton";

const MAX_MODELS = 6;
const MAX_MATCHES = 40;

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
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const names = selected.map((id) => backends.find((backend) => backend.id === id)?.label ?? id);
  const gateway = useMemo(
    () => backends.filter((backend) => backend.group === "gateway"),
    [backends],
  );
  const providers = useMemo(() => {
    const byProvider = new Map<string, Backend[]>();
    for (const model of gateway) {
      const key = model.provider ?? "other";
      byProvider.set(key, [...(byProvider.get(key) ?? []), model]);
    }
    return [...byProvider.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [gateway]);

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? backends
        .filter((backend) => `${backend.label} ${backend.id}`.toLowerCase().includes(needle))
        .slice(0, MAX_MATCHES)
    : [];

  const item = (backend: Backend, inTree = false) => {
    const isSelected = selected.includes(backend.id);
    const locked =
      (isSelected && selected.length <= 2) ||
      (!isSelected && selected.length >= MAX_MODELS) ||
      isOffline(backend);
    return (
      <MenuItem
        key={backend.id}
        selected={isSelected}
        disabled={locked}
        onSelect={() => onToggle(backend.id)}
        label={
          <>
            <i className="inline-block w-[18px] text-good">{isSelected && <CheckMark ok />}</i>
            {backend.label}
          </>
        }
        detail={
          backend.group !== "gateway" || !backend.ready
            ? statusText(backend)
            : inTree
              ? ""
              : providerName(backend.provider)
        }
        highlightDetail={backend.ready && backend.group !== "gateway"}
      />
    );
  };

  const toggleProvider = (provider: string) =>
    setExpanded((current) =>
      current.includes(provider) ? current.filter((p) => p !== provider) : [...current, provider],
    );

  return (
    <Dropdown
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
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
      <label className="mx-1 mb-1 flex items-center gap-2 rounded-md border border-rule bg-paper px-2.5 py-1.5 text-dim focus-within:border-dim">
        <Icon icon={Search} size={14} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${backends.length} models`}
          aria-label="Search models"
          className="w-full border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-dim"
        />
      </label>
      <MenuHint>Compare 2 to {MAX_MODELS} · click to add or remove</MenuHint>

      {needle ? (
        matches.length ? (
          matches.map((match) => item(match))
        ) : (
          <MenuHint>No model matches “{query}”.</MenuHint>
        )
      ) : (
        <>
          {groupBackends(backends, false).map(({ group, heading, backends: members }) => (
            <Fragment key={group}>
              <MenuHeading>{heading}</MenuHeading>
              {members.map((member) => item(member))}
            </Fragment>
          ))}
          {gateway.length > 0 && (
            <>
              <MenuHeading>OpenRouter · {gateway.length} models with probabilities</MenuHeading>
              {gateway.filter((model) => selected.includes(model.id)).map((model) => item(model))}
              {providers.map(([provider, models]) => {
                const isOpen = expanded.includes(provider);
                return (
                  <Fragment key={provider}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggleProvider(provider)}
                      className="flex w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-lift"
                    >
                      <Icon
                        icon={ChevronRight}
                        size={14}
                        className={cn(
                          "text-dim transition-transform duration-150",
                          isOpen && "rotate-90",
                        )}
                      />
                      {providerName(provider)}
                      <span className="ml-auto text-xs text-dim tabular-nums">{models.length}</span>
                    </button>
                    {isOpen && (
                      <div className="ml-4 flex flex-col gap-0.5">
                        {models.map((model) => item(model, true))}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </>
          )}
        </>
      )}
    </Dropdown>
  );
}

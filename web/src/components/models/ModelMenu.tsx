import {
  CaretRight,
  CaretUp,
  DotsThree,
  Gift,
  Globe,
  ListChecks,
  MagnifyingGlass,
  Plus,
  Stop,
  Trash,
} from "@phosphor-icons/react";
import { Fragment, type ReactNode, useMemo, useState } from "react";

import { dollarText, groupBackends, providerName, runDollars } from "../../lib/backends";
import { backendIcon } from "../../lib/icons";
import { makerIcon } from "../../lib/logos";
import { cn } from "../../lib/styles";
import type { Backend } from "../../lib/types";
import { Icon, IconTile } from "../ui/Icon";
import { Kbd, MenuAction, MenuHeading, MenuHint, MenuItem } from "../ui/Menu";

const MAX_MATCHES = 40;

/** What one full run costs, which is what matters here; the tooltip carries both token prices. */
function runCost(backend: Backend) {
  const dollars = runDollars(backend);
  if (dollars === 0) return { text: "free", title: "Free on OpenRouter, rate-limited" };
  if (dollars === null) return { text: "", title: undefined };
  return {
    text: `≈ ${dollarText(dollars)} a run`,
    title: `Input $${backend.price}/M tokens · output $${backend.price_out ?? "?"}/M · a full run of Core v1 is ~2.3M input tokens`,
  };
}
const FREE = "free";

/** Lower case with punctuation dropped, so "xai", "x-ai" and "X.AI" all match. */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const TOP_PROVIDERS = 6;

export interface ModelList {
  name: string;
  count: number;
  on: boolean;
  onToggle: () => void;
}

/** What the menu offers for models on this machine: add one from the Hub, delete a download. */
export interface LocalModelActions {
  onAddModel: () => void;
  onDelete: (backend: Backend) => void;
  onStop: (backend: Backend) => void;
}

interface ModelMenuProps {
  backends: Backend[];
  isSelected: (backend: Backend) => boolean;
  isDisabled: (backend: Backend) => boolean;
  detail: (backend: Backend) => string;
  onSelect: (id: string) => void;
  /** Multi-select shows a check beside each chosen model. */
  showChecks?: boolean;
  hint?: ReactNode;
  /** Opens the dialog that adds a Hugging Face model. */
  onAddModel?: () => void;
  /** Deletes a downloaded local model's files. */
  onDelete?: (backend: Backend) => void;
  /** Stops the llama-server of a running GGUF model. */
  onStop?: (backend: Backend) => void;
  /** Frozen model lists, each picked or dropped as a whole. */
  lists?: ModelList[];
}

/** Search over every model, the direct groups, and OpenRouter's models under their makers. */
export function ModelMenu(props: ModelMenuProps) {
  const { backends, isSelected, isDisabled, detail, onSelect, showChecks, lists } = props;
  const { onAddModel, onDelete, onStop } = props;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [allProviders, setAllProviders] = useState(false);
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
    const newestFirst = (models: Backend[]) =>
      models.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    const makers = [...byProvider.entries()]
      .map(([provider, models]) => [provider, newestFirst(models)] as const)
      .sort((a, b) => b[1].length - a[1].length);
    const free = newestFirst(gateway.filter((model) => model.free));
    return free.length ? [[FREE, free] as const, ...makers] : makers;
  }, [gateway]);

  const needle = squash(query);
  const haystack = (backend: Backend) =>
    squash(
      `${backend.label} ${backend.id} ${backend.provider ?? ""} ${providerName(backend.provider)}`,
    );
  const matches = needle
    ? backends.filter((backend) => haystack(backend).includes(needle)).slice(0, MAX_MATCHES)
    : [];
  const directMatches = matches.filter((backend) => backend.group !== "gateway");
  const gatewayMatches = matches.filter((backend) => backend.group === "gateway");

  const item = (backend: Backend, inTree = false) => {
    const row = menuItem(backend, inTree);
    if (onStop && backend.running) {
      return (
        <div key={backend.id} className="grid grid-cols-[1fr_auto] items-center gap-1">
          {row}
          <button
            type="button"
            aria-label={`Stop ${backend.label}`}
            title="Stop it and free its memory"
            onClick={() => onStop(backend)}
            className="rounded-lg border-0 bg-transparent p-1.5 text-dim transition-colors hover:bg-lift hover:text-ink"
          >
            <Icon icon={Stop} size={14} />
          </button>
        </div>
      );
    }
    if (!(onDelete && backend.group === "local" && backend.ready)) return row;
    return (
      <div key={backend.id} className="grid grid-cols-[1fr_auto] items-center gap-1">
        {row}
        <button
          type="button"
          aria-label={`Delete ${backend.label} from this machine`}
          title={`Delete ${backend.label} from this machine`}
          onClick={() => onDelete(backend)}
          className="rounded-lg border-0 bg-transparent p-1.5 text-dim transition-colors hover:bg-lift hover:text-warn"
        >
          <Icon icon={Trash} size={14} />
        </button>
      </div>
    );
  };

  const menuItem = (backend: Backend, inTree: boolean) => {
    const chosen = isSelected(backend);
    const inGateway = backend.group === "gateway" && backend.ready;
    return (
      <MenuItem
        key={backend.id}
        selected={chosen}
        disabled={isDisabled(backend)}
        onSelect={() => onSelect(backend.id)}
        multi={showChecks}
        icon={backendIcon(backend)}
        label={backend.label}
        // A long name is cut short in the menu; the tooltip then shows it whole.
        title={
          inGateway ? runCost(backend).title : backend.label.length > 28 ? backend.label : undefined
        }
        detail={
          inGateway
            ? [inTree ? "" : providerName(backend.provider), runCost(backend).text]
                .filter(Boolean)
                .join(" · ")
            : detail(backend)
        }
        highlightDetail={
          backend.ready && backend.group !== "gateway" && detail(backend) !== "compare only"
        }
      />
    );
  };

  const toggleProvider = (provider: string) =>
    setExpanded((current) =>
      current.includes(provider) ? current.filter((p) => p !== provider) : [...current, provider],
    );

  return (
    <>
      <label className="-mx-1.5 -mt-1.5 mb-1 flex items-center gap-2.5 border-0 border-b border-rule px-3.5 py-2.5 text-dim">
        <Icon icon={MagnifyingGlass} size={14} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${backends.length} models`}
          aria-label="Search models"
          className="w-full border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-dim"
        />
        <Kbd>esc</Kbd>
      </label>
      {props.hint && <MenuHint>{props.hint}</MenuHint>}

      {needle ? (
        matches.length ? (
          <>
            {directMatches.length > 0 && <MenuHeading>Direct and local</MenuHeading>}
            {directMatches.map((match) => item(match))}
            {gatewayMatches.length > 0 && <MenuHeading>Through OpenRouter</MenuHeading>}
            {gatewayMatches.map((match) => item(match))}
          </>
        ) : (
          <MenuHint>No model matches “{query}”.</MenuHint>
        )
      ) : (
        <>
          {lists && lists.length > 0 && (
            <>
              <MenuHeading>Frozen lists</MenuHeading>
              {lists.map((list) => (
                <MenuItem
                  key={list.name}
                  multi
                  icon={ListChecks}
                  selected={list.on}
                  onSelect={list.onToggle}
                  label={list.name}
                  detail={`${list.count} models`}
                />
              ))}
            </>
          )}
          {groupBackends(backends).map(({ group, heading, backends: members }) => (
            <Fragment key={group}>
              <MenuHeading>{heading}</MenuHeading>
              {members.map((member) => item(member))}
              {group === "local" && onAddModel && (
                <MenuAction onClick={onAddModel}>
                  <IconTile icon={Plus} />
                  Add a model
                </MenuAction>
              )}
            </Fragment>
          ))}
          {gateway.length > 0 && (
            <>
              <MenuHeading>OpenRouter · {gateway.length} models with probabilities</MenuHeading>
              {gateway.filter(isSelected).map((model) => item(model))}
              {(allProviders ? providers : providers.slice(0, TOP_PROVIDERS)).map(
                ([provider, models]) => {
                  const isOpen = expanded.includes(provider);
                  return (
                    <Fragment key={provider}>
                      <MenuAction expanded={isOpen} onClick={() => toggleProvider(provider)}>
                        <IconTile
                          icon={provider === FREE ? Gift : (makerIcon(provider) ?? Globe)}
                        />
                        <span className="text-ink">
                          {provider === FREE ? "Free to run" : providerName(provider)}
                        </span>
                        <span className="ml-auto font-mono text-[11px] text-dim tabular-nums">
                          {models.length}
                        </span>
                        <Icon
                          icon={CaretRight}
                          size={12}
                          className={cn(
                            "text-dim transition-transform duration-150",
                            isOpen && "rotate-90",
                          )}
                        />
                      </MenuAction>
                      {isOpen && (
                        <div className="ml-3 flex flex-col gap-px border-0 border-l border-dashed border-rule pl-1.5">
                          {models.map((model) => item(model, provider !== FREE))}
                        </div>
                      )}
                    </Fragment>
                  );
                },
              )}
              {providers.length > TOP_PROVIDERS && (
                <MenuAction onClick={() => setAllProviders(!allProviders)}>
                  <IconTile icon={allProviders ? CaretUp : DotsThree} />
                  {allProviders
                    ? "Fewer makers"
                    : `${providers.length - TOP_PROVIDERS} more makers`}
                </MenuAction>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

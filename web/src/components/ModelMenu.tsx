import { ChevronRight, Search } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";

import { dollarText, groupBackends, providerName, runDollars } from "../backends";
import { cn } from "../styles";
import type { Backend } from "../types";
import { CheckMark } from "./CheckMark";
import { Icon } from "./Icon";
import { MenuHeading, MenuHint, MenuItem } from "./Menu";

const MAX_MATCHES = 40;

/** What one full run costs, which is what matters here; the tooltip carries both token prices. */
function runCost(backend: Backend) {
  const dollars = runDollars(backend);
  if (dollars === 0) return { text: "free", title: "Free on OpenRouter, rate-limited" };
  if (dollars === null) return { text: "", title: undefined };
  return {
    text: `≈ ${dollarText(dollars)} a run`,
    title: `Input $${backend.price}/M tokens · output $${backend.price_out ?? "?"}/M · a full run is ~0.75M input tokens`,
  };
}
const FREE = "free";

/** Lower case with punctuation dropped, so "xai", "x-ai" and "X.AI" all match. */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const TOP_PROVIDERS = 6;

interface ModelMenuProps {
  backends: Backend[];
  isSelected: (backend: Backend) => boolean;
  isDisabled: (backend: Backend) => boolean;
  detail: (backend: Backend) => string;
  onSelect: (id: string) => void;
  /** Multi-select shows a check beside each chosen model. */
  showChecks?: boolean;
  /** Rank models that cannot write text after the others. */
  textlessLast?: boolean;
  hint?: ReactNode;
}

/** Search over every model, the direct groups, and OpenRouter's models under their makers. */
export function ModelMenu(props: ModelMenuProps) {
  const {
    backends,
    isSelected,
    isDisabled,
    detail,
    onSelect,
    showChecks,
    textlessLast = false,
  } = props;
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
    const chosen = isSelected(backend);
    const inGateway = backend.group === "gateway" && backend.ready;
    return (
      <MenuItem
        key={backend.id}
        selected={chosen}
        disabled={isDisabled(backend)}
        onSelect={() => onSelect(backend.id)}
        label={
          showChecks ? (
            <>
              <i className="inline-block w-[18px] text-good">{chosen && <CheckMark ok />}</i>
              {backend.label}
            </>
          ) : (
            backend.label
          )
        }
        title={inGateway ? runCost(backend).title : undefined}
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
          {groupBackends(backends, textlessLast).map(({ group, heading, backends: members }) => (
            <Fragment key={group}>
              <MenuHeading>{heading}</MenuHeading>
              {members.map((member) => item(member))}
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
                        {provider === FREE ? "Free to run" : providerName(provider)}
                        <span className="ml-auto text-xs text-dim tabular-nums">
                          {models.length}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="ml-4 flex flex-col gap-0.5">
                          {models.map((model) => item(model, provider !== FREE))}
                        </div>
                      )}
                    </Fragment>
                  );
                },
              )}
              {providers.length > TOP_PROVIDERS && (
                <button
                  type="button"
                  onClick={() => setAllProviders(!allProviders)}
                  className="w-full rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] text-dim transition-colors hover:bg-lift hover:text-ink"
                >
                  {allProviders
                    ? "Fewer makers"
                    : `${providers.length - TOP_PROVIDERS} more makers`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

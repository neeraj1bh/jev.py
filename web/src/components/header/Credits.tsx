const CREDITS = ["neerxjbhatt", "essdecay"];

export function Credits() {
  return (
    <footer className="mt-14 flex items-center justify-center gap-2 text-[13px] text-dim">
      by
      {CREDITS.map((handle, index) => [
        index > 0 && "and",
        <a
          key={handle}
          href={`https://x.com/${handle}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-rule px-2.5 py-0.5 text-dim no-underline transition-colors hover:border-dim hover:text-ink"
        >
          @{handle}
        </a>,
      ])}
    </footer>
  );
}

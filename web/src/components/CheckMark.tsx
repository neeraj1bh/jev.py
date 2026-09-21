export function CheckMark({ ok }: { ok: boolean }) {
  return (
    <svg
      className="inline size-[0.85em] fill-none stroke-current stroke-2 align-[-0.08em] [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 16 16"
      aria-label={ok ? "right" : "wrong"}
    >
      <path d={ok ? "M3.5 8.5l3 3 6-7" : "M4.5 4.5l7 7M11.5 4.5l-7 7"} />
    </svg>
  );
}

import { useEffect, useState } from "react";

import { fetchProgress } from "../api";

export type Progress = Record<string, { done: number; total: number; unit: string }>;

const IDLE_MS = 2000;
const ACTIVE_MS = 500;

/** Everything the server is downloading, polled from the server itself, so a download started
 * before a reload, or in another tab, still shows. */
export function useDownloads() {
  const [progress, setProgress] = useState<Progress>({});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = false;
    const poll = async () => {
      const next = await fetchProgress().catch(() => ({}) as Progress);
      active = Object.keys(next).length > 0;
      setProgress(next);
      timer = setTimeout(poll, active ? ACTIVE_MS : IDLE_MS);
    };
    poll();
    return () => clearTimeout(timer);
  }, []);
  return progress;
}

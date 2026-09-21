import type { Backend, Dataset } from "./types";

/** Jev returns probabilities only; it never writes text. */
export const TEXTLESS = new Set(["remote:typesafe", "remote:vercel"]);

export const isOffline = (backend: Backend) => !backend.ready && backend.group === "server";

export const isUsable = (backend?: Backend) =>
  !!backend && !isOffline(backend) && (backend.ready || backend.group === "local");

export const isHosted = (backend?: Backend) => backend?.group === "hosted";

export function statusText(backend: Backend) {
  if (backend.group === "local") {
    const size = backend.gb ? ` ${backend.gb} GB` : "";
    return backend.ready ? `${backend.gb ? `${backend.gb} GB · ` : ""}on disk` : `download${size}`;
  }
  if (backend.group === "server") return backend.ready ? "running" : "not running";
  return backend.ready ? "key set" : "add key";
}

export function pickerSubtitle(backend?: Backend) {
  if (!backend) return "";
  if (backend.group === "local") {
    return `${backend.device}${backend.gb ? ` · ${backend.gb} GB` : ""}${backend.ready ? "" : " · download"}`;
  }
  return backend.group === "server" ? (backend.ready ? "running" : "not running") : "hosted";
}

export function location(backend?: Backend) {
  if (!backend) return "";
  if (backend.group === "server") return `llama.cpp at ${backend.url}`;
  if (backend.group === "hosted") return `Key from ${backend.key}`;
  const need =
    backend.need_gb && backend.have_gb
      ? `. Needs about ${backend.need_gb} GB; this machine has ${backend.have_gb} GB.`
      : "";
  return `${backend.ready ? "On disk" : "Downloads to"} ${backend.path}${need}`;
}

/** A set with more options than a letter-reading backend can take (26) cannot run there. */
export const blockingBackend = (dataset: Dataset, backends: (Backend | undefined)[]) =>
  backends.find((backend) => backend?.max && dataset.options && dataset.options > backend.max);

export const panelSubtitle = (name?: string) =>
  name?.endsWith("· text")
    ? "written answers, each counted as certain"
    : "one request, a probability for every option";

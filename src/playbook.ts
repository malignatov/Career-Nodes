import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { Playbook } from "./types.js";

export function loadPlaybook(path: string): Playbook {
  const raw = yaml.load(readFileSync(path, "utf8")) as Playbook;
  for (const field of ["id", "version", "kind", "title", "purpose"] as const) {
    if (!raw[field]) throw new Error(`Playbook ${path} is missing required field: ${field}`);
  }
  raw.consumes ??= [];
  raw.invalidates ??= [];
  return raw;
}

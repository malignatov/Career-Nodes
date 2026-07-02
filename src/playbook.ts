import { readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import type { Playbook } from "./types.ts";

export function loadPlaybook(path: string): Playbook {
  const raw = parseYaml(readFileSync(path, "utf8")) as Playbook;
  for (const field of ["id", "version", "kind", "title", "purpose"] as const) {
    if (!raw[field]) throw new Error(`Playbook ${path} is missing required field: ${field}`);
  }
  raw.consumes ??= [];
  raw.invalidates ??= [];
  return raw;
}

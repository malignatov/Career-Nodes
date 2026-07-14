import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { Storage } from "./storage.ts";

export class NodeStorage implements Storage {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  private full(path: string): string {
    return join(this.root, path);
  }

  async read(path: string): Promise<string | null> {
    try {
      return await fs.readFile(this.full(path), "utf8");
    } catch {
      return null;
    }
  }

  async write(path: string, data: string): Promise<void> {
    const target = this.full(path);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async remove(path: string): Promise<void> {
    await fs.rm(this.full(path), { force: true });
  }

  async list(path: string): Promise<string[]> {
    try {
      return await fs.readdir(this.full(path));
    } catch {
      return [];
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.full(path));
      return true;
    } catch {
      return false;
    }
  }
}

/** The default artifacts root, same env override as before. */
export function defaultStorage(): NodeStorage {
  return new NodeStorage(process.env.CC_ARTIFACTS_DIR ?? "artifacts");
}

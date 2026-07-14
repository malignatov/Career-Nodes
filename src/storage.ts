/**
 * The storage seam: everything the engine persists goes through this
 * interface, so the same core runs on Node (fs), in a Capacitor WebView
 * (native filesystem), or in a plain browser (IndexedDB). Paths are
 * relative, forward-slash names like "profiles/anna/motto.json".
 */
export interface Storage {
  /** File contents, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  /** Deleting a missing file is not an error. */
  remove(path: string): Promise<void>;
  /** Names of entries directly under a directory ("" = root); [] when missing. */
  list(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

/** A view of `base` rooted at `prefix` — how one profile's journey is scoped. */
export function scoped(base: Storage, prefix: string): Storage {
  if (!prefix) return base;
  const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return {
    read: (path) => base.read(p + path),
    write: (path, data) => base.write(p + path, data),
    remove: (path) => base.remove(p + path),
    list: (path) => base.list(path ? p + path : p.slice(0, -1)),
    exists: (path) => base.exists(p + path),
  };
}

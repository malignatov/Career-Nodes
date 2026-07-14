/**
 * Config seam: env vars on Node, an injected CC_CONFIG object everywhere else
 * (the mobile shell fills it from on-device settings). Core code never touches
 * process.env directly.
 */
export function cfg(key: string): string | undefined {
  const g = globalThis as { CC_CONFIG?: Record<string, string | undefined> };
  if (g.CC_CONFIG && key in g.CC_CONFIG) return g.CC_CONFIG[key];
  return typeof process !== "undefined" ? process.env?.[key] : undefined;
}

import { isAbsolute, join, resolve } from "node:path";

export function expandPath(value: string, homeDir: string, cwd: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return join(homeDir, value.slice(2));
  return isAbsolute(value) ? value : resolve(cwd, value);
}

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export const HOSTS_BEGIN_MARKER = "# ppfw begin";
export const HOSTS_END_MARKER = "# ppfw end";
const LOOPBACK = "127.0.0.1";

export interface HostsFileSystem {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
}

const nodeHostsFileSystem: HostsFileSystem = {
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: atomicWrite,
};

/** Replace ppfw's block while leaving every line outside it untouched. */
export function reconcileHostsText(
  existing: string,
  aliases: Iterable<string>,
): string {
  const lineEnding = existing.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = /\r?\n$/.test(existing);
  const lines = existing.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  const block = hostsBlockLines(aliases);
  const ranges = managedRanges(lines);
  if (ranges.length === 0 && block.length === 0) {
    return existing;
  }

  let resultLines: string[];
  if (ranges.length === 0) {
    resultLines = [...lines];
    if (resultLines.length === 1 && resultLines[0] === "") resultLines = [];
    resultLines.push(...block);
  } else {
    resultLines = [];
    let cursor = 0;
    for (const [index, range] of ranges.entries()) {
      resultLines.push(...lines.slice(cursor, range.begin));
      if (index === 0) resultLines.push(...block);
      cursor = range.end + 1;
    }
    resultLines.push(...lines.slice(cursor));
  }

  const result = resultLines.join(lineEnding);
  return result + (hadTrailingNewline || block.length > 0 ? lineEnding : "");
}

export function removeHostsText(existing: string): string {
  return reconcileHostsText(existing, []);
}

export function reconcileHosts(
  path: string,
  aliases: Iterable<string>,
  fileSystem: HostsFileSystem = nodeHostsFileSystem,
): void {
  const existing = fileSystem.exists(path) ? fileSystem.readFile(path) : "";
  const next = reconcileHostsText(existing, aliases);
  if (next !== existing) fileSystem.writeFile(path, next);
}

export function removeHosts(
  path: string,
  fileSystem: HostsFileSystem = nodeHostsFileSystem,
): void {
  reconcileHosts(path, [], fileSystem);
}

function managedRanges(lines: string[]): { begin: number; end: number }[] {
  const ranges: { begin: number; end: number }[] = [];
  let begin = -1;
  for (const [index, line] of lines.entries()) {
    const marker = line.trim();
    if (marker === HOSTS_BEGIN_MARKER) {
      if (begin !== -1) throw new Error("malformed ppfw hosts block");
      begin = index;
    } else if (marker === HOSTS_END_MARKER) {
      if (begin === -1) throw new Error("malformed ppfw hosts block");
      ranges.push({ begin, end: index });
      begin = -1;
    }
  }
  if (begin !== -1) throw new Error("malformed ppfw hosts block");
  return ranges;
}

function hostsBlockLines(aliases: Iterable<string>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawAlias of aliases) {
    const alias = rawAlias.trim();
    if (!isHostname(alias) || alias !== rawAlias) {
      throw new Error(`invalid alias host: ${rawAlias}`);
    }
    if (seen.has(alias)) continue;
    seen.add(alias);
    normalized.push(alias);
  }
  if (normalized.length === 0) return [];
  const lines = [HOSTS_BEGIN_MARKER];
  for (const alias of normalized) lines.push(`${LOOPBACK} ${alias}`);
  lines.push(HOSTS_END_MARKER);
  return lines;
}

function isHostname(host: string): boolean {
  const labels = host.split(".");
  return (
    host.length <= 253 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
    )
  );
}

function atomicWrite(path: string, text: string): void {
  const temporaryPath = `${path}.ppfw-${process.pid}-${randomUUID()}`;
  const mode = existsSync(path) ? statSync(path).mode & 0o7777 : 0o644;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", mode);
    writeFileSync(descriptor, text, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    chmodSync(temporaryPath, mode);
    renameSync(temporaryPath, path);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

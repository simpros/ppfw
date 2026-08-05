import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { ConfigError } from "../src/errors.ts";
import { discoverApps } from "../src/discover.ts";
import type { FileEntry, FileSystem } from "../src/filesystem.ts";

let ws: string;

async function app(dir: string, yaml: string): Promise<void> {
  await mkdir(join(ws, dir), { recursive: true });
  await writeFile(join(ws, dir, ".ppfw.config"), yaml, "utf8");
}

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "ppfw-ws-"));
});

const suffix = { aliasSuffix: "local" };

function memoryFileSystem(files: Record<string, string>): FileSystem {
  const paths = Object.keys(files);
  const directories = new Set<string>(["/ws"]);
  for (const file of paths) {
    let dir = file.slice(0, file.lastIndexOf("/"));
    while (dir !== "") {
      directories.add(dir);
      const parent = dir.slice(0, dir.lastIndexOf("/"));
      if (parent === dir) break;
      dir = parent;
    }
  }
  return {
    exists: (path) => directories.has(path) || path in files,
    isDirectory: (path) => directories.has(path),
    readDirectory: (path) => {
      const names = new Set<string>();
      for (const child of [...directories, ...paths]) {
        if (!child.startsWith(`${path}/`)) continue;
        const rest = child.slice(path.length + 1);
        if (!rest.includes("/")) names.add(rest);
      }
      return [...names].map((name): FileEntry => ({
        name,
        isFile: () => !directories.has(`${path}/${name}`),
        isDirectory: () => directories.has(`${path}/${name}`),
      }));
    },
    readFile: (path) => files[path]!,
  };
}

describe("discoverApps", () => {
  test("finds every .ppfw.config in the workspace", async () => {
    await app("kido", "ports:\n  api: 3232\n");
    await app("backend", "ports:\n  worker: 8080\n");
    const apps = discoverApps(ws, suffix);
    expect(apps.map((a) => a.name)).toEqual(["backend", "kido"]);
    expect(apps[0]!.dir).toBe(join(ws, "backend"));
    expect(apps[0]!.ports[0]!.alias).toBe("worker.backend.local");
  });

  test("empty workspace yields no apps", async () => {
    expect(discoverApps(ws, suffix)).toEqual([]);
  });

  test("uses the supplied filesystem interface", () => {
    const fileSystem = memoryFileSystem({
      "/ws/kido/.ppfw.config": "ports:\n  web: 3000\n",
    });
    const apps = discoverApps("/ws", { ...suffix, fileSystem });
    expect(apps.map((app) => app.name)).toEqual(["kido"]);
    expect(apps[0]!.ports[0]!.alias).toBe("web.kido.local");
  });

  test("workspace root can itself be an app", async () => {
    await app(".", "ports:\n  web: 80\n");
    const apps = discoverApps(ws, suffix);
    expect(apps.map((a) => a.name)).toEqual([basename(ws)]);
  });

  test("skips hidden directories and node_modules", async () => {
    await app(".git/sub", "ports:\n  a: 1\n");
    await app("node_modules/pkg", "ports:\n  a: 1\n");
    await app("kido", "ports:\n  a: 1\n");
    const apps = discoverApps(ws, suffix);
    expect(apps.map((a) => a.name)).toEqual(["kido"]);
  });

  test("depth-bounded: default reaches three levels down", async () => {
    await app("a/b/c", "ports:\n  deep: 1\n");
    await app("a/b/c/d", "ports:\n  deeper: 2\n");
    const apps = discoverApps(ws, suffix);
    expect(apps.map((a) => a.name)).toEqual(["c"]);
  });

  test("depth-bounded: maxDepth 1 only sees top-level apps", async () => {
    await app("top", "ports:\n  a: 1\n");
    await app("nested/app", "ports:\n  b: 2\n");
    const apps = discoverApps(ws, { ...suffix, maxDepth: 1 });
    expect(apps.map((a) => a.name)).toEqual(["top"]);
  });

  test("apps sort by name regardless of directory order", async () => {
    await app("zzz", "name: alpha\nports:\n  a: 1\n");
    await app("aaa", "name: zulu\nports:\n  b: 2\n");
    const apps = discoverApps(ws, suffix);
    expect(apps.map((a) => a.name)).toEqual(["alpha", "zulu"]);
  });

  test("invalid app config fails fast", async () => {
    await app("broken", "ports: {}\n");
    await app("fine", "ports:\n  a: 1\n");
    expect(() => discoverApps(ws, suffix)).toThrow(ConfigError);
    expect(() => discoverApps(ws, suffix)).toThrow(/broken/);
  });

  test("missing workspace fails fast", () => {
    expect(() => discoverApps(join(ws, "nope"), suffix)).toThrow(ConfigError);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forwardKey, ForwardEngine, type SpawnedChild } from "../src/forward.ts";
import { RootProxy, routesForApps } from "../src/proxy.ts";
import { createRuntime, type RuntimeEngine, type RuntimeProxy } from "../src/runtime.ts";
import { Workspace } from "../src/workspace.ts";

let ws: string;

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "ppfw-ws-"));
});

async function app(dir: string, yaml: string): Promise<void> {
  await mkdir(join(ws, dir), { recursive: true });
  await writeFile(join(ws, dir, ".ppfw.config"), yaml, "utf8");
}

class FakeChild implements SpawnedChild {
  killSignal: string | null = null;
  stdinClosed = false;
  private resolveExit!: (code: number) => void;
  readonly exited = new Promise<number>((resolve) => {
    this.resolveExit = resolve;
  });

  kill(signal?: string): void {
    this.killSignal = signal ?? "SIGTERM";
    this.exit(0);
  }

  closeStdin(): void {
    this.stdinClosed = true;
    this.exit(0);
  }

  stderrText = async (): Promise<string> => "";

  exit(code: number): void {
    this.resolveExit(code);
  }
}

class FakeSpawn {
  calls: string[][] = [];
  children: FakeChild[] = [];
  private livePorts = new Set<number>();
  private liveProxy = 0;

  forForwards = (argv: string[]): SpawnedChild => {
    this.calls.push(argv);
    const child = new FakeChild();
    this.children.push(child);
    const port = Number(argv.find((arg) => arg.includes(":localhost:"))!.split(":")[0]);
    this.livePorts.add(port);
    child.exited.then(() => {
      this.livePorts.delete(port);
    });
    return child;
  };

  forProxy = (argv: string[]): SpawnedChild => {
    this.calls.push(argv);
    const child = new FakeChild();
    this.children.push(child);
    this.liveProxy += 1;
    child.exited.then(() => {
      this.liveProxy -= 1;
    });
    return child;
  };

  forwardProbe = (port: number): Promise<boolean> =>
    Promise.resolve(this.livePorts.has(port));

  proxyProbe = (): Promise<boolean> => Promise.resolve(this.liveProxy > 0);
}

const SCRIPT = "/ppfw/src/root-proxy.ts";

async function makeRuntime() {
  const spawn = new FakeSpawn();
  const sshConfigPath = join(await mkdtemp(join(tmpdir(), "ppfw-ssh-")), "config");
  await writeFile(sshConfigPath, "Host devbox\n", "utf8");
  const workspace = new Workspace({
    workspaceRoot: ws,
    aliasSuffix: "local",
    defaultRemote: "devbox",
    sshConfigPath,
  });
  await app("kido", "ports:\n  frontend: 5173\n");
  const apps = workspace.scan();
  const engine = new ForwardEngine({
    apps,
    defaultRemote: "devbox",
    spawn: spawn.forForwards,
    probe: spawn.forwardProbe,
    pollIntervalMs: 1,
    startupTimeoutMs: 50,
  });
  const proxy = new RootProxy({
    routes: routesForApps(apps),
    port: 80,
    scriptPath: SCRIPT,
    spawn: spawn.forProxy,
    escalate: () => Promise.resolve(0),
    probe: spawn.proxyProbe,
    pollIntervalMs: 1,
    startupTimeoutMs: 50,
  });
  const runtime = createRuntime({ engine, proxy, workspace, apps });
  return { runtime, spawn };
}

describe("createRuntime", () => {
  test("exposes the initial apps", async () => {
    const { runtime } = await makeRuntime();
    expect(runtime.apps().map((a) => a.name)).toEqual(["kido"]);
    expect(runtime.rescanError()).toBeNull();
  });

  test("delegates the per-forward and bulk actions to the engine", async () => {
    const { runtime, spawn } = await makeRuntime();
    await runtime.startForward("/ws-not-used", "nope");
    expect(spawn.calls).toEqual([]);

    const dir = runtime.apps()[0]!.dir;
    await runtime.startForward(dir, "frontend");
    expect(runtime.statuses().get(forwardKey(dir, "frontend"))?.phase).toBe("up");

    await runtime.restartForward(dir, "frontend");
    expect(spawn.calls.length).toBe(2);
    expect(runtime.statuses().get(forwardKey(dir, "frontend"))?.phase).toBe("up");

    await runtime.stopApp(dir);
    expect(runtime.statuses().get(forwardKey(dir, "frontend"))?.phase).toBe("stopped");

    await runtime.startApp(dir);
    expect(runtime.statuses().get(forwardKey(dir, "frontend"))?.phase).toBe("up");

    await runtime.stopAll();
    expect(runtime.statuses().get(forwardKey(dir, "frontend"))?.phase).toBe("stopped");

    await runtime.startAll();
    expect(runtime.statuses().get(forwardKey(dir, "frontend"))?.phase).toBe("up");
  });

  test("rescan picks up new apps, forwards, and proxy routes", async () => {
    const { runtime, spawn } = await makeRuntime();
    await runtime.start();
    expect(runtime.proxyStatus().phase).toBe("up");
    const proxyStarts = spawn.calls.filter((call) => call.includes("--routes")).length;
    expect(proxyStarts).toBe(1);

    await app("backend", "ports:\n  worker: 8080\n");
    await runtime.rescan();

    expect(runtime.rescanError()).toBeNull();
    expect(runtime.apps().map((a) => a.name)).toEqual(["backend", "kido"]);
    const dir = join(ws, "backend");
    expect(runtime.statuses().get(forwardKey(dir, "worker"))?.phase).toBe("stopped");
    await runtime.startForward(dir, "worker");
    expect(runtime.statuses().get(forwardKey(dir, "worker"))?.phase).toBe("up");

    expect(spawn.calls.filter((call) => call.includes("--routes")).length).toBe(proxyStarts + 1);
    const lastProxyArgv = spawn.calls.filter((call) => call.includes("--routes")).at(-1)!;
    expect(lastProxyArgv[lastProxyArgv.indexOf("--routes") + 1]).toBe(
      '{"worker.backend.local":8080,"frontend.kido.local":5173}',
    );
  });

  test("rescan keeps the current state and records a config error", async () => {
    const { runtime, spawn } = await makeRuntime();
    await runtime.start();
    const dir = runtime.apps()[0]!.dir;
    await runtime.startForward(dir, "frontend");
    const callsBefore = spawn.calls.length;

    await app("broken", "ports: {}\n");
    await runtime.rescan();

    expect(runtime.rescanError()).toContain("broken");
    expect(runtime.apps().map((a) => a.name)).toEqual(["kido"]);
    expect(runtime.statuses().get(forwardKey(dir, "frontend"))?.phase).toBe("up");
    expect(spawn.calls.length).toBe(callsBefore);
  });

  test("rescan keeps the current state on an unresolved remote", async () => {
    const { runtime } = await makeRuntime();
    await app("needy", "remote: ghost\nports:\n  svc: 9000\n");
    await runtime.rescan();
    expect(runtime.rescanError()).toContain("ghost");
    expect(runtime.apps().map((a) => a.name)).toEqual(["kido"]);
  });

  test("a later healthy rescan clears the rescan error", async () => {
    const { runtime } = await makeRuntime();
    await app("broken", "ports: {}\n");
    await runtime.rescan();
    expect(runtime.rescanError()).not.toBeNull();

    await app("broken", "ports:\n  svc: 9000\n");
    await runtime.rescan();
    expect(runtime.rescanError()).toBeNull();
    expect(runtime.apps().map((a) => a.name)).toEqual(["broken", "kido"]);
  });

  test("rescan emits a change so the TUI re-renders", async () => {
    const { runtime } = await makeRuntime();
    let changes = 0;
    const unsubscribe = runtime.onChange(() => {
      changes += 1;
    });
    await app("backend", "ports:\n  worker: 8080\n");
    await runtime.rescan();
    unsubscribe();
    expect(changes).toBeGreaterThan(0);
  });

  test("stop tears down forwards and the proxy", async () => {
    const { runtime, spawn } = await makeRuntime();
    await runtime.start();
    const dir = runtime.apps()[0]!.dir;
    await runtime.startForward(dir, "frontend");
    expect(runtime.proxyStatus().phase).toBe("up");

    await runtime.stop();
    expect(runtime.statuses().get(forwardKey(dir, "frontend"))?.phase).toBe("stopped");
    expect(runtime.proxyStatus().phase).toBe("down");
    expect(spawn.children.some((child) => child.killSignal === null && !child.stdinClosed)).toBe(
      false,
    );
  });
});

function fakeEngine(events: string[]): RuntimeEngine {
  return {
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    startApp: async () => {},
    stopApp: async () => {},
    startAll: async () => {},
    stopAll: async () => {
      events.push("forwards");
    },
    setApps: async () => {},
    statuses: () => new Map(),
    onChange: () => () => {},
  };
}

function fakeProxy(events: string[]): RuntimeProxy {
  return {
    start: async () => {},
    stop: async () => {
      events.push("proxy");
    },
    setRoutes: async () => {},
    status: () => ({ phase: "down", lastError: null }),
    onChange: () => () => {},
  };
}

describe("createRuntime teardown", () => {
  test("stops forwards before the root proxy", async () => {
    const events: string[] = [];
    const runtime = createRuntime({
      engine: fakeEngine(events),
      proxy: fakeProxy(events),
      workspace: new Workspace({ workspaceRoot: ws, aliasSuffix: "local", defaultRemote: null }),
      apps: [],
    });

    await runtime.stop();

    expect(events).toEqual(["forwards", "proxy"]);
  });
});

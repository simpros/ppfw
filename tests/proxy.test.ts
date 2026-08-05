import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/app.ts";
import type { SpawnedChild } from "../src/forward.ts";
import {
  buildRootProxyArgs,
  proxyRoutesJson,
  RootProxy,
  routesForApps,
  type ProxyRoute,
} from "../src/proxy.ts";

const kido: AppConfig = {
  name: "kido",
  dir: "/ws/kido",
  remote: "devbox-a",
  ports: [
    { name: "frontend", port: 5173, forward: true, alias: "frontend.kido.local" },
    { name: "db", port: 5432, forward: true, alias: null },
    { name: "localui", port: 9000, forward: false, alias: "localui.kido.local" },
  ],
};

class FakeChild implements SpawnedChild {
  killSignal: string | null = null;
  private resolveExit!: (code: number) => void;
  readonly exited = new Promise<number>((resolve) => {
    this.resolveExit = resolve;
  });

  kill(signal?: string): void {
    this.killSignal = signal ?? "SIGTERM";
  }

  exit(code: number): void {
    this.resolveExit(code);
  }
}

class FakeSpawn {
  calls: string[][] = [];
  children: FakeChild[] = [];
  error: Error | null = null;

  fn = (argv: string[]): SpawnedChild => {
    if (this.error) throw this.error;
    this.calls.push(argv);
    const child = new FakeChild();
    this.children.push(child);
    return child;
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const SCRIPT = "/ppfw/src/root-proxy.ts";

function makeProxy(overrides: {
  routes?: ProxyRoute[];
  port?: number;
  spawn?: FakeSpawn;
  probeOpen?: boolean;
}) {
  const spawn = overrides.spawn ?? new FakeSpawn();
  const proxy = new RootProxy({
    routes: overrides.routes ?? [
      { host: "frontend.kido.local", port: 5173 },
      { host: "localui.kido.local", port: 9000 },
    ],
    port: overrides.port ?? 80,
    scriptPath: SCRIPT,
    spawn: spawn.fn,
    probe: () => Promise.resolve(overrides.probeOpen ?? true),
    pollIntervalMs: 1,
    startupTimeoutMs: 20,
  });
  return { proxy, spawn };
}

describe("proxyRoutesJson", () => {
  test("serializes routes as a host-to-port mapping", () => {
    expect(
      proxyRoutesJson([
        { host: "frontend.kido.local", port: 5173 },
        { host: "localui.kido.local", port: 9000 },
      ]),
    ).toBe('{"frontend.kido.local":5173,"localui.kido.local":9000}');
  });
});

describe("buildRootProxyArgs", () => {
  test("builds an escalated root-proxy command with routes and port", () => {
    expect(
      buildRootProxyArgs(SCRIPT, 80, [{ host: "frontend.kido.local", port: 5173 }], "/opt/homebrew/bin/bun"),
    ).toEqual([
      "sudo",
      "--",
      "/opt/homebrew/bin/bun",
      SCRIPT,
      "--routes",
      '{"frontend.kido.local":5173}',
      "--port",
      "80",
    ]);
  });
});

describe("routesForApps", () => {
  test("collects one route per aliased port", () => {
    expect(routesForApps([kido])).toEqual([
      { host: "frontend.kido.local", port: 5173 },
      { host: "localui.kido.local", port: 9000 },
    ]);
  });

  test("skips ports without an alias", () => {
    expect(routesForApps([kido])).not.toContainEqual({ host: "db.kido.local", port: 5432 });
  });

  test("empty apps yield no routes", () => {
    expect(routesForApps([])).toEqual([]);
  });
});

describe("RootProxy", () => {
  test("starts down", () => {
    const { proxy } = makeProxy({});
    expect(proxy.status()).toEqual({ phase: "down" });
  });

  test("start spawns the root proxy with the routes", async () => {
    const { proxy, spawn } = makeProxy({});
    await proxy.start();
    expect(spawn.calls).toEqual([
      buildRootProxyArgs(SCRIPT, 80, [
        { host: "frontend.kido.local", port: 5173 },
        { host: "localui.kido.local", port: 9000 },
      ]),
    ]);
  });

  test("start transitions to up once port 80 opens", async () => {
    const { proxy } = makeProxy({ probeOpen: true });
    await proxy.start();
    expect(proxy.status()).toEqual({ phase: "up" });
  });

  test("start is a no-op while starting or up", async () => {
    const { proxy, spawn } = makeProxy({});
    const first = proxy.start();
    const second = proxy.start();
    await Promise.all([first, second]);
    await proxy.start();
    expect(spawn.calls.length).toBe(1);
    expect(proxy.status()).toEqual({ phase: "up" });
  });

  test("stop kills the child and returns the proxy to down", async () => {
    const { proxy, spawn } = makeProxy({});
    await proxy.start();
    expect(proxy.status()).toEqual({ phase: "up" });

    const child = spawn.children[0]!;
    const stopped = proxy.stop();
    expect(child.killSignal).toBe("SIGTERM");
    child.exit(0);
    await stopped;
    expect(proxy.status()).toEqual({ phase: "down" });
  });

  test("unexpected child exit while up returns the proxy to down", async () => {
    const { proxy, spawn } = makeProxy({});
    await proxy.start();
    expect(proxy.status()).toEqual({ phase: "up" });
    spawn.children[0]!.exit(1);
    await tick();
    expect(proxy.status()).toEqual({ phase: "down" });
  });

  test("child exit while starting returns the proxy to down", async () => {
    const spawn = new FakeSpawn();
    const { proxy } = makeProxy({ spawn, probeOpen: false });
    const started = proxy.start();
    await tick();
    expect(proxy.status()).toEqual({ phase: "starting" });
    spawn.children[0]!.exit(255);
    await started;
    expect(proxy.status()).toEqual({ phase: "down" });
  });

  test("a spawn failure leaves the proxy down", async () => {
    const spawn = new FakeSpawn();
    spawn.error = new Error("spawn sudo ENOENT");
    const { proxy } = makeProxy({ spawn });
    await proxy.start();
    expect(proxy.status()).toEqual({ phase: "down" });
  });

  test("start kills the child when the port never opens before the deadline", async () => {
    const spawn = new FakeSpawn();
    const { proxy } = makeProxy({ spawn, probeOpen: false });
    await proxy.start();
    expect(proxy.status()).toEqual({ phase: "down" });
    expect(spawn.children[0]!.killSignal).toBe("SIGTERM");
  });

  test("stop on a never-started proxy is a no-op", async () => {
    const { proxy } = makeProxy({});
    await proxy.stop();
    expect(proxy.status()).toEqual({ phase: "down" });
  });

  test("emits a change event on every phase transition", async () => {
    const { proxy } = makeProxy({});
    const seen: string[] = [];
    proxy.onChange(() => seen.push(proxy.status().phase));
    await proxy.start();
    expect(seen).toEqual(["starting", "up"]);
  });
});

import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/app.ts";
import {
  buildSshArgs,
  ForwardEngine,
  forwardKey,
  type SpawnedChild,
} from "../src/forward.ts";

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

const backend: AppConfig = {
  name: "backend",
  dir: "/ws/backend",
  remote: null,
  ports: [{ name: "worker", port: 8080, forward: true, alias: "worker.backend.local" }],
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

function makeEngine(overrides: {
  apps?: AppConfig[];
  defaultRemote?: string | null;
  spawn?: FakeSpawn;
  probeOpen?: boolean;
}) {
  const spawn = overrides.spawn ?? new FakeSpawn();
  const engine = new ForwardEngine({
    apps: overrides.apps ?? [kido, backend],
    defaultRemote:
      "defaultRemote" in overrides ? (overrides.defaultRemote ?? null) : "devbox",
    spawn: spawn.fn,
    probe: () => Promise.resolve(overrides.probeOpen ?? true),
    pollIntervalMs: 1,
    startupTimeoutMs: 20,
  });
  return { engine, spawn };
}

const frontend = forwardKey("/ws/kido", "frontend");

describe("buildSshArgs", () => {
  test("builds a local-forward command for the named port and remote", () => {
    expect(buildSshArgs(5173, "devbox-a")).toEqual([
      "-N",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      "-o", "ConnectTimeout=10",
      "-L", "5173:localhost:5173",
      "devbox-a",
    ]);
  });
});

describe("ForwardEngine", () => {
  test("all forwards start stopped", () => {
    const { engine } = makeEngine({});
    expect(engine.status(frontend)?.phase).toBe("stopped");
    expect(engine.status(forwardKey("/ws/backend", "worker"))?.phase).toBe("stopped");
  });

  test("standalone aliases are not tracked as forwards", () => {
    const { engine } = makeEngine({});
    expect(engine.status(forwardKey("/ws/kido", "localui"))).toBeNull();
  });

  test("start spawns ssh with the forward argv for the app's remote", async () => {
    const { engine, spawn } = makeEngine({});
    await engine.start("/ws/kido", "frontend");
    expect(spawn.calls).toEqual([
      ["ssh", ...buildSshArgs(5173, "devbox-a")],
    ]);
  });

  test("start uses the default remote when the app has no override", async () => {
    const { engine, spawn } = makeEngine({});
    await engine.start("/ws/backend", "worker");
    expect(spawn.calls).toEqual([["ssh", ...buildSshArgs(8080, "devbox")]]);
  });

  test("start is a no-op when no remote resolves", async () => {
    const { engine, spawn } = makeEngine({ defaultRemote: null });
    await engine.start("/ws/backend", "worker");
    expect(spawn.calls).toEqual([]);
    expect(engine.status(forwardKey("/ws/backend", "worker"))?.phase).toBe("stopped");
  });

  test("starting transitions to up once the local port opens", async () => {
    const { engine } = makeEngine({ probeOpen: true });
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("up");
  });

  test("start is idempotent while starting or up", async () => {
    const { engine, spawn } = makeEngine({});
    const first = engine.start("/ws/kido", "frontend");
    const second = engine.start("/ws/kido", "frontend");
    await Promise.all([first, second]);
    await engine.start("/ws/kido", "frontend");
    expect(spawn.calls.length).toBe(1);
    expect(engine.status(frontend)?.phase).toBe("up");
  });

  test("stop kills the ssh child and returns the forward to stopped", async () => {
    const { engine, spawn } = makeEngine({});
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("up");

    const child = spawn.children[0]!;
    const stopped = engine.stop("/ws/kido", "frontend");
    expect(child.killSignal).toBe("SIGTERM");
    child.exit(0);
    await stopped;
    expect(engine.status(frontend)?.phase).toBe("stopped");
  });

  test("stop resolves only after the child has exited", async () => {
    const { engine, spawn } = makeEngine({});
    await engine.start("/ws/kido", "frontend");
    let resolved = false;
    const stopped = engine.stop("/ws/kido", "frontend").then(() => {
      resolved = true;
    });
    await tick();
    expect(resolved).toBe(false);
    spawn.children[0]!.exit(0);
    await stopped;
    expect(resolved).toBe(true);
  });

  test("unexpected child exit while up returns the forward to stopped", async () => {
    const { engine, spawn } = makeEngine({});
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("up");
    spawn.children[0]!.exit(1);
    await tick();
    expect(engine.status(frontend)?.phase).toBe("stopped");
  });

  test("child exit while starting returns the forward to stopped", async () => {
    const spawn = new FakeSpawn();
    const { engine } = makeEngine({ spawn, probeOpen: false });
    const started = engine.start("/ws/kido", "frontend");
    await tick();
    expect(engine.status(frontend)?.phase).toBe("starting");
    spawn.children[0]!.exit(255);
    await started;
    expect(engine.status(frontend)?.phase).toBe("stopped");
  });

  test("a spawn failure leaves the forward stopped", async () => {
    const spawn = new FakeSpawn();
    spawn.error = new Error("spawn ssh ENOENT");
    const { engine } = makeEngine({ spawn });
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("stopped");
  });

  test("start kills the child when the port never opens before the deadline", async () => {
    const spawn = new FakeSpawn();
    const { engine } = makeEngine({ spawn, probeOpen: false });
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("stopped");
    expect(spawn.children[0]!.killSignal).toBe("SIGTERM");
  });

  test("stopAll kills every running child", async () => {
    const { engine, spawn } = makeEngine({});
    await engine.start("/ws/kido", "frontend");
    await engine.start("/ws/backend", "worker");
    const stopped = engine.stopAll();
    for (const child of spawn.children) child.exit(0);
    await stopped;
    expect(spawn.children.map((c) => c.killSignal)).toEqual(["SIGTERM", "SIGTERM"]);
    expect(engine.status(frontend)?.phase).toBe("stopped");
    expect(engine.status(forwardKey("/ws/backend", "worker"))?.phase).toBe("stopped");
  });

  test("emits a change event on every phase transition", async () => {
    const { engine } = makeEngine({});
    const seen: string[] = [];
    engine.onChange(() => seen.push(engine.status(frontend)?.phase ?? "?"));
    await engine.start("/ws/kido", "frontend");
    expect(seen).toEqual(["starting", "up"]);
  });
});

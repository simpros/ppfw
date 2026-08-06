import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/app.ts";
import {
  buildSshArgs,
  ForwardEngine,
  forwardKey,
  type SpawnedChild,
} from "../src/forward.ts";
import { classifyExit } from "../src/supervisor.ts";

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
  private stderrValue = "";
  readonly exited = new Promise<number>((resolve) => {
    this.resolveExit = resolve;
  });

  kill(signal?: string): void {
    this.killSignal = signal ?? "SIGTERM";
  }

  stderrText = async (): Promise<string> => this.stderrValue;

  exit(code: number, stderrText = ""): void {
    this.stderrValue = stderrText;
    this.resolveExit(code);
  }
}

class FakeSpawn {
  calls: string[][] = [];
  children: FakeChild[] = [];
  error: Error | null = null;
  probeOpen = true;
  portInUse = false;
  private livePorts = new Set<number>();

  fn = (argv: string[]): SpawnedChild => {
    if (this.error) throw this.error;
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

  /** A port opens while its ssh child is alive, and closes when it exits. */
  probe = (port: number): Promise<boolean> =>
    Promise.resolve(this.portInUse || (this.probeOpen && this.livePorts.has(port)));
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await tick();
  }
}

function makeEngine(overrides: {
  apps?: AppConfig[];
  defaultRemote?: string | null;
  spawn?: FakeSpawn;
  probeOpen?: boolean;
  portInUse?: boolean;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}) {
  const spawn = overrides.spawn ?? new FakeSpawn();
  if ("probeOpen" in overrides) spawn.probeOpen = overrides.probeOpen!;
  if ("portInUse" in overrides) spawn.portInUse = overrides.portInUse!;
  const engine = new ForwardEngine({
    apps: overrides.apps ?? [kido, backend],
    defaultRemote:
      "defaultRemote" in overrides ? (overrides.defaultRemote ?? null) : "devbox",
    spawn: spawn.fn,
    probe: spawn.probe,
    pollIntervalMs: 1,
    startupTimeoutMs: 50,
    baseBackoffMs: overrides.baseBackoffMs ?? 8,
    maxBackoffMs: overrides.maxBackoffMs ?? 32,
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

describe("classifyExit", () => {
  test("permission denied is a permanent auth failure", () => {
    const failure = classifyExit(
      255,
      "devbox-a: Permission denied (publickey).",
    );
    expect(failure.permanent).toBe(true);
    expect(failure.reason).toContain("auth failed");
  });

  test("authentication failed is a permanent auth failure", () => {
    expect(classifyExit(255, "Authentication failed.").permanent).toBe(true);
  });

  test("host key verification failure is permanent", () => {
    const failure = classifyExit(255, "Host key verification failed.");
    expect(failure.permanent).toBe(true);
    expect(failure.reason).toBe("host key verification failed");
  });

  test("a local bind failure is a permanent port-in-use error", () => {
    const failure = classifyExit(
      255,
      "bind [127.0.0.1]:5173: Address already in use",
    );
    expect(failure.permanent).toBe(true);
    expect(failure.reason).toBe("port in use");
  });

  test("a connection drop is transient and keeps the stderr reason", () => {
    const failure = classifyExit(255, "Connection reset by peer.");
    expect(failure.permanent).toBe(false);
    expect(failure.reason).toBe("Connection reset by peer.");
  });

  test("a bare nonzero exit without stderr is transient", () => {
    const failure = classifyExit(1, "");
    expect(failure.permanent).toBe(false);
    expect(failure.reason).toBe("child exited with code 1");
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

  test("apps targeting different remotes forward in the same session", async () => {
    const api: AppConfig = {
      name: "api",
      dir: "/ws/api",
      remote: "devbox-b",
      ports: [{ name: "svc", port: 9001, forward: true, alias: null }],
    };
    const { engine, spawn } = makeEngine({ apps: [kido, api, backend] });
    await engine.start("/ws/kido", "frontend");
    await engine.start("/ws/api", "svc");
    await engine.start("/ws/backend", "worker");
    expect(spawn.calls.map((call) => call[call.length - 1])).toEqual([
      "devbox-a",
      "devbox-b",
      "devbox",
    ]);
    expect(engine.status(frontend)?.phase).toBe("up");
    expect(engine.status(forwardKey("/ws/api", "svc"))?.phase).toBe("up");
    expect(engine.status(forwardKey("/ws/backend", "worker"))?.phase).toBe("up");
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

  test("unexpected exit while up goes to reconnecting, then restarts to up", async () => {
    const { engine, spawn } = makeEngine({});
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("up");
    spawn.children[0]!.exit(1);
    await waitFor(() => engine.status(frontend)?.phase === "reconnecting");
    expect(engine.status(frontend)?.note).toBe("child exited with code 1");
    await waitFor(() => engine.status(frontend)?.phase === "up");
    expect(spawn.calls.length).toBe(2);
  });

  test("child exit while starting goes to reconnecting", async () => {
    const spawn = new FakeSpawn();
    spawn.probeOpen = false;
    const { engine } = makeEngine({ spawn });
    const started = engine.start("/ws/kido", "frontend");
    await tick();
    expect(engine.status(frontend)?.phase).toBe("starting");
    spawn.children[0]!.exit(255);
    await started;
    expect(engine.status(frontend)?.phase).toBe("reconnecting");
  });

  test("a spawn failure leaves the forward in error with a reason", async () => {
    const spawn = new FakeSpawn();
    spawn.error = new Error("spawn ssh ENOENT");
    const { engine } = makeEngine({ spawn });
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("error");
    expect(engine.status(frontend)?.note).toContain("cannot start SSH forward");
  });

  test("start kills the child when the port never opens before the deadline", async () => {
    const spawn = new FakeSpawn();
    const { engine } = makeEngine({ spawn, probeOpen: false });
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("stopped");
    expect(spawn.children[0]!.killSignal).toBe("SIGTERM");
  });

  test("starting with the local port already in use marks error and does not spawn", async () => {
    const { engine, spawn } = makeEngine({ portInUse: true });
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("error");
    expect(engine.status(frontend)?.note).toBe("port in use");
    expect(spawn.calls).toEqual([]);
  });

  test("ssh bind failure while starting marks error with port in use", async () => {
    const spawn = new FakeSpawn();
    spawn.probeOpen = false;
    const { engine } = makeEngine({ spawn });
    const started = engine.start("/ws/kido", "frontend");
    await tick();
    spawn.children[0]!.exit(255, "bind [127.0.0.1]:5173: Address already in use");
    await started;
    expect(engine.status(frontend)?.phase).toBe("error");
    expect(engine.status(frontend)?.note).toBe("port in use");
  });

  test("auth failure marks error and does not keep retrying", async () => {
    const spawn = new FakeSpawn();
    spawn.probeOpen = false;
    const { engine } = makeEngine({ spawn });
    const started = engine.start("/ws/kido", "frontend");
    await tick();
    spawn.children[0]!.exit(255, "devbox-a: Permission denied (publickey).");
    await started;
    expect(engine.status(frontend)?.phase).toBe("error");
    expect(engine.status(frontend)?.note).toContain("auth failed");
    await tick(40);
    expect(spawn.calls.length).toBe(1);
  });

  test("transient failure during start reconnects and returns to up", async () => {
    const spawn = new FakeSpawn();
    spawn.probeOpen = false;
    const { engine } = makeEngine({ spawn });
    const started = engine.start("/ws/kido", "frontend");
    await tick();
    spawn.children[0]!.exit(255, "Connection timed out");
    await started;
    await waitFor(() => engine.status(frontend)?.phase === "reconnecting");
    expect(engine.status(frontend)?.note).toBe("Connection timed out");
    spawn.probeOpen = true;
    await waitFor(() => engine.status(frontend)?.phase === "up");
    expect(spawn.calls.length).toBe(2);
  });

  test("consecutive transient failures back off exponentially to the cap", async () => {
    const spawn = new FakeSpawn();
    spawn.probeOpen = false;
    const { engine } = makeEngine({ spawn, baseBackoffMs: 8, maxBackoffMs: 32 });

    const started = engine.start("/ws/kido", "frontend");
    await tick();
    spawn.children[0]!.exit(255, "Connection timed out");
    await started;
    await waitFor(() => engine.status(frontend)?.phase === "reconnecting");
    expect(engine.status(frontend)?.backoffMs).toBe(8);

    for (const expected of [16, 32, 32]) {
      const before = spawn.calls.length;
      await waitFor(() => spawn.calls.length === before + 1);
      spawn.children[spawn.children.length - 1]!.exit(255, "Connection timed out");
      await waitFor(() => engine.status(frontend)?.phase === "reconnecting");
      expect(engine.status(frontend)?.backoffMs).toBe(expected);
    }
  });

  test("a manual stop is not restarted", async () => {
    const { engine, spawn } = makeEngine({});
    await engine.start("/ws/kido", "frontend");
    const stopped = engine.stop("/ws/kido", "frontend");
    spawn.children[0]!.exit(0);
    await stopped;
    await tick(30);
    expect(engine.status(frontend)?.phase).toBe("stopped");
    expect(spawn.calls.length).toBe(1);
  });

  test("stopping while reconnecting cancels the pending retry", async () => {
    const { engine, spawn } = makeEngine({ baseBackoffMs: 40 });
    await engine.start("/ws/kido", "frontend");
    spawn.children[0]!.exit(1);
    await waitFor(() => engine.status(frontend)?.phase === "reconnecting");
    const stopped = engine.stop("/ws/kido", "frontend");
    await stopped;
    await tick(60);
    expect(engine.status(frontend)?.phase).toBe("stopped");
    expect(spawn.calls.length).toBe(1);
  });

  test("start from error retries after the user restarts", async () => {
    const spawn = new FakeSpawn();
    spawn.probeOpen = false;
    const { engine } = makeEngine({ spawn });
    const started = engine.start("/ws/kido", "frontend");
    await tick();
    spawn.children[0]!.exit(255, "Permission denied (publickey).");
    await started;
    expect(engine.status(frontend)?.phase).toBe("error");
    spawn.probeOpen = true;
    await engine.start("/ws/kido", "frontend");
    expect(engine.status(frontend)?.phase).toBe("up");
  });

  test("reconnecting backoff resets after a successful reconnect", async () => {
    const { engine, spawn } = makeEngine({ baseBackoffMs: 8 });
    await engine.start("/ws/kido", "frontend");
    spawn.children[0]!.exit(1);
    await waitFor(() => engine.status(frontend)?.phase === "reconnecting");
    await waitFor(() => engine.status(frontend)?.phase === "up");
    spawn.children[1]!.exit(1);
    await waitFor(() => engine.status(frontend)?.phase === "reconnecting");
    expect(engine.status(frontend)?.backoffMs).toBe(8);
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

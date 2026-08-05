import { connect } from "node:net";
import type { AppConfig, PortEntry } from "./config/app.ts";

export type ForwardPhase = "stopped" | "starting" | "up";

export interface ForwardStatus {
  phase: ForwardPhase;
}

export interface SpawnedChild {
  kill(signal?: NodeJS.Signals): void;
  exited: Promise<number>;
}

export type SpawnFn = (argv: string[]) => SpawnedChild;
export type ProbeFn = (port: number) => Promise<boolean>;

export interface ForwardEngineOptions {
  apps: AppConfig[];
  defaultRemote: string | null;
  spawn?: SpawnFn;
  probe?: ProbeFn;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
}

export function forwardKey(appDir: string, portName: string): string {
  return JSON.stringify([appDir, portName]);
}

export function buildSshArgs(port: number, remote: string): string[] {
  return [
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "ConnectTimeout=10",
    "-L", `${port}:localhost:${port}`,
    remote,
  ];
}

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

const bunSpawn: SpawnFn = (argv) => {
  const proc = Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  return {
    kill: (signal) => proc.kill(signal),
    exited: proc.exited,
  };
};

const tcpProbe: ProbeFn = (port) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });

interface Entry {
  app: AppConfig;
  port: PortEntry;
  phase: ForwardPhase;
  child: SpawnedChild | null;
  generation: number;
}

export class ForwardEngine {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private readonly spawn: SpawnFn;
  private readonly probe: ProbeFn;
  private readonly pollIntervalMs: number;
  private readonly startupTimeoutMs: number;
  private readonly defaultRemote: string | null;

  constructor(options: ForwardEngineOptions) {
    this.spawn = options.spawn ?? bunSpawn;
    this.probe = options.probe ?? tcpProbe;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.defaultRemote = options.defaultRemote;
    for (const app of options.apps) {
      for (const port of app.ports) {
        if (!port.forward) continue;
        this.entries.set(forwardKey(app.dir, port.name), {
          app,
          port,
          phase: "stopped",
          child: null,
          generation: 0,
        });
      }
    }
  }

  status(key: string): ForwardStatus | null {
    const entry = this.entries.get(key);
    return entry ? { phase: entry.phase } : null;
  }

  statuses(): Map<string, ForwardStatus> {
    const map = new Map<string, ForwardStatus>();
    for (const [key, entry] of this.entries) {
      map.set(key, { phase: entry.phase });
    }
    return map;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(appDir: string, portName: string): Promise<void> {
    const key = forwardKey(appDir, portName);
    const entry = this.entries.get(key);
    if (!entry || entry.phase !== "stopped") return;

    const remote = entry.app.remote ?? this.defaultRemote;
    if (!remote) return;

    entry.phase = "starting";
    entry.generation += 1;
    const generation = entry.generation;
    this.emit();

    let child: SpawnedChild;
    try {
      child = this.spawn(["ssh", ...buildSshArgs(entry.port.port, remote)]);
    } catch {
      this.markStopped(entry);
      return;
    }
    entry.child = child;

    await this.runStartup(entry, child, generation);
  }

  async stop(appDir: string, portName: string): Promise<void> {
    const key = forwardKey(appDir, portName);
    const entry = this.entries.get(key);
    if (!entry || entry.phase === "stopped") return;
    await this.teardown(entry);
  }

  async stopAll(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (entry.phase === "stopped") continue;
      pending.push(this.teardown(entry));
    }
    await Promise.all(pending);
  }

  private async teardown(entry: Entry): Promise<void> {
    const child = entry.child;
    entry.generation += 1;
    this.markStopped(entry);
    if (child) {
      child.kill("SIGTERM");
      await child.exited.catch(() => 0);
    }
  }

  private async runStartup(
    entry: Entry,
    child: SpawnedChild,
    generation: number,
  ): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    const isCurrent = () =>
      entry.generation === generation && entry.phase === "starting";

    while (Date.now() < deadline) {
      if (!isCurrent()) return;
      if (await this.probe(entry.port.port)) {
        if (isCurrent()) {
          entry.phase = "up";
          this.emit();
          this.watchExit(entry, child, generation);
        }
        return;
      }
      const exited = await Promise.race([
        child.exited.then(() => true),
        sleep(this.pollIntervalMs).then(() => false),
      ]);
      if (exited) {
        if (isCurrent()) this.markStopped(entry);
        return;
      }
    }

    if (isCurrent()) {
      this.markStopped(entry);
      child.kill("SIGTERM");
    }
  }

  private watchExit(
    entry: Entry,
    child: SpawnedChild,
    generation: number,
  ): void {
    void child.exited.then(() => {
      if (entry.generation === generation && entry.phase === "up") {
        this.markStopped(entry);
      }
    });
  }

  private markStopped(entry: Entry): void {
    entry.phase = "stopped";
    entry.child = null;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

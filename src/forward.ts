import type { AppConfig } from "./config/app.ts";
import {
  ChildSupervisor,
  bunSpawn,
  tcpProbe,
  type ChildPhase,
  type ChildSupervisorOptions,
  type ProbeFn,
  type SpawnFn,
} from "./supervisor.ts";

export type { ProbeFn, SpawnFn, SpawnedChild } from "./supervisor.ts";

export type ForwardPhase = ChildPhase;

export interface ForwardStatus {
  phase: ForwardPhase;
  /** Inline reason for the row; set while reconnecting or in error. */
  note?: string;
  /** Delay before the next reconnect attempt; set while reconnecting. */
  backoffMs?: number;
}

export interface ForwardEngineOptions {
  apps: AppConfig[];
  defaultRemote: string | null;
  spawn?: SpawnFn;
  probe?: ProbeFn;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
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
const DEFAULT_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

interface ForwardEntry {
  supervisor: ChildSupervisor | null;
  port: number;
  remote: string | null;
}

export class ForwardEngine {
  private readonly entries = new Map<string, ForwardEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly spawn: SpawnFn;
  private readonly probe: ProbeFn;
  private readonly pollIntervalMs: number;
  private readonly startupTimeoutMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly defaultRemote: string | null;
  private apps: AppConfig[];

  constructor(options: ForwardEngineOptions) {
    this.spawn = options.spawn ?? bunSpawn;
    this.probe = options.probe ?? tcpProbe;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.defaultRemote = options.defaultRemote;
    this.apps = options.apps;
    for (const app of options.apps) {
      for (const port of app.ports) {
        if (!port.forward) continue;
        this.entries.set(
          forwardKey(app.dir, port.name),
          this.createEntry(port.port, app.remote ?? this.defaultRemote),
        );
      }
    }
  }

  /**
   * Reconcile the engine against a fresh workspace scan: forwards that
   * disappeared are torn down, new ones are added stopped, and ones whose
   * port or remote changed are replaced stopped. Running forwards that are
   * unchanged keep running.
   */
  async setApps(apps: AppConfig[]): Promise<void> {
    const desired = new Map<string, { port: number; remote: string | null }>();
    for (const app of apps) {
      for (const port of app.ports) {
        if (!port.forward) continue;
        desired.set(forwardKey(app.dir, port.name), {
          port: port.port,
          remote: app.remote ?? this.defaultRemote,
        });
      }
    }

    const teardowns: Promise<void>[] = [];
    for (const [key, entry] of [...this.entries]) {
      const spec = desired.get(key);
      if (spec === undefined) {
        this.entries.delete(key);
      } else if (entry.port === spec.port && entry.remote === spec.remote) {
        continue;
      } else {
        this.entries.set(key, this.createEntry(spec.port, spec.remote));
      }
      if (entry.supervisor) teardowns.push(entry.supervisor.stop());
    }
    for (const [key, spec] of desired) {
      if (!this.entries.has(key)) {
        this.entries.set(key, this.createEntry(spec.port, spec.remote));
      }
    }
    this.apps = apps;
    await Promise.all(teardowns);
    this.emit();
  }

  status(key: string): ForwardStatus | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return forwardStatusOf(entry.supervisor);
  }

  statuses(): Map<string, ForwardStatus> {
    const map = new Map<string, ForwardStatus>();
    for (const [key, entry] of this.entries) {
      map.set(key, forwardStatusOf(entry.supervisor));
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
    if (!entry?.supervisor) return;
    await entry.supervisor.start();
  }

  async stop(appDir: string, portName: string): Promise<void> {
    const key = forwardKey(appDir, portName);
    const entry = this.entries.get(key);
    if (!entry?.supervisor) return;
    await entry.supervisor.stop();
  }

  /** Tear the forward down and bring it back up. */
  async restart(appDir: string, portName: string): Promise<void> {
    await this.stop(appDir, portName);
    await this.start(appDir, portName);
  }

  async startApp(appDir: string): Promise<void> {
    await Promise.all(
      this.forwardPortNames(appDir).map((name) => this.start(appDir, name)),
    );
  }

  async stopApp(appDir: string): Promise<void> {
    await Promise.all(
      this.forwardPortNames(appDir).map((name) => this.stop(appDir, name)),
    );
  }

  async startAll(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.supervisor) continue;
      pending.push(entry.supervisor.start());
    }
    await Promise.all(pending);
  }

  async stopAll(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.supervisor) continue;
      pending.push(entry.supervisor.stop());
    }
    await Promise.all(pending);
  }

  private forwardPortNames(appDir: string): string[] {
    const app = this.apps.find((candidate) => candidate.dir === appDir);
    if (!app) return [];
    return app.ports.filter((port) => port.forward).map((port) => port.name);
  }

  private createEntry(port: number, remote: string | null): ForwardEntry {
    const supervisor = remote === null
      ? null
      : new ChildSupervisor(this.supervisorOptions(
          ["ssh", ...buildSshArgs(port, remote)],
          port,
        ));
    supervisor?.onChange(() => this.emit());
    return { supervisor, port, remote };
  }

  private supervisorOptions(argv: string[], port: number): ChildSupervisorOptions {
    return {
      label: "SSH forward",
      argv,
      port,
      spawn: this.spawn,
      probe: this.probe,
      pollIntervalMs: this.pollIntervalMs,
      startupTimeoutMs: this.startupTimeoutMs,
      baseBackoffMs: this.baseBackoffMs,
      maxBackoffMs: this.maxBackoffMs,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function forwardStatusOf(supervisor: ChildSupervisor | null): ForwardStatus {
  if (!supervisor) return { phase: "stopped" };
  const status = supervisor.status();
  const forward: ForwardStatus = { phase: status.phase };
  if (status.lastError !== null) forward.note = status.lastError;
  if (status.backoffMs !== undefined) forward.backoffMs = status.backoffMs;
  return forward;
}

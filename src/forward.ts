import type { AppConfig } from "./config/app.ts";
import {
  ChildSupervisor,
  bunSpawn,
  tcpProbe,
  type ChildSupervisorOptions,
  type ProbeFn,
  type SpawnFn,
} from "./supervisor.ts";

export type { ProbeFn, SpawnFn, SpawnedChild } from "./supervisor.ts";

export type ForwardPhase = "stopped" | "starting" | "up";

export interface ForwardStatus {
  phase: ForwardPhase;
}

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

interface ForwardEntry {
  supervisor: ChildSupervisor | null;
}

export class ForwardEngine {
  private readonly entries = new Map<string, ForwardEntry>();
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
        const remote = app.remote ?? this.defaultRemote;
        const supervisor = remote === null
          ? null
          : new ChildSupervisor(this.supervisorOptions(
              ["ssh", ...buildSshArgs(port.port, remote)],
              port.port,
            ));
        const entry: ForwardEntry = {
          supervisor,
        };
        supervisor?.onChange(() => this.emit());
        this.entries.set(forwardKey(app.dir, port.name), entry);
      }
    }
  }

  status(key: string): ForwardStatus | null {
    const entry = this.entries.get(key);
    return entry ? { phase: entry.supervisor?.status().phase ?? "stopped" } : null;
  }

  statuses(): Map<string, ForwardStatus> {
    const map = new Map<string, ForwardStatus>();
    for (const [key, entry] of this.entries) {
      map.set(key, { phase: entry.supervisor?.status().phase ?? "stopped" });
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

  async stopAll(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.supervisor) continue;
      pending.push(entry.supervisor.stop());
    }
    await Promise.all(pending);
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
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

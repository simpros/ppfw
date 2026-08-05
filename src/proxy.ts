import { join } from "node:path";
import type { AppConfig } from "./config/app.ts";
import { messageOf } from "./errors.ts";
import {
  bunSpawnWithStdin,
  runStartupWatch,
  sleep,
  sudoValidateEscalation,
  tcpProbe,
  type EscalateFn,
  type ProbeFn,
  type SpawnFn,
  type SpawnedChild,
} from "./supervisor.ts";

export interface ProxyRoute {
  host: string;
  port: number;
}

export type ProxyPhase = "down" | "starting" | "up";

export interface ProxyStatus {
  phase: ProxyPhase;
  lastError: string | null;
}

export interface RootProxyOptions {
  routes: ProxyRoute[];
  port?: number;
  scriptPath?: string;
  spawn?: SpawnFn;
  escalate?: EscalateFn;
  probe?: ProbeFn;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  captureTimeoutMs?: number;
}

const DEFAULT_PORT = 80;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_CAPTURE_TIMEOUT_MS = 2_000;

export function proxyRoutesJson(routes: ProxyRoute[]): string {
  const map: Record<string, number> = {};
  for (const route of routes) map[route.host] = route.port;
  return JSON.stringify(map);
}

export function buildRootProxyArgs(
  scriptPath: string,
  port: number,
  routes: ProxyRoute[],
  bunPath: string = process.execPath,
): string[] {
  return [
    "sudo",
    "-n",
    "--",
    bunPath,
    scriptPath,
    "--routes",
    proxyRoutesJson(routes),
    "--port",
    String(port),
  ];
}

export function routesForApps(apps: AppConfig[]): ProxyRoute[] {
  const routes: ProxyRoute[] = [];
  for (const app of apps) {
    for (const port of app.ports) {
      if (port.alias !== null) routes.push({ host: port.alias, port: port.port });
    }
  }
  return routes;
}

export class RootProxy {
  private phase: ProxyPhase = "down";
  private child: SpawnedChild | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly routes: ProxyRoute[];
  private readonly port: number;
  private readonly scriptPath: string;
  private readonly spawn: SpawnFn;
  private readonly escalate: EscalateFn;
  private readonly probe: ProbeFn;
  private readonly pollIntervalMs: number;
  private readonly startupTimeoutMs: number;
  private readonly captureTimeoutMs: number;
  lastError: string | null = null;

  constructor(options: RootProxyOptions) {
    this.routes = options.routes;
    this.port = options.port ?? DEFAULT_PORT;
    this.scriptPath = options.scriptPath ?? join(import.meta.dir, "root-proxy.ts");
    this.spawn = options.spawn ?? bunSpawnWithStdin;
    this.escalate = options.escalate ?? sudoValidateEscalation(this.port);
    this.probe = options.probe ?? tcpProbe;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.captureTimeoutMs = options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  }

  status(): ProxyStatus {
    return { phase: this.phase, lastError: this.lastError };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.phase !== "down") return;

    this.phase = "starting";
    this.generation += 1;
    const generation = this.generation;
    this.emit();

    let escalateCode: number;
    try {
      escalateCode = await this.escalate();
    } catch (cause) {
      this.lastError = messageOf(cause);
      this.markDown();
      return;
    }
    if (this.generation !== generation) return;
    if (escalateCode !== 0) {
      this.lastError = `sudo authentication failed (exit code ${escalateCode})`;
      this.markDown();
      return;
    }

    let child: SpawnedChild;
    try {
      child = this.spawn(buildRootProxyArgs(this.scriptPath, this.port, this.routes));
    } catch (cause) {
      this.lastError = messageOf(cause);
      this.markDown();
      return;
    }
    this.child = child;

    let startupFailed = false;
    await this.runStartup(child, generation, () => {
      startupFailed = true;
    });
    if (startupFailed) await this.captureFailure(child);
  }

  private async captureFailure(child: SpawnedChild): Promise<void> {
    const [exitCode, stderr] = await Promise.all([
      Promise.race([child.exited.catch(() => -1), sleep(this.captureTimeoutMs).then(() => -1)]),
      child.stderrText
        ? Promise.race([child.stderrText(), sleep(this.captureTimeoutMs).then(() => "")])
        : Promise.resolve(""),
    ]);
    const parts: string[] = [];
    if (exitCode !== -1) parts.push(`child exited with code ${exitCode}`);
    const text = stderr.trim();
    if (text !== "") parts.push(text);
    if (parts.length > 0) {
      this.lastError = parts.join(": ");
    } else {
      this.lastError = `timed out waiting for the root proxy to listen on 127.0.0.1:${this.port}`;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.generation += 1;
    this.markDown();
    if (child) {
      this.shutdown(child);
      await child.exited.catch(() => 0);
    }
  }

  private async runStartup(
    child: SpawnedChild,
    generation: number,
    onFailed: () => void,
  ): Promise<void> {
    await runStartupWatch({
      child,
      probe: this.probe,
      port: this.port,
      pollIntervalMs: this.pollIntervalMs,
      startupTimeoutMs: this.startupTimeoutMs,
      isCurrent: () =>
        this.generation === generation && this.phase === "starting",
      onUp: () => {
        this.phase = "up";
        this.emit();
        this.watchExit(child, generation);
      },
      onFailed: () => {
        onFailed();
        this.markDown();
      },
      shutdown: (c) => this.shutdown(c),
    });
  }

  private shutdown(child: SpawnedChild): void {
    if (child.closeStdin) child.closeStdin();
    else child.kill("SIGTERM");
  }

  private watchExit(child: SpawnedChild, generation: number): void {
    void child.exited.then(() => {
      if (this.generation === generation && this.phase === "up") {
        this.markDown();
      }
    });
  }

  private markDown(): void {
    this.phase = "down";
    this.child = null;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

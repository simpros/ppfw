import { connect } from "node:net";
import { messageOf } from "./errors.ts";

export interface SpawnedChild {
  kill(signal?: NodeJS.Signals): void;
  exited: Promise<number>;
  closeStdin?: () => void;
  stderrText?: () => Promise<string>;
}

export type SpawnFn = (argv: string[]) => SpawnedChild;
export type ProbeFn = (port: number) => Promise<boolean>;
export type ChildPhase = "stopped" | "starting" | "up";

export interface ChildStatus {
  phase: ChildPhase;
  lastError: string | null;
}

export interface ChildSupervisorOptions {
  label: string;
  argv: string[];
  port: number;
  prepare?: () => Promise<void>;
  spawn?: SpawnFn;
  probe?: ProbeFn;
  shutdown?: (child: SpawnedChild) => void;
  pollIntervalMs?: number;
  startupTimeoutMs?: number;
  captureTimeoutMs?: number;
}

export const bunSpawn: SpawnFn = (argv) => {
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

export const bunSpawnWithStdin: SpawnFn = (argv) => {
  const proc = Bun.spawn(argv, {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  return {
    kill: (signal) => proc.kill(signal),
    exited: proc.exited,
    closeStdin: () => proc.stdin?.end(),
    stderrText: async () => await new Response(proc.stderr).text(),
  };
};

export const tcpProbe: ProbeFn = (port) =>
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

export type EscalateFn = () => Promise<number>;

export function sudoValidateEscalation(port: number): EscalateFn {
  return async () => {
    const check = Bun.spawn(["sudo", "-n", "true"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await check.exited) === 0) return 0;
    console.error(
      `ppfw: sudo password required to run the root proxy on 127.0.0.1:${port}`,
    );
    const validate = Bun.spawn(["sudo", "-v"], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return validate.exited;
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type StartupResult = "up" | "exited" | "timed out" | "cancelled";

export class ChildSupervisor {
  private phase: ChildPhase = "stopped";
  private child: SpawnedChild | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly label: string;
  private readonly argv: string[];
  private readonly port: number;
  private readonly prepare: () => Promise<void>;
  private readonly spawn: SpawnFn;
  private readonly probe: ProbeFn;
  private readonly shutdownChild: (child: SpawnedChild) => void;
  private readonly pollIntervalMs: number;
  private readonly startupTimeoutMs: number;
  private readonly captureTimeoutMs: number;
  private lastError: string | null = null;

  constructor(options: ChildSupervisorOptions) {
    this.label = options.label;
    this.argv = options.argv;
    this.port = options.port;
    this.prepare = options.prepare ?? (() => Promise.resolve());
    this.spawn = options.spawn ?? bunSpawn;
    this.probe = options.probe ?? tcpProbe;
    this.shutdownChild = options.shutdown ?? ((child) => child.kill("SIGTERM"));
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    this.captureTimeoutMs = options.captureTimeoutMs ?? 2_000;
  }

  status(): ChildStatus {
    return { phase: this.phase, lastError: this.lastError };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.phase !== "stopped") return;

    this.phase = "starting";
    this.lastError = null;
    this.generation += 1;
    const generation = this.generation;
    this.emit();

    try {
      await this.prepare();
    } catch (cause) {
      this.fail(messageOf(cause));
      return;
    }
    if (!this.isCurrent(generation)) return;

    try {
      this.child = this.spawn(this.argv);
    } catch (cause) {
      this.fail(messageOf(cause));
      return;
    }

    const child = this.child;
    const result = await this.waitForStartup(child, generation);
    if (result === "cancelled") return;
    if (result === "up") {
      this.phase = "up";
      this.emit();
      this.watchExit(child, generation);
      return;
    }

    if (result === "timed out") this.shutdownChild(child);
    this.lastError = await this.captureFailure(child, result);
    this.markStopped();
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.generation += 1;
    this.markStopped();
    if (child) {
      this.shutdownChild(child);
      await child.exited.catch(() => 0);
    }
  }

  private async waitForStartup(
    child: SpawnedChild,
    generation: number,
  ): Promise<StartupResult> {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (!this.isCurrent(generation)) return "cancelled";
      if (await this.probe(this.port)) {
        return this.isCurrent(generation) ? "up" : "cancelled";
      }
      const exited = await Promise.race([
        child.exited.then(() => true),
        sleep(this.pollIntervalMs).then(() => false),
      ]);
      if (exited) return this.isCurrent(generation) ? "exited" : "cancelled";
    }
    return this.isCurrent(generation) ? "timed out" : "cancelled";
  }

  private async captureFailure(
    child: SpawnedChild,
    result: Exclude<StartupResult, "up" | "cancelled">,
  ): Promise<string> {
    if (!child.stderrText) {
      return result === "timed out"
        ? `timed out waiting for the ${this.label} to listen on 127.0.0.1:${this.port}`
        : `the ${this.label} exited before it started`;
    }
    const [exitCode, stderr] = await Promise.all([
      Promise.race([child.exited.catch(() => -1), sleep(this.captureTimeoutMs).then(() => -1)]),
      Promise.race([child.stderrText(), sleep(this.captureTimeoutMs).then(() => "")]),
    ]);
    const parts: string[] = [];
    if (exitCode !== -1) parts.push(`child exited with code ${exitCode}`);
    const text = stderr.trim();
    if (text !== "") parts.push(text);
    if (parts.length > 0) return parts.join(": ");
    if (result === "timed out") {
      return `timed out waiting for the ${this.label} to listen on 127.0.0.1:${this.port}`;
    }
    return `the ${this.label} exited before it started`;
  }

  private watchExit(child: SpawnedChild, generation: number): void {
    void child.exited.then(() => {
      if (this.generation === generation && this.phase === "up") this.markStopped();
    });
  }

  private isCurrent(generation: number): boolean {
    return this.generation === generation && this.phase === "starting";
  }

  private fail(error: string): void {
    this.lastError = error;
    this.markStopped();
  }

  private markStopped(): void {
    this.phase = "stopped";
    this.child = null;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

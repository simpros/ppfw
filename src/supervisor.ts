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
export type ChildPhase = "stopped" | "starting" | "up" | "reconnecting" | "error";

export interface ChildStatus {
  phase: ChildPhase;
  lastError: string | null;
  /** Delay before the next reconnect attempt; set while reconnecting. */
  backoffMs?: number;
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
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export const bunSpawn: SpawnFn = (argv) => {
  const proc = Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  return {
    kill: (signal) => proc.kill(signal),
    exited: proc.exited,
    stderrText: async () => await new Response(proc.stderr).text(),
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

export interface Failure {
  /** True when retrying cannot help; the child halts in error. */
  permanent: boolean;
  /** Human-readable reason, rendered inline on the row. */
  reason: string;
}

function lastStderrLine(stderr: string): string {
  return (
    stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .at(-1) ?? ""
  );
}

/**
 * Classify a child-process exit. Permanent failures (auth/permission, port
 * conflicts, sudo escalation) must halt retrying; everything else is treated
 * as a transient drop that the reconnect loop may retry.
 */
export function classifyExit(code: number, stderr: string): Failure {
  const text = stderr.toLowerCase();
  if (text.includes("address already in use")) {
    return { permanent: true, reason: "port in use" };
  }
  if (text.includes("no tty present") || text.includes("a terminal is required")) {
    return { permanent: true, reason: `sudo escalation failed · ${lastStderrLine(stderr)}` };
  }
  if (text.includes("permission denied")) {
    return { permanent: true, reason: `auth failed · ${lastStderrLine(stderr)}` };
  }
  if (text.includes("authentication failed")) {
    return { permanent: true, reason: "auth failed" };
  }
  if (text.includes("host key verification failed")) {
    return { permanent: true, reason: "host key verification failed" };
  }
  const lastLine = lastStderrLine(stderr);
  if (lastLine !== "") {
    return { permanent: false, reason: lastLine };
  }
  return { permanent: false, reason: `child exited with code ${code}` };
}

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_CAPTURE_TIMEOUT_MS = 2_000;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

type StartOutcome =
  | { status: "abandoned" }
  | { status: "up"; child: SpawnedChild }
  | { status: "failed"; failure: Failure }
  | { status: "timed-out" };

export class ChildSupervisor {
  private phase: ChildPhase = "stopped";
  private child: SpawnedChild | null = null;
  private generation = 0;
  private attempts = 0;
  private readonly listeners = new Set<() => void>();
  private readonly label: string;
  private argv: string[];
  private readonly port: number;
  private readonly prepare: () => Promise<void>;
  private readonly spawn: SpawnFn;
  private readonly probe: ProbeFn;
  private readonly shutdownChild: (child: SpawnedChild) => void;
  private readonly pollIntervalMs: number;
  private readonly startupTimeoutMs: number;
  private readonly captureTimeoutMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private lastError: string | null = null;
  private backoffMs: number | undefined;

  constructor(options: ChildSupervisorOptions) {
    this.label = options.label;
    this.argv = options.argv;
    this.port = options.port;
    this.prepare = options.prepare ?? (() => Promise.resolve());
    this.spawn = options.spawn ?? bunSpawn;
    this.probe = options.probe ?? tcpProbe;
    this.shutdownChild = options.shutdown ?? ((child) => child.kill("SIGTERM"));
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.captureTimeoutMs = options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  status(): ChildStatus {
    const status: ChildStatus = {
      phase: this.phase,
      lastError: this.lastError,
    };
    if (this.backoffMs !== undefined) status.backoffMs = this.backoffMs;
    return status;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.phase !== "stopped" && this.phase !== "error") return;

    this.generation += 1;
    const generation = this.generation;
    this.attempts = 0;
    this.phase = "starting";
    this.lastError = null;
    this.backoffMs = undefined;

    // If another process already owns the port, the child cannot bind: fail
    // fast with an inline reason instead of racing the bind error.
    if (await this.probe(this.port)) {
      if (this.isCurrent(generation)) {
        this.setPhase("error", "port in use");
      }
      return;
    }
    if (!this.isCurrent(generation)) return;

    try {
      await this.prepare();
    } catch (cause) {
      if (this.isCurrent(generation)) this.setPhase("error", messageOf(cause));
      return;
    }
    if (!this.isCurrent(generation)) return;

    await this.runAttempt(generation);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.generation += 1;
    this.setPhase("stopped");
    if (child) {
      this.shutdownChild(child);
      await child.exited.catch(() => 0);
    }
  }

  /** Replace the command used by the next spawn; a running child is unaffected. */
  setArgv(argv: string[]): void {
    this.argv = argv;
  }

  /**
   * Drive one lifecycle pass: bring the child up, then either halt on a
   * permanent failure or schedule a reconnect for a transient drop.
   */
  private async runAttempt(generation: number): Promise<void> {
    const result = await this.attemptStart(generation);
    if (result.status === "abandoned" || !this.isCurrent(generation)) return;
    if (result.status === "up") {
      void this.waitForExit(generation, result.child);
      return;
    }
    if (result.status === "failed") {
      if (result.failure.permanent) {
        this.setPhase("error", result.failure.reason);
        return;
      }
      this.scheduleRetry(generation, result.failure.reason);
      return;
    }
    const reason = await this.captureTimeoutReason();
    this.setPhase("stopped", reason);
  }

  private async attemptStart(generation: number): Promise<StartOutcome> {
    let child: SpawnedChild;
    try {
      child = this.spawn(this.argv);
    } catch (cause) {
      return {
        status: "failed",
        failure: {
          permanent: true,
          reason: `cannot start ${this.label}: ${messageOf(cause)}`,
        },
      };
    }
    this.child = child;
    this.phase = "starting";
    this.lastError = null;
    this.backoffMs = undefined;
    this.emit();

    const deadline = Date.now() + this.startupTimeoutMs;
    for (;;) {
      if (!this.isCurrent(generation)) return { status: "abandoned" };
      if (await this.probe(this.port)) {
        if (!this.isCurrent(generation)) return { status: "abandoned" };
        this.phase = "up";
        this.attempts = 0;
        this.emit();
        return { status: "up", child };
      }
      if (Date.now() >= deadline) {
        this.shutdownChild(child);
        void child.exited.catch(() => 0);
        return { status: "timed-out" };
      }
      const exited = await Promise.race([
        child.exited.catch(() => 0).then(() => true),
        sleep(this.pollIntervalMs).then(() => false),
      ]);
      if (exited) {
        if (!this.isCurrent(generation)) return { status: "abandoned" };
        return { status: "failed", failure: await this.classifyChild(child) };
      }
    }
  }

  private async waitForExit(
    generation: number,
    child: SpawnedChild,
  ): Promise<void> {
    const failure = await this.classifyChild(child);
    if (!this.isCurrent(generation) || this.phase !== "up") return;
    if (failure.permanent) {
      this.setPhase("error", failure.reason);
      return;
    }
    this.scheduleRetry(generation, failure.reason);
  }

  private scheduleRetry(generation: number, reason: string): void {
    this.attempts += 1;
    this.backoffMs = this.backoffFor(this.attempts);
    this.setPhase("reconnecting", reason);
    void this.retryAfter(generation, this.backoffMs);
  }

  private async retryAfter(
    generation: number,
    delay: number,
  ): Promise<void> {
    await sleep(delay);
    if (this.isCurrent(generation)) {
      await this.runAttempt(generation);
    }
  }

  private backoffFor(attempt: number): number {
    return Math.min(this.baseBackoffMs * 2 ** (attempt - 1), this.maxBackoffMs);
  }

  private async classifyChild(child: SpawnedChild): Promise<Failure> {
    const [code, stderr] = await Promise.all([
      child.exited.catch(() => 0),
      child.stderrText ? child.stderrText().catch(() => "") : Promise.resolve(""),
    ]);
    return classifyExit(code, stderr);
  }

  private async captureTimeoutReason(): Promise<string> {
    const child = this.child;
    if (!child?.stderrText) {
      return `timed out waiting for the ${this.label} to listen on 127.0.0.1:${this.port}`;
    }
    const [exitCode, stderr] = await Promise.all([
      Promise.race([
        child.exited.catch(() => -1),
        sleep(this.captureTimeoutMs).then(() => -1),
      ]),
      Promise.race([
        child.stderrText().catch(() => ""),
        sleep(this.captureTimeoutMs).then(() => ""),
      ]),
    ]);
    const parts: string[] = [];
    if (exitCode !== -1) parts.push(`child exited with code ${exitCode}`);
    const text = stderr.trim();
    if (text !== "") parts.push(text);
    if (parts.length > 0) return parts.join(": ");
    return `timed out waiting for the ${this.label} to listen on 127.0.0.1:${this.port}`;
  }

  private isCurrent(generation: number): boolean {
    return this.generation === generation;
  }

  private setPhase(phase: ChildPhase, note?: string): void {
    this.phase = phase;
    this.child = null;
    this.lastError = note ?? null;
    if (phase !== "reconnecting") this.backoffMs = undefined;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

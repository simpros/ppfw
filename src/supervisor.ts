import { connect } from "node:net";

export interface SpawnedChild {
  kill(signal?: NodeJS.Signals): void;
  exited: Promise<number>;
}

export type SpawnFn = (argv: string[]) => SpawnedChild;
export type ProbeFn = (port: number) => Promise<boolean>;

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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface StartupWatchOptions {
  child: SpawnedChild;
  probe: ProbeFn;
  port: number;
  pollIntervalMs: number;
  startupTimeoutMs: number;
  isCurrent: () => boolean;
  onUp: () => void;
  onFailed: () => void;
}

export async function runStartupWatch(options: StartupWatchOptions): Promise<void> {
  const {
    child,
    probe,
    port,
    pollIntervalMs,
    startupTimeoutMs,
    isCurrent,
    onUp,
    onFailed,
  } = options;

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (!isCurrent()) return;
    if (await probe(port)) {
      if (isCurrent()) onUp();
      return;
    }
    const exited = await Promise.race([
      child.exited.then(() => true),
      sleep(pollIntervalMs).then(() => false),
    ]);
    if (exited) {
      if (isCurrent()) onFailed();
      return;
    }
  }

  if (isCurrent()) {
    onFailed();
    child.kill("SIGTERM");
  }
}

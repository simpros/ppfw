import type { SpawnedChild } from "../../src/supervisor.ts";

export class FakeChild implements SpawnedChild {
  killSignal: string | null = null;
  stdinClosed = false;
  stderr = "";
  private resolveExit!: (code: number) => void;
  readonly exited = new Promise<number>((resolve) => {
    this.resolveExit = resolve;
  });

  kill(signal?: string): void {
    this.killSignal = signal ?? "SIGTERM";
  }

  closeStdin(): void {
    this.stdinClosed = true;
    this.exit(0);
  }

  stderrText = async (): Promise<string> => this.stderr;

  exit(code: number, stderrText?: string): void {
    if (stderrText !== undefined) this.stderr = stderrText;
    this.resolveExit(code);
  }
}

export class FakeSpawn {
  calls: string[][] = [];
  children: FakeChild[] = [];
  error: Error | null = null;
  probeOpen = true;
  portInUse = false;
  private livePorts = new Set<number>();
  private liveProxy = 0;

  forForwards = (argv: string[]): SpawnedChild => {
    const child = this.spawn(argv);
    const port = Number(argv.find((arg) => arg.includes(":localhost:"))!.split(":")[0]);
    this.livePorts.add(port);
    child.exited.then(() => {
      this.livePorts.delete(port);
    });
    return child;
  };

  forProxy = (argv: string[]): SpawnedChild => {
    const child = this.spawn(argv);
    this.liveProxy += 1;
    child.exited.then(() => {
      this.liveProxy -= 1;
    });
    return child;
  };

  /** A port opens while its ssh child is alive, and closes when it exits. */
  forwardProbe = (port: number): Promise<boolean> =>
    Promise.resolve(this.portInUse || (this.probeOpen && this.livePorts.has(port)));

  /** Port 80 opens while the proxy child is alive, and closes when it exits. */
  proxyProbe = (_port?: number): Promise<boolean> =>
    Promise.resolve(this.portInUse || (this.probeOpen && this.liveProxy > 0));

  private spawn(argv: string[]): FakeChild {
    if (this.error) throw this.error;
    this.calls.push(argv);
    const child = new FakeChild();
    this.children.push(child);
    return child;
  }
}

export const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await tick();
  }
}

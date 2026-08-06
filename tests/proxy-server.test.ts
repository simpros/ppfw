import { afterEach, describe, expect, test } from "bun:test";
import { RouteTable } from "../src/route-table.ts";
import { startProxyServer } from "../src/proxy-server.ts";

interface Backend {
  port: number;
  close(): void;
}

const backends: Backend[] = [];
const proxies: ReturnType<typeof startProxyServer>[] = [];

afterEach(() => {
  for (const proxy of proxies) proxy.stop();
  for (const backend of backends) backend.close();
  proxies.length = 0;
  backends.length = 0;
});

function listen(
  handler: (request: Request) => Response | Promise<Response>,
): Backend {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler,
  });
  const backend = { port: server.port!, close: () => void server.stop(true) };
  backends.push(backend);
  return backend;
}

function proxy(routes: Record<string, number>): ReturnType<typeof startProxyServer> {
  const server = startProxyServer(
    new RouteTable(Object.entries(routes).map(([host, port]) => ({ host, port }))),
    { port: 0 },
  );
  proxies.push(server);
  return server;
}

describe("startProxyServer", () => {
  test("relays WebSocket connections for dev-server HMR", async () => {
    let resolveBackendMessage!: (message: string) => void;
    const backendMessage = new Promise<string>((resolve) => {
      resolveBackendMessage = resolve;
    });
    const backend = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) =>
        server.upgrade(request)
          ? undefined
          : new Response("expected websocket", { status: 400 }),
      websocket: {
        open: (ws) => {
          ws.send("hmr-connected");
        },
        message: (ws, message) => {
          resolveBackendMessage(String(message));
          ws.send(message);
        },
      },
    });
    backends.push({ port: backend.port!, close: () => void backend.stop(true) });
    const p = proxy({ "frontend.kido.local": backend.port! });
    const client = new WebSocket(`ws://127.0.0.1:${p.port}/hmr`, {
      headers: { Host: "frontend.kido.local" },
    });
    const messages: string[] = [];
    client.addEventListener("message", (event) => messages.push(String(event.data)));

    await new Promise<void>((resolve, reject) => {
      client.addEventListener("open", () => resolve());
      client.addEventListener("error", () => reject(new Error("WebSocket did not open")));
    });
    await new Promise<void>((resolve) => {
      const check = () => (messages.includes("hmr-connected") ? resolve() : setTimeout(check, 1));
      check();
    });
    client.send("hmr-update");
    await backendMessage;
    expect(messages).toContain("hmr-connected");
    expect(await backendMessage).toBe("hmr-update");
    client.close();
  });

  test("routes by Host header to the matching localhost port", async () => {
    const backend = listen(
      (request) =>
        new Response(`hello ${request.url} host=${request.headers.get("host")}`),
    );
    const p = proxy({ "frontend.kido.local": backend.port });

    const res = await fetch(`http://127.0.0.1:${p.port}/api/users?q=1`, {
      headers: { Host: "frontend.kido.local" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      "hello http://frontend.kido.local/api/users?q=1 host=frontend.kido.local",
    );
  });

  test("routes to the backend for the exact host only", async () => {
    const frontend = listen(() => new Response("frontend"));
    const api = listen(() => new Response("api"));
    const p = proxy({ "frontend.kido.local": frontend.port, "api.kido.local": api.port });

    expect(await (await fetch(`http://127.0.0.1:${p.port}/`, {
      headers: { Host: "frontend.kido.local" },
    })).text()).toBe("frontend");
    expect(await (await fetch(`http://127.0.0.1:${p.port}/`, {
      headers: { Host: "api.kido.local" },
    })).text()).toBe("api");
  });

  test("a host header with an explicit port still matches", async () => {
    const backend = listen(() => new Response("ok"));
    const p = proxy({ "api.kido.local": backend.port });

    const res = await fetch(`http://127.0.0.1:${p.port}/`, {
      headers: { Host: "api.kido.local:8080" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("host matching is case-insensitive", async () => {
    const backend = listen(() => new Response("ok"));
    const p = proxy({ "Frontend.Kido.Local": backend.port });

    const res = await fetch(`http://127.0.0.1:${p.port}/`, {
      headers: { Host: "frontend.kido.local" },
    });
    expect(res.status).toBe(200);
  });

  test("forwards method, body, and response headers", async () => {
    const backend = listen(async (request) => {
      expect(request.method).toBe("POST");
      expect(await request.text()).toBe("payload");
      return new Response("created", { status: 201, headers: { "x-backend": "yes" } });
    });
    const p = proxy({ "db.kido.local": backend.port });

    const res = await fetch(`http://127.0.0.1:${p.port}/items`, {
      method: "POST",
      headers: { Host: "db.kido.local", "content-type": "text/plain" },
      body: "payload",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-backend")).toBe("yes");
  });

  test("unknown host returns 502", async () => {
    const p = proxy({ "frontend.kido.local": 1 });
    const res = await fetch(`http://127.0.0.1:${p.port}/`, {
      headers: { Host: "nope.kido.local" },
    });
    expect(res.status).toBe(502);
  });

  test("backend that is down returns 502", async () => {
    const p = proxy({ "frontend.kido.local": 1 });
    const res = await fetch(`http://127.0.0.1:${p.port}/`, {
      headers: { Host: "frontend.kido.local" },
    });
    expect(res.status).toBe(502);
  });

  test("request without a host header returns 502", async () => {
    const p = proxy({ "frontend.kido.local": 1 });
    const res = await fetch(`http://127.0.0.1:${p.port}/`, {
      headers: { host: "" },
    });
    expect(res.status).toBe(502);
  });
});

describe("RouteTable", () => {
  test("lowercases and trims the header", () => {
    const routes = new RouteTable([{ host: "Frontend.Kido.Local", port: 1 }]);
    expect(routes.lookup("  frontend.kido.local  ")).toBe(1);
  });

  test("strips an explicit port", () => {
    const routes = new RouteTable([{ host: "frontend.kido.local", port: 1 }]);
    expect(routes.lookup("frontend.kido.local:8080")).toBe(1);
    expect(routes.lookup("frontend.kido.local:80")).toBe(1);
  });

  test("returns null for a missing or empty header", () => {
    const routes = new RouteTable([{ host: "frontend.kido.local", port: 1 }]);
    expect(routes.lookup(null)).toBeUndefined();
    expect(routes.lookup("   ")).toBeUndefined();
  });

  test("rejects duplicate aliases after normalization", () => {
    expect(() => new RouteTable([
      { host: "Frontend.Kido.Local", port: 1 },
      { host: "frontend.kido.local", port: 2 },
    ])).toThrow(/duplicate alias host/);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { normalizeHost, startProxyServer } from "../src/proxy-server.ts";

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
  const server = startProxyServer(new Map(Object.entries(routes)), { port: 0 });
  proxies.push(server);
  return server;
}

describe("startProxyServer", () => {
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

describe("normalizeHost", () => {
  test("lowercases and trims the header", () => {
    expect(normalizeHost("  Frontend.Kido.Local  ")).toBe("frontend.kido.local");
  });

  test("strips an explicit port", () => {
    expect(normalizeHost("frontend.kido.local:8080")).toBe("frontend.kido.local");
    expect(normalizeHost("frontend.kido.local:80")).toBe("frontend.kido.local");
  });

  test("returns null for a missing or empty header", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
  });
});

/**
 * The relay logins, both ends: the site's function (api/ice.ts) hands a relay
 * only to the game's own pages and only while it holds a TURN key, and never
 * passes on what a browser cannot use; the page (ice.ts) keeps a good answer,
 * and falls back to STUN alone, never failing, when there is none.
 */
import { afterEach, describe, expect, it } from "vitest";
import { DIRECT_SERVERS, TTL, allowed, answer, usable, type IceAnswer } from "../../../api/ice";
import { DIRECT, forgetIce, iceServers, readAnswer, relayReady } from "./ice";

const SITE = "https://www.arthurenard.me";
const KEY = { TURN_KEY_ID: "key-1", TURN_KEY_API_TOKEN: "secret" };

/** Cloudflare's answer, as its documentation gives it. */
const CLOUDFLARE = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turns:turn.cloudflare.com:5349?transport=tcp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "generated-user",
      credential: "generated-pass",
    },
  ],
};

const ask = (origin: string | null, method = "POST") =>
  new Request("https://www.arthurenard.me/super-claude-bros/api/ice.json", { method, headers: origin ? { origin } : {} });

function cloudflare(reply: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply();
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

async function body(response: Response): Promise<IceAnswer> {
  return (await response.json()) as IceAnswer;
}

describe("the site's relay logins (api/ice.ts)", () => {
  it("answers the game's own pages, and no other site", () => {
    expect(allowed(SITE)).toBe(true);
    expect(allowed("https://arthurenard.me")).toBe(true);
    expect(allowed("https://super-claude-bros-git-main-arthurenards-projects.vercel.app")).toBe(true);
    expect(allowed("http://127.0.0.1:5191")).toBe(true);
    expect(allowed("https://localhost:5190")).toBe(true);
    expect(allowed("https://evil.example")).toBe(false);
    expect(allowed("https://www.arthurenard.me.evil.example")).toBe(false);
    expect(allowed("https://someone-else.vercel.app")).toBe(false);
    expect(allowed(null)).toBe(false);
    expect(allowed("not a url")).toBe(false);
  });

  it("asks Cloudflare for a day's login with the key, and passes on what a browser can use", async () => {
    const cf = cloudflare(() => Response.json(CLOUDFLARE, { status: 201 }));
    const response = await answer(ask(SITE), KEY, cf.fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(cf.calls).toHaveLength(1);
    expect(cf.calls[0]!.url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers");
    expect(cf.calls[0]!.init.method).toBe("POST");
    expect((cf.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(cf.calls[0]!.init.body as string)).toEqual({ ttl: TTL });
    const got = await body(response);
    expect(got.relay).toBe(true);
    expect(got.ttl).toBe(TTL);
    // Port 53 is blocked by browsers: gone, and nothing else is.
    expect(got.iceServers).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turn:turn.cloudflare.com:3478?transport=tcp",
          "turns:turn.cloudflare.com:5349?transport=tcp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "generated-user",
        credential: "generated-pass",
      },
    ]);
    // The key never leaves the function.
    expect(JSON.stringify(got)).not.toContain("secret");
  });

  it("hands out STUN alone without a key, or when Cloudflare fails or says something unexpected", async () => {
    const never = cloudflare(() => {
      throw new Error("should not be asked");
    });
    expect(await body(await answer(ask(SITE), {}, never.fetcher))).toEqual({ iceServers: DIRECT_SERVERS, relay: false, ttl: 600 });
    expect(await body(await answer(ask(SITE), { TURN_KEY_ID: "key-1", TURN_KEY_API_TOKEN: "  " }, never.fetcher))).toMatchObject({ relay: false });
    expect(never.calls).toHaveLength(0);

    for (const reply of [
      () => new Response("no", { status: 401 }),
      () => Promise.reject(new Error("timeout")),
      () => Response.json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }] }),
      () => Response.json({ servers: [] }),
      () => new Response("not json", { status: 201 }),
    ]) {
      const response = await answer(ask(SITE), KEY, cloudflare(reply).fetcher);
      expect(response.status).toBe(200);
      expect(await body(response)).toEqual({ iceServers: DIRECT_SERVERS, relay: false, ttl: 600 });
    }
  });

  it("refuses another site and anything but a POST, without asking Cloudflare", async () => {
    const cf = cloudflare(() => Response.json(CLOUDFLARE, { status: 201 }));
    expect((await answer(ask("https://evil.example"), KEY, cf.fetcher)).status).toBe(403);
    expect((await answer(ask(null), KEY, cf.fetcher)).status).toBe(403);
    expect((await answer(ask(SITE, "GET"), KEY, cf.fetcher)).status).toBe(405);
    expect(cf.calls).toHaveLength(0);
  });

  it("keeps only usable servers from a list, and needs a relay among them", () => {
    expect(usable(CLOUDFLARE)).not.toBeNull();
    expect(usable({ iceServers: [{ urls: "turn:a.example:3478", username: 1 }] })).toEqual([{ urls: ["turn:a.example:3478"] }]);
    expect(usable({ iceServers: [{ urls: ["http://a.example"] }, { urls: "turn:a.example:53" }] })).toBeNull();
    expect(usable(null)).toBeNull();
  });
});

describe("the page's ICE servers (ice.ts)", () => {
  afterEach(() => forgetIce());

  const RELAYED: IceAnswer = {
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" }],
    relay: true,
    ttl: 86400,
  };

  function site(reply: () => Response | Promise<Response>) {
    let asked = 0;
    const fetcher = (async (url: string, init: RequestInit) => {
      asked++;
      expect(url).toBe("https://site.example/api/ice.json");
      expect(init.method).toBe("POST");
      return reply();
    }) as unknown as typeof fetch;
    return { fetcher, asked: () => asked };
  }

  it("uses the site's answer, asks once for many rooms, and again when half the login is gone", async () => {
    let clock = 0;
    const s = site(() => Response.json(RELAYED));
    const options = { fetch: s.fetcher, url: "https://site.example/api/ice.json", now: () => clock };
    expect(relayReady()).toBe(false);
    const [a, b] = await Promise.all([iceServers(options), iceServers(options)]);
    expect(a).toEqual(RELAYED.iceServers);
    // The screens now say friends can join from anywhere.
    expect(relayReady()).toBe(true);
    expect(b).toBe(a);
    expect(s.asked()).toBe(1);
    clock = 43_199_000;
    await iceServers(options);
    expect(s.asked()).toBe(1);
    clock = 43_200_000;
    await iceServers(options);
    expect(s.asked()).toBe(2);
  });

  it("falls back to STUN alone, and does not keep a failure", async () => {
    for (const reply of [
      () => new Response("missing", { status: 404 }),
      () => Promise.reject(new TypeError("offline")),
      () => new Response("<!doctype html>", { status: 200 }),
      () => Response.json({ iceServers: [{ urls: ["javascript:alert(1)"] }], ttl: 10 }),
      () => Response.json({ iceServers: [{ urls: ["turn:a"], credential: 5 }], ttl: 10 }),
      () => Response.json({ iceServers: RELAYED.iceServers }),
    ]) {
      const s = site(reply);
      const options = { fetch: s.fetcher, url: "https://site.example/api/ice.json", now: () => 0 };
      expect(await iceServers(options)).toEqual(DIRECT);
      expect(relayReady()).toBe(false);
      await iceServers(options);
      expect(s.asked()).toBe(2);
    }
  });

  it("says there is no relay when the site hands out STUN alone", async () => {
    const s = site(() => Response.json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }], relay: false, ttl: 600 }));
    expect(await iceServers({ fetch: s.fetcher, url: "https://site.example/api/ice.json", now: () => 0 })).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
    ]);
    expect(relayReady()).toBe(false);
  });

  it("asks nothing where there is no page to ask from", async () => {
    // The tests run without a document: no address to ask, so STUN alone.
    expect(await iceServers({ fetch: (() => Promise.reject(new Error("asked"))) as unknown as typeof fetch })).toEqual(DIRECT);
  });

  it("reads an answer only as servers with STUN or TURN addresses and text logins", () => {
    expect(readAnswer(RELAYED)).toEqual({ servers: RELAYED.iceServers, ttl: 86400 });
    expect(readAnswer({ iceServers: [{ urls: "stun:a" }], ttl: 600 })).toEqual({ servers: [{ urls: ["stun:a"] }], ttl: 600 });
    expect(readAnswer({ iceServers: [], ttl: 600 })).toBeNull();
    expect(readAnswer({ iceServers: [{ urls: [] }], ttl: 600 })).toBeNull();
    expect(readAnswer({ iceServers: [{ urls: "stun:a" }], ttl: 0 })).toBeNull();
    expect(readAnswer(null)).toBeNull();
  });
});

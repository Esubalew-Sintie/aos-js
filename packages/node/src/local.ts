// The engine run by this process, for an application that keeps its users
// in its own Postgres and deploys no separate auth server. The SDK starts
// the engine program ("aos app") beside the application, talks to it on a
// local address with a one-time key, and proxies the browser's routes.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { Aos } from "./client.js";

/** The engine release this SDK is tested with. */
export const ENGINE_VERSION = "v0.4.1";

export interface LocalOptions {
  /** The application's Postgres. The engine keeps its own schemas there. */
  databaseUrl: string;
  /** Wraps the engine's keys: `aos keygen` makes one. Keep it out of git. */
  masterKey: string;
  /** The application's address; email links point there. */
  appUrl: string;
  /** Where the browser's routes are mounted. Default "/aos". */
  path?: string;
  /** More browser origins allowed, such as a dev server. */
  origins?: string[];
  slug?: string;
  name?: string;
  kind?: "multi" | "single";
  /** Keep email in a development inbox; hand sessions to the browser. */
  development?: boolean;
  /** The engine program. Default $AOS_ENGINE, else a downloaded release. */
  engine?: string;
  engineVersion?: string;
  /** Environment for email: AOS_SMTP_ADDR, AOS_SMTP_USERNAME, AOS_SMTP_PASSWORD, AOS_MAIL_FROM. */
  env?: Record<string, string>;
  /** Where the engine's log goes. Default: this process's stderr. */
  log?: "inherit" | "ignore";
}

export interface LocalEngine {
  /** The SDK client, talking to the engine as the application's backend. */
  aos: Aos;
  /** The engine's local address (not for browsers). */
  url: string;
  path: string;
  /** For the browser SDK's configuration; not a secret. */
  publishableKey: string;
  version: string;
  /** Express/Connect handler that passes <path>/* to the engine: app.use(local.handler()). */
  handler(): (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse, next?: () => void) => void;
  /** The same for Fetch-API frameworks (Next.js route handlers, Hono). */
  fetch(request: Request): Promise<Response>;
  stop(): Promise<void>;
}

function cacheDir(): string {
  if (process.env.AOSCTL_CACHE_DIR) return process.env.AOSCTL_CACHE_DIR;
  // The same place as Go's os.UserCacheDir, so aosctl and the SDKs share downloads.
  if (process.platform === "win32") return join(process.env.LocalAppData ?? join(homedir(), "AppData", "Local"), "aos");
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "aos");
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "aos");
}

const goOS: Record<string, string> = { linux: "linux", darwin: "darwin", win32: "windows" };
const goArch: Record<string, string> = { x64: "amd64", arm64: "arm64" };

/** Downloads an engine release into the shared cache and returns its path. */
export async function downloadEngine(version = ENGINE_VERSION): Promise<string> {
  const os = goOS[process.platform], arch = goArch[process.arch];
  if (!os || !arch) throw new Error(`aos: no engine build for ${process.platform}/${process.arch}`);
  const exe = os === "windows" ? "aos.exe" : "aos";
  const path = join(cacheDir(), "engine", version, exe);
  if (existsSync(path)) return path;
  const base = (process.env.AOSCTL_RELEASES_URL ?? "https://github.com/flash-softeware/aos/releases/download").replace(/\/+$/, "") + "/" + version + "/";
  const asset = `aos_${version}_${os}_${arch}${os === "windows" ? ".zip" : ".tar.gz"}`;
  const get = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`aos: download ${url}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const sums = (await get(base + "checksums.txt")).toString("utf8");
  const want = sums.split("\n").map((l) => l.trim().split(/\s+/)).find((f) => f[1] === asset)?.[0];
  if (!want) throw new Error(`aos: engine ${version} has no build for ${os}/${arch}`);
  const archive = await get(base + asset);
  if (createHash("sha256").update(archive).digest("hex") !== want) throw new Error(`aos: ${asset} does not match its checksum; not using it`);
  const body = os === "windows" ? fromZip(archive, exe) : fromTarGz(archive, exe);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".part", body);
  chmodSync(path + ".part", 0o755);
  renameSync(path + ".part", path);
  return path;
}

function fromTarGz(archive: Buffer, name: string): Buffer {
  const tar = gunzipSync(archive);
  for (let off = 0; off + 512 <= tar.length; ) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const field = (s: number, n: number) => header.subarray(s, s + n).toString("utf8").replace(/\0.*$/s, "");
    const file = (field(345, 155) ? field(345, 155) + "/" : "") + field(0, 100);
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    if ((type === "0" || type === "\0") && file.split("/").pop() === name) return tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("aos: the archive has no " + name);
}

function fromZip(archive: Buffer, name: string): Buffer {
  for (let off = 0; off + 30 <= archive.length && archive.readUInt32LE(off) === 0x04034b50; ) {
    const method = archive.readUInt16LE(off + 8), size = archive.readUInt32LE(off + 18);
    const nameLen = archive.readUInt16LE(off + 26), extraLen = archive.readUInt16LE(off + 28);
    const file = archive.subarray(off + 30, off + 30 + nameLen).toString("utf8");
    const start = off + 30 + nameLen + extraLen;
    const data = archive.subarray(start, start + size);
    if (file.split("/").pop() === name) return method === 8 ? inflateRawSync(data) : data;
    off = start + size;
  }
  throw new Error("aos: the archive has no " + name);
}

/** Starts the engine for this application and returns a client and a proxy. */
export async function startLocal(opts: LocalOptions): Promise<LocalEngine> {
  if (!opts.databaseUrl || !opts.masterKey || !opts.appUrl) throw new Error("aos: databaseUrl, masterKey and appUrl are required");
  const program = opts.engine ?? process.env.AOS_ENGINE ?? (await downloadEngine(opts.engineVersion));
  const token = "sk_local_" + randomBytes(32).toString("base64url");
  const args = ["app", "--app-url", opts.appUrl, "--path", opts.path ?? "/aos", "--slug", opts.slug ?? "app",
    "--name", opts.name ?? "App", "--kind", opts.kind ?? "multi", "--exit-with-stdin"];
  for (const o of opts.origins ?? []) args.push("--origin", o);
  if (opts.development) args.push("--development");

  const child: ChildProcess = spawn(program, args, {
    env: { ...process.env, ...opts.env, AOS_DATABASE_URL: opts.databaseUrl, AOS_MASTER_KEY: opts.masterKey, AOS_LOCAL_TOKEN: token },
    stdio: ["pipe", "pipe", opts.log ?? "inherit"],
  });
  const stopChild = () => { if (child.exitCode === null) child.kill(); };
  process.once("exit", stopChild);

  const ready = await new Promise<{ url: string; path: string; publishable_key: string; version: string }>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    lines.once("line", (line) => { try { resolve(JSON.parse(line)); } catch { reject(new Error("aos: the engine said: " + line)); } });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`aos: the engine stopped while starting (exit ${code}); see its log above`)));
  });

  const aos = new Aos({ url: ready.url, publishableKey: ready.publishable_key, secretKey: token });
  const target = new URL(ready.url);
  const inPath = (p: string) => p === ready.path || p.startsWith(ready.path + "/");

  const handler: LocalEngine["handler"] = () => (req, res, next) => {
    const url = req.originalUrl ?? req.url ?? "/";
    if (!inPath(url.split("?")[0])) { if (next) next(); else { res.statusCode = 404; res.end(); } return; }
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: target.host };
    const forwarded = [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", ");
    if (forwarded) headers["x-forwarded-for"] = forwarded;
    // A browser never speaks for the backend.
    if (typeof headers.authorization === "string" && headers.authorization.includes("sk_local_")) delete headers.authorization;
    const up = httpRequest({ hostname: target.hostname, port: target.port, path: url, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { if (!res.headersSent) { res.statusCode = 502; } res.end(); });
    req.pipe(up);
  };

  const fetchProxy: LocalEngine["fetch"] = async (request) => {
    const u = new URL(request.url);
    if (!inPath(u.pathname)) return new Response(null, { status: 404 });
    const headers = new Headers(request.headers);
    headers.delete("host");
    if ((headers.get("authorization") ?? "").includes("sk_local_")) headers.delete("authorization");
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const r = await fetch(ready.url + u.pathname + u.search, { method: request.method, headers, body, redirect: "manual" });
    return new Response(r.body, { status: r.status, headers: r.headers });
  };

  return {
    aos, url: ready.url, path: ready.path, publishableKey: ready.publishable_key, version: ready.version,
    handler, fetch: fetchProxy,
    stop: () => new Promise<void>((resolve) => {
      process.removeListener("exit", stopChild);
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.stdin?.end();
      setTimeout(stopChild, 5000).unref();
    }),
  };
}

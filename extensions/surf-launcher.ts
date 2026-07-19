import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { request as httpRequest } from "node:http";
import * as os from "node:os";
import * as path from "node:path";

interface PiUi {
  notify(message: string, level?: "info" | "error" | "warning"): void;
}

interface PiContext {
  cwd: string;
  ui: PiUi;
}

interface PiInputEvent {
  text: string;
}

type InputAction = { action: "continue" } | { action: "handled" };

interface PiExtensionHost {
  on(event: "input", handler: (event: PiInputEvent, ctx: PiContext) => Promise<InputAction>): void;
}

interface RuntimeInfo {
  host: string;
  port: number;
  nonce: string;
}

const DEFAULT_SURF_ROOT = "/Users/somniactic/Development/surf";
const RUNTIME_FILE_PATH = path.join(os.homedir(), ".surf", "runtime.json");

function surfRoot(): string {
  return process.env.SURF_ROOT && process.env.SURF_ROOT.length > 0
    ? process.env.SURF_ROOT
    : DEFAULT_SURF_ROOT;
}

function backendEntry(): string {
  return path.join(surfRoot(), "backend", "dist", "index.js");
}

function openBrowser(url: string): void {
  const child = spawn("open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function currentSessionId(): string | undefined {
  const fromEnv = process.env.PI_CURRENT_SESSION ?? process.env.PI_SESSION_ID;
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

function buildUrl(runtime: RuntimeInfo): string {
  const sessionId = currentSessionId();
  const query = sessionId
    ? `session=${encodeURIComponent(sessionId)}&nonce=${encodeURIComponent(runtime.nonce)}`
    : `nonce=${encodeURIComponent(runtime.nonce)}`;
  return `http://${runtime.host}:${runtime.port}/?${query}`;
}

async function readRuntimeFile(): Promise<RuntimeInfo | null> {
  try {
    const raw = await fs.readFile(RUNTIME_FILE_PATH, "utf8");
    const value = JSON.parse(raw) as Partial<RuntimeInfo>;
    if (
      typeof value.host === "string" &&
      typeof value.port === "number" &&
      Number.isInteger(value.port) &&
      typeof value.nonce === "string"
    ) {
      return value as RuntimeInfo;
    }
  } catch {
    // fall through
  }
  return null;
}

function isBackendAlive(runtime: RuntimeInfo, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: runtime.host,
        port: runtime.port,
        path: "/__surf/health",
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        resolve(res.statusCode === 200);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

function spawnBackend(): void {
  const child = spawn(process.execPath, [backendEntry()], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureBackendRunning(): Promise<RuntimeInfo> {
  const existing = await readRuntimeFile();
  if (existing && (await isBackendAlive(existing))) {
    return existing;
  }

  spawnBackend();

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const runtime = await readRuntimeFile();
    if (runtime && (await isBackendAlive(runtime))) {
      return runtime;
    }
    await sleep(200);
  }

  throw new Error("Surf backend did not become ready in 10s");
}

export default function (pi: PiExtensionHost): void {
  pi.on("input", async (event, ctx) => {
    const text = event.text.trim();
    const isSurf = /^\/surf(?:\s+.*)?$/i.test(text) || /^surf$/i.test(text);
    if (!isSurf) {
      return { action: "continue" };
    }

    try {
      const runtime = await ensureBackendRunning();
      const url = buildUrl(runtime);
      openBrowser(url);
      ctx.ui.notify(`Surf opened at ${url}`, "info");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to open Surf: ${message}`, "error");
    }

    return { action: "handled" };
  });
}

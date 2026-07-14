/**
 * skill-precheck: deterministic gating and setup for skills.
 *
 * Skills opt in via SKILL.md frontmatter:
 *
 *   metadata:
 *     precheck: /abs/path/to/script.py   # or relative to the skill dir
 *
 * When a gated skill is invoked (via `/skill:name` or via the model reading
 * its SKILL.md), the script is run with `python3`. It receives Claude-Code-
 * hook-compatible JSON on stdin:
 *
 *   { "prompt": "<raw input>", "cwd": "<cwd>", "skill": "<name>", "args": "<args>" }
 *
 * Exit codes and streams:
 *   - Exit 0, empty stdout        => skill proceeds unchanged.
 *   - Exit 0, non-empty stdout    => skill proceeds AND stdout is injected
 *                                    into the model's context as
 *                                    <skill-precheck-context skill="name">...
 *                                    ...</skill-precheck-context>.
 *                                    Use this to hand the model deterministic
 *                                    setup output (session tracker paths,
 *                                    generated IDs, prerequisites, etc.).
 *   - Non-zero exit               => skill is blocked; stderr is shown to the
 *                                    user (not the model).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PYTHON = "python3";
const TIMEOUT_MS = 30_000;
const MAX_SCAN_DEPTH = 6;

interface GatedSkill {
  name: string;
  dir: string;
  skillFile: string; // resolved (realpath) SKILL.md / .md path
  script: string; // resolved script path
}

interface PrecheckResult {
  ok: boolean;
  error: string;
  /** stdout captured on success; empty on failure or when the script printed nothing. */
  context: string;
}

function wrapContext(skillName: string, body: string): string {
  return `<skill-precheck-context skill="${skillName}">\n${body.trimEnd()}\n</skill-precheck-context>`;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function parseFrontmatter(file: string): { name?: string; precheck?: string } | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  const fm = m[1];
  const name = fm.match(/^name:\s*["']?([a-z0-9][a-z0-9-]*)["']?\s*$/m)?.[1];
  const precheck = fm.match(/^\s+precheck:\s*["']?(.+?)["']?\s*$/m)?.[1];
  return { name, precheck };
}

function collectSkillFiles(root: string, depth = 0, out: string[] = []): string[] {
  if (depth > MAX_SCAN_DEPTH) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  const skillMd = path.join(root, "SKILL.md");
  if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) {
    out.push(skillMd);
    return out; // a skill dir; don't recurse into it further
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
    collectSkillFiles(path.join(root, e.name), depth + 1, out);
  }
  return out;
}

function expandUser(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readPiSkillsSetting(file: string): string[] {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(cfg.skills) ? cfg.skills : [];
    return list
      .filter((p: unknown): p is string => typeof p === "string")
      .map((p: string) => path.resolve(path.dirname(file), expandUser(p)));
  } catch {
    return [];
  }
}

function skillRoots(cwd: string): string[] {
  const home = os.homedir();
  const roots = [
    path.join(home, ".pi", "agent", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(cwd, ".pi", "skills"),
  ];
  // Honor pi's own `skills` setting (user- and project-level settings.json)
  // so this extension's discovery matches what pi itself surfaces.
  roots.push(...readPiSkillsSetting(path.join(home, ".pi", "agent", "settings.json")));
  roots.push(...readPiSkillsSetting(path.join(cwd, ".pi", "settings.json")));
  // .agents/skills in cwd and ancestors, up to git root (or fs root)
  let dir = cwd;
  for (;;) {
    roots.push(path.join(dir, ".agents", "skills"));
    if (fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return roots;
}

function discoverGatedSkills(cwd: string): Map<string, GatedSkill> {
  const gated = new Map<string, GatedSkill>();
  const files: string[] = [];
  for (const root of skillRoots(cwd)) {
    if (!fs.existsSync(root)) continue;
    collectSkillFiles(root, 0, files);
    // Root-level single-file skills (~/.pi/agent/skills and .pi/skills)
    try {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith(".md")) files.push(path.join(root, e.name));
      }
    } catch {
      /* ignore */
    }
  }
  for (const file of files) {
    const fm = parseFrontmatter(file);
    if (!fm?.precheck) continue;
    const dir = path.dirname(file);
    const name =
      fm.name ??
      (path.basename(file) === "SKILL.md"
        ? path.basename(dir)
        : path.basename(file, ".md"));
    if (gated.has(name)) continue; // first found wins, matching pi's collision rule
    gated.set(name, {
      name,
      dir,
      skillFile: safeRealpath(file),
      script: path.isAbsolute(fm.precheck) ? fm.precheck : path.resolve(dir, fm.precheck),
    });
  }
  return gated;
}

// ---------------------------------------------------------------------------
// Script execution
// ---------------------------------------------------------------------------

function runPrecheck(
  skill: GatedSkill,
  prompt: string,
  args: string,
  cwd: string,
): Promise<PrecheckResult> {
  return new Promise((resolve) => {
    if (!fs.existsSync(skill.script)) {
      resolve({
        ok: false,
        error: `precheck script not found: ${skill.script}`,
        context: "",
      });
      return;
    }
    const child = spawn(PYTHON, [skill.script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let settled = false;

    const done = (result: PrecheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({
        ok: false,
        error: `precheck timed out after ${TIMEOUT_MS / 1000}s`,
        context: "",
      });
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      done({ ok: false, error: `failed to run ${PYTHON}: ${err.message}`, context: "" }),
    );
    child.on("close", (code) => {
      if (code === 0) done({ ok: true, error: "", context: stdout });
      else
        done({
          ok: false,
          error: stderr.trim() || stdout.trim() || `exit code ${code}`,
          context: "",
        });
    });

    child.stdin.write(JSON.stringify({ prompt, cwd, skill: skill.name, args }));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  let gated = new Map<string, GatedSkill>();
  let gatedByFile = new Map<string, GatedSkill>();
  const passed = new Set<string>(); // skills that passed during the current run
  // toolCallId -> { skillName, context } for pending Read-tool injections (Path B)
  const pendingRead = new Map<string, { skillName: string; context: string }>();

  const rebuild = (cwd: string) => {
    gated = discoverGatedSkills(cwd);
    gatedByFile = new Map([...gated.values()].map((s) => [s.skillFile, s]));
  };

  pi.on("session_start", async (_event, ctx) => {
    rebuild(ctx.cwd);
  });

  // Path A: /skill:name command interception (before expansion)
  pi.on("input", async (event, ctx) => {
    const m = event.text.match(/^\/skill:([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/);
    if (!m) return { action: "continue" as const };
    const skill = gated.get(m[1]);
    if (!skill) return { action: "continue" as const };

    ctx.ui.setStatus("skill-precheck", `precheck: ${skill.name}...`);
    const result = await runPrecheck(skill, event.text, m[2]?.trim() ?? "", ctx.cwd);
    ctx.ui.setStatus("skill-precheck", "");

    if (!result.ok) {
      ctx.ui.notify(`Skill "${skill.name}" blocked by precheck: ${result.error}`, "error");
      return { action: "handled" as const };
    }

    passed.add(skill.name);
    if (!result.context.trim()) return { action: "continue" as const };

    // Append the precheck context so pi's skill expansion delivers it as part
    // of the `User: <args>` tail. The `/skill:name` prefix is preserved so
    // expansion still fires.
    return {
      action: "transform" as const,
      text: `${event.text}\n\n${wrapContext(skill.name, result.context)}`,
    };
  });

  // Path B: model reading a gated skill's SKILL.md
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "read") return;
    const input = event.input as { path?: string };
    if (!input.path) return;
    const resolved = safeRealpath(path.resolve(ctx.cwd, input.path));
    const skill = gatedByFile.get(resolved);
    if (!skill || passed.has(skill.name)) return;

    const result = await runPrecheck(skill, "", "", ctx.cwd);
    if (result.ok) {
      passed.add(skill.name);
      if (result.context.trim()) {
        pendingRead.set(event.toolCallId, {
          skillName: skill.name,
          context: result.context,
        });
      }
      return;
    }
    ctx.ui.notify(`Skill "${skill.name}" blocked by precheck: ${result.error}`, "error");
    return {
      block: true,
      reason: `Skill "${skill.name}" is unavailable right now (precheck failed). Do not retry; proceed without it.`,
    };
  });

  // Path B (cont.): append the precheck stdout to the Read tool's result so
  // the model sees it alongside the SKILL.md body it just loaded.
  pi.on("tool_result", async (event) => {
    const pending = pendingRead.get(event.toolCallId);
    if (!pending) return;
    pendingRead.delete(event.toolCallId);
    if (event.isError) return;
    const wrapped = wrapContext(pending.skillName, pending.context);
    return {
      content: [...event.content, { type: "text" as const, text: `\n\n${wrapped}` }],
    };
  });

  // Reset the pass-cache once the agent fully settles
  pi.on("agent_settled", async () => {
    passed.clear();
    pendingRead.clear();
  });
}

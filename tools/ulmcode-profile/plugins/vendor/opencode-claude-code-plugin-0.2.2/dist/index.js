// src/claude-code-language-model.ts
import { generateId } from "@ai-sdk/provider-utils";

// src/logger.ts
var DEBUG = process.env.DEBUG?.includes("opencode-claude-code") ?? false;
function fmt(level, msg, data) {
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const base = `[${ts}] [opencode-claude-code] ${level}: ${msg}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}
var log = {
  info(msg, data) {
    if (DEBUG) console.error(fmt("INFO", msg, data));
  },
  notice(msg, data) {
    console.error(fmt("NOTICE", msg, data));
  },
  warn(msg, data) {
    if (DEBUG) console.error(fmt("WARN", msg, data));
  },
  error(msg, data) {
    console.error(fmt("ERROR", msg, data));
  },
  debug(msg, data) {
    if (DEBUG) console.error(fmt("DEBUG", msg, data));
  }
};

// src/tool-mapping.ts
function mapToolInput(name, input) {
  if (!input) return input;
  switch (name) {
    case "Write":
      return {
        filePath: input.file_path ?? input.filePath,
        content: input.content
      };
    case "Edit":
      return {
        filePath: input.file_path ?? input.filePath,
        oldString: input.old_string ?? input.oldString,
        newString: input.new_string ?? input.newString,
        replaceAll: input.replace_all ?? input.replaceAll
      };
    case "Read":
      return {
        filePath: input.file_path ?? input.filePath,
        offset: input.offset,
        limit: input.limit
      };
    case "Bash":
      return {
        command: input.command,
        description: input.description || `Execute: ${String(input.command || "").slice(0, 50)}${String(input.command || "").length > 50 ? "..." : ""}`,
        timeout: input.timeout
      };
    case "NotebookEdit":
      return {
        notebookPath: input.notebook_path ?? input.notebookPath,
        cellNumber: input.cell_number ?? input.cellNumber,
        newSource: input.new_source ?? input.newSource,
        cellType: input.cell_type ?? input.cellType,
        editMode: input.edit_mode ?? input.editMode
      };
    case "Glob":
      return {
        pattern: input.pattern,
        path: input.path
      };
    case "Grep":
      return {
        pattern: input.pattern,
        path: input.path,
        include: input.include
      };
    case "TodoWrite":
      if (Array.isArray(input.todos)) {
        const mappedTodos = input.todos.map((todo, index) => ({
          content: todo.content,
          status: todo.status || "pending",
          priority: todo.priority || "medium",
          id: todo.id || `todo_${Date.now()}_${index}`
        }));
        return { todos: mappedTodos };
      }
      return input;
    default:
      return input;
  }
}
var OPENCODE_HANDLED_TOOLS = /* @__PURE__ */ new Set([
  "Edit",
  "Write",
  "Bash",
  "NotebookEdit",
  "Read",
  "Glob",
  "Grep"
]);
var CLAUDE_INTERNAL_TOOLS = /* @__PURE__ */ new Set([
  "ToolSearch",
  "Agent",
  "AskFollowupQuestion"
]);
function mapTool(name, input, opts) {
  if (CLAUDE_INTERNAL_TOOLS.has(name)) {
    log.debug("skipping Claude CLI internal tool", { name });
    return { name, input, executed: true, skip: true };
  }
  if (name === "EnterPlanMode") return { name: "plan_enter", input: {}, executed: false };
  if (name === "ExitPlanMode") return { name: "plan_exit", input, executed: false };
  if (name === "TodoWrite") {
    const mappedInput = mapToolInput(name, input);
    return { name: "todowrite", input: mappedInput, executed: false };
  }
  if (name === "WebSearch" || name === "web_search") {
    const mappedInput = input?.query ? { query: input.query } : input;
    const route = opts?.webSearch;
    if (route && route !== "claude" && route !== "disabled") {
      log.debug("routing WebSearch to opencode tool", { target: route, mappedInput });
      return { name: route, input: mappedInput, executed: false };
    }
    log.debug("WebSearch executed by Claude CLI", { mappedInput });
    return { name: "WebSearch", input: mappedInput, executed: true };
  }
  if (name === "TaskOutput") {
    if (!input) return { name: "bash", executed: false };
    const output = input?.content || input?.output || JSON.stringify(input);
    return {
      name: "bash",
      input: {
        command: `echo "TASK OUTPUT: ${String(output).replace(/"/g, '\\"')}"`,
        description: "Displaying task output"
      },
      executed: false
    };
  }
  if (name.startsWith("mcp__")) {
    const parts = name.slice(5).split("__");
    if (parts.length >= 2) {
      const serverName = parts[0];
      const toolName = parts.slice(1).join("_");
      const openCodeName = `${serverName}_${toolName}`;
      log.debug("mapping MCP tool", { original: name, mapped: openCodeName });
      return { name: openCodeName, input, executed: false };
    }
  }
  if (OPENCODE_HANDLED_TOOLS.has(name)) {
    const mappedInput = mapToolInput(name, input);
    const openCodeName = name.toLowerCase();
    log.debug("mapping CLI-executed tool", { name, openCodeName });
    return { name: openCodeName, input: mappedInput, executed: true };
  }
  return { name, input, executed: true };
}

// src/message-builder.ts
var THINKING_KEYWORDS = {
  minimal: null,
  low: "think",
  medium: "think hard",
  high: "think harder",
  xhigh: "megathink",
  max: "ultrathink"
};
function reasoningKeyword(effort) {
  if (!effort) return null;
  return THINKING_KEYWORDS[effort] ?? null;
}
var SUPPORTED_IMAGE_TYPES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);
function toImageBlock(part) {
  const raw = part.data ?? part.url ?? part.source?.data;
  if (!raw) {
    log.warn("file part without data, skipping");
    return null;
  }
  let resolvedMediaType = part.mediaType || part.mimeType || part.mime || "";
  let base64 = null;
  if (typeof raw === "string") {
    if (raw.startsWith("data:")) {
      const match = /^data:([^;,]+)(?:;[^,]*)*(?:;base64)?,(.*)$/s.exec(raw);
      if (!match) {
        log.warn("malformed data URI, skipping file part");
        return null;
      }
      resolvedMediaType = resolvedMediaType || match[1];
      base64 = match[2];
    } else if (/^https?:\/\//i.test(raw)) {
      log.warn("remote URL images are not supported by Claude CLI, skipping");
      return null;
    } else {
      base64 = raw;
    }
  } else if (raw instanceof URL) {
    log.warn("remote URL images are not supported by Claude CLI, skipping");
    return null;
  } else if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
    base64 = Buffer.from(raw).toString("base64");
  } else {
    log.warn("unsupported file part data type", { dataType: typeof raw });
    return null;
  }
  if (!resolvedMediaType || !SUPPORTED_IMAGE_TYPES.has(resolvedMediaType)) {
    log.warn("unsupported media type for Claude image block, skipping", {
      mediaType: resolvedMediaType
    });
    return null;
  }
  return {
    type: "image",
    source: { type: "base64", media_type: resolvedMediaType, data: base64 }
  };
}
function getToolResultText(part) {
  const value = part.output ?? part.result;
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  switch (value.type) {
    case "text":
    case "error-text":
      return String(value.value);
    case "json":
    case "error-json":
      return JSON.stringify(value.value);
    case "execution-denied":
      return value.reason ? `Execution denied: ${value.reason}` : "Execution denied";
    case "content":
      return Array.isArray(value.value) ? value.value.map((item) => {
        if (item?.type === "text") return item.text;
        return JSON.stringify(item);
      }).join("\n") : JSON.stringify(value.value);
    default:
      return JSON.stringify(value);
  }
}
function compactConversationHistory(prompt) {
  const conversationMessages = prompt.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );
  if (conversationMessages.length <= 1) {
    return null;
  }
  const historyParts = [];
  for (let i = 0; i < conversationMessages.length - 1; i++) {
    const msg = conversationMessages[i];
    const role = msg.role === "user" ? "User" : "Assistant";
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textParts = msg.content.filter((p) => p.type === "text" && p.text).map((p) => p.text);
      text = textParts.join("\n");
      const toolCalls = msg.content.filter(
        (p) => p.type === "tool-call"
      );
      const toolResults = msg.content.filter(
        (p) => p.type === "tool-result"
      );
      if (toolCalls.length > 0) {
        text += `
[Called ${toolCalls.length} tool(s): ${toolCalls.map((t) => t.toolName).join(", ")}]`;
      }
      if (toolResults.length > 0) {
        text += `
[Received ${toolResults.length} tool result(s)]`;
      }
    }
    if (text.trim()) {
      const truncated = text.length > 2e3 ? text.slice(0, 2e3) + "..." : text;
      historyParts.push(`${role}: ${truncated}`);
    }
  }
  if (historyParts.length === 0) {
    return null;
  }
  return historyParts.join("\n\n");
}
function getClaudeUserMessage(prompt, includeHistoryContext = false, reasoningEffort) {
  const content = [];
  if (includeHistoryContext) {
    const historyContext = compactConversationHistory(prompt);
    if (historyContext) {
      log.info("including conversation history context", {
        historyLength: historyContext.length
      });
      content.push({
        type: "text",
        text: `<conversation_history>
The following is a summary of our conversation so far (from a previous session that couldn't be resumed):

${historyContext}

</conversation_history>

Now continuing with the current message:

`
      });
    }
  }
  const messages = [];
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === "assistant") break;
    messages.unshift(prompt[i]);
  }
  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        const str = msg.content;
        if (str.trim()) {
          content.push({ type: "text", text: str });
        }
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            if (part.text && part.text.trim()) {
              content.push({ type: "text", text: part.text });
            }
          } else if (part.type === "file" || part.type === "image") {
            const block = toImageBlock(part);
            if (block) {
              content.push(block);
            } else {
              log.debug("skipped non-image file part", {
                mediaType: part.mediaType
              });
            }
          } else if (part.type === "tool-result") {
            const p = part;
            content.push({
              type: "tool_result",
              tool_use_id: p.toolCallId,
              content: getToolResultText(p)
            });
          }
        }
      }
    }
  }
  if (content.length === 0) {
    log.warn("empty user content; sending sentinel to satisfy CLI");
    return JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "(empty)" }]
      }
    });
  }
  const keyword = reasoningKeyword(reasoningEffort);
  if (keyword) {
    const lastTextPart = [...content].reverse().find((p) => p.type === "text");
    if (lastTextPart) {
      lastTextPart.text = lastTextPart.text ? `${lastTextPart.text}

(${keyword})` : `(${keyword})`;
    } else {
      content.push({ type: "text", text: `(${keyword})` });
    }
    log.debug("injected reasoning keyword", { effort: reasoningEffort, keyword });
  }
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content
    }
  });
}

// src/mcp-bridge.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
var FILE_NAMES = ["opencode.jsonc", "opencode.json", "config.json"];
var PROJECT_FILE_NAMES = ["opencode.json", "opencode.jsonc"];
function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function stripJsonComments(text) {
  let out = "";
  let i = 0;
  let inString = null;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function readAndParse(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(stripJsonComments(raw));
  } catch (e) {
    log.warn("failed to parse opencode config", {
      file,
      error: e instanceof Error ? e.message : String(e)
    });
    return null;
  }
}
function isPlainObject(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v === void 0) continue;
    const existing = out[k];
    if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function walkUp(opts) {
  const out = [];
  let current = path.resolve(opts.start);
  while (true) {
    for (const target of opts.targets) {
      const candidate = path.join(current, target);
      if (opts.predicate(candidate)) out.push(candidate);
    }
    if (opts.stop && current === path.resolve(opts.stop)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return out;
}
function detectWorktree(cwd) {
  const override = process.env.OPENCODE_WORKTREE;
  if (override) return path.resolve(override);
  let current = path.resolve(cwd);
  while (true) {
    const gitPath = path.join(current, ".git");
    try {
      if (fs.existsSync(gitPath)) return current;
    } catch {
    }
    const parent = path.dirname(current);
    if (parent === current) return void 0;
    current = parent;
  }
}
function globalConfigDir() {
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "opencode");
}
function loadGlobalConfig() {
  const dir = globalConfigDir();
  let merged = {};
  for (const name of FILE_NAMES.slice().reverse()) {
    const file = path.join(dir, name);
    if (!fileExists(file)) continue;
    const parsed = readAndParse(file);
    if (parsed) merged = deepMerge(merged, parsed);
  }
  return merged;
}
function loadProjectFilesInDir(dir) {
  let merged = {};
  for (const name of PROJECT_FILE_NAMES) {
    const file = path.join(dir, name);
    if (!fileExists(file)) continue;
    const parsed = readAndParse(file);
    if (parsed) merged = deepMerge(merged, parsed);
  }
  return merged;
}
function dotOpencodeDirs(cwd, worktree) {
  const dirs = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (p) => {
    const abs = path.resolve(p);
    if (!seen.has(abs) && dirExists(abs)) {
      seen.add(abs);
      dirs.push(abs);
    }
  };
  for (const dir of walkUp({
    start: cwd,
    stop: worktree,
    targets: [".opencode"],
    predicate: dirExists
  })) {
    push(dir);
  }
  const home = os.homedir();
  if (home) {
    const homeDot = path.join(home, ".opencode");
    if (dirExists(homeDot)) push(homeDot);
  }
  const envDir = process.env.OPENCODE_CONFIG_DIR;
  if (envDir && dirExists(envDir)) push(envDir);
  return dirs;
}
function translateServer(name, spec) {
  if (spec.enabled === false) return null;
  const type = spec.type;
  if (type === "local") {
    const cmd = spec.command;
    if (!Array.isArray(cmd) || cmd.length === 0) {
      log.warn("skipping local MCP server with no command", { name });
      return null;
    }
    const out = {
      type: "stdio",
      command: String(cmd[0])
    };
    if (cmd.length > 1) out.args = cmd.slice(1).map((s) => String(s));
    if (spec.environment && typeof spec.environment === "object") {
      out.env = spec.environment;
    }
    return out;
  }
  if (type === "remote") {
    if (typeof spec.url !== "string" || !spec.url) {
      log.warn("skipping remote MCP server with no url", { name });
      return null;
    }
    const out = {
      type: "http",
      url: spec.url
    };
    if (spec.headers && typeof spec.headers === "object") {
      out.headers = spec.headers;
    }
    return out;
  }
  log.warn("skipping MCP server with unknown type", {
    name,
    type: type ?? null
  });
  return null;
}
function extractMcpBlock(config) {
  const mcp = config.mcp;
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return {};
  return mcp;
}
function mergeMcp(target, source) {
  const out = { ...target };
  for (const [name, spec] of Object.entries(source)) {
    if (!spec || typeof spec !== "object") continue;
    const existing = out[name];
    if (existing && typeof existing === "object") {
      out[name] = deepMerge(
        existing,
        spec
      );
    } else {
      out[name] = spec;
    }
  }
  return out;
}
function bridgeOpencodeMcp(cwd, runtimeStatus) {
  const worktree = detectWorktree(cwd);
  let merged = {};
  merged = mergeMcp(merged, extractMcpBlock(loadGlobalConfig()));
  const explicitConfig = process.env.OPENCODE_CONFIG;
  if (explicitConfig && fileExists(explicitConfig)) {
    const parsed = readAndParse(explicitConfig);
    if (parsed) merged = mergeMcp(merged, extractMcpBlock(parsed));
  }
  const projectFiles = walkUp({
    start: cwd,
    stop: worktree,
    targets: PROJECT_FILE_NAMES,
    predicate: fileExists
  });
  const projectDirs = [];
  const seenProjectDirs = /* @__PURE__ */ new Set();
  for (const f of projectFiles) {
    const d = path.dirname(f);
    if (!seenProjectDirs.has(d)) {
      seenProjectDirs.add(d);
      projectDirs.push(d);
    }
  }
  for (const dir of projectDirs.slice().reverse()) {
    merged = mergeMcp(merged, extractMcpBlock(loadProjectFilesInDir(dir)));
  }
  for (const dir of dotOpencodeDirs(cwd, worktree)) {
    merged = mergeMcp(merged, extractMcpBlock(loadProjectFilesInDir(dir)));
  }
  if (runtimeStatus) {
    for (const name of Object.keys(merged)) {
      const status = runtimeStatus[name];
      if (status === void 0) continue;
      const existing = merged[name];
      const base = existing && typeof existing === "object" ? existing : {};
      merged[name] = { ...base, enabled: status === "connected" };
    }
  }
  const servers = {};
  for (const [name, spec] of Object.entries(merged)) {
    if (!spec || typeof spec !== "object") continue;
    const translated = translateServer(name, spec);
    if (translated) servers[name] = translated;
  }
  if (Object.keys(servers).length === 0) return null;
  const body = JSON.stringify({ mcpServers: servers }, null, 2);
  const hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 12);
  const outPath = path.join(
    os.tmpdir(),
    `opencode-claude-code-mcp-${hash}.json`
  );
  try {
    if (!fileExists(outPath)) {
      fs.writeFileSync(outPath, body, { encoding: "utf8", mode: 384 });
    }
  } catch (e) {
    log.warn("failed to write bridged MCP config", {
      error: e instanceof Error ? e.message : String(e)
    });
    return null;
  }
  log.info("bridged opencode MCP config", {
    target: outPath,
    hash,
    servers: Object.keys(servers)
  });
  return { path: outPath, hash };
}

// src/runtime-status.ts
var opencodeClient = null;
function setOpencodeClient(client) {
  if (client && typeof client === "object") {
    opencodeClient = client;
  }
}
async function getRuntimeMcpStatus() {
  const client = opencodeClient;
  if (!client?.mcp?.status) return void 0;
  try {
    const res = await client.mcp.status();
    const data = res.data;
    if (!data || typeof data !== "object") return void 0;
    const out = {};
    for (const [name, entry] of Object.entries(data)) {
      if (entry && typeof entry === "object") {
        const status = entry.status;
        if (typeof status === "string") out[name] = status;
      }
    }
    return out;
  } catch (err) {
    log.warn("failed to fetch opencode MCP runtime status", {
      error: err instanceof Error ? err.message : String(err)
    });
    return void 0;
  }
}

// src/session-manager.ts
import { spawn } from "child_process";
import { createInterface } from "readline";
import { EventEmitter } from "events";
import { unlink } from "fs/promises";
var activeProcesses = /* @__PURE__ */ new Map();
var claudeSessions = /* @__PURE__ */ new Map();
var MAX_ACTIVE_PROCESSES = 16;
function touch(key) {
  const existing = activeProcesses.get(key);
  if (existing) {
    activeProcesses.delete(key);
    activeProcesses.set(key, existing);
  }
}
function evictIfNeeded() {
  while (activeProcesses.size >= MAX_ACTIVE_PROCESSES) {
    const oldestKey = activeProcesses.keys().next().value;
    if (!oldestKey) break;
    log.info("evicting LRU claude process", { sessionKey: oldestKey });
    deleteActiveProcess(oldestKey);
  }
}
function getActiveProcess(key) {
  const ap = activeProcesses.get(key);
  if (ap) touch(key);
  return ap;
}
function deleteActiveProcess(key) {
  const ap = activeProcesses.get(key);
  if (ap) {
    void ap.proxyServer?.close();
    ap.proc.kill();
    activeProcesses.delete(key);
  }
}
function getClaudeSessionId(key) {
  return claudeSessions.get(key);
}
function setClaudeSessionId(key, sessionId) {
  claudeSessions.set(key, sessionId);
}
function deleteClaudeSessionId(key) {
  claudeSessions.delete(key);
}
function spawnClaudeProcess(cliPath, cliArgs, cwd, sessionKey2, proxyServer, mcpHash, systemPromptFile) {
  evictIfNeeded();
  log.info("spawning new claude process", { cliPath, cliArgs, cwd, sessionKey: sessionKey2 });
  const proc = spawn(cliPath, cliArgs, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TERM: "xterm-256color" },
    shell: process.platform === "win32"
  });
  const lineEmitter = new EventEmitter();
  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    lineEmitter.emit("line", line);
  });
  rl.on("close", () => {
    lineEmitter.emit("close");
  });
  const ap = {
    proc,
    lineEmitter,
    proxyServer: proxyServer ?? null,
    mcpHash,
    systemPromptFile
  };
  activeProcesses.set(sessionKey2, ap);
  proc.on("error", (err) => {
    log.error("claude process error", { sessionKey: sessionKey2, error: err.message });
  });
  proc.on("exit", (code, signal) => {
    log.info("claude process exited", { code, signal, sessionKey: sessionKey2 });
    void proxyServer?.close();
    if (systemPromptFile) {
      void unlink(systemPromptFile).catch(() => {
      });
    }
    activeProcesses.delete(sessionKey2);
    if (code !== 0 && code !== null) {
      log.info("process exited with error, clearing session", {
        code,
        sessionKey: sessionKey2
      });
      claudeSessions.delete(sessionKey2);
    }
  });
  proc.stderr?.on("data", (data) => {
    const stderr = data.toString();
    log.debug("stderr", { data: stderr.slice(0, 200) });
    if (stderr.includes("Session ID") && (stderr.includes("already in use") || stderr.includes("not found") || stderr.includes("invalid"))) {
      log.warn("claude session ID error, clearing session", {
        sessionKey: sessionKey2,
        error: stderr.slice(0, 200)
      });
      claudeSessions.delete(sessionKey2);
    }
  });
  return ap;
}
function buildCliArgs(opts) {
  const {
    sessionKey: sessionKey2,
    skipPermissions,
    includeSessionId = true,
    model,
    permissionMode,
    mcpConfig,
    strictMcpConfig,
    disallowedTools,
    appendSystemPromptFile
  } = opts;
  const args = [
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose"
  ];
  if (model) {
    args.push("--model", model);
  }
  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }
  if (includeSessionId) {
    const sessionId = claudeSessions.get(sessionKey2);
    if (sessionId && !activeProcesses.has(sessionKey2)) {
      args.push("--session-id", sessionId);
    }
  }
  if (mcpConfig) {
    const configs = Array.isArray(mcpConfig) ? mcpConfig : [mcpConfig];
    const filtered = configs.filter((c) => typeof c === "string" && c.length > 0);
    if (filtered.length > 0) {
      args.push("--mcp-config", ...filtered);
    }
  }
  if (strictMcpConfig) {
    args.push("--strict-mcp-config");
  }
  if (disallowedTools && disallowedTools.length > 0) {
    args.push("--disallowedTools", ...disallowedTools);
  }
  if (appendSystemPromptFile) {
    args.push("--append-system-prompt-file", appendSystemPromptFile);
  }
  if (skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  return args;
}
function sessionKey(cwd, modelId) {
  return `${cwd}::${modelId}`;
}

// src/proxy-mcp.ts
import { createServer } from "http";
import * as fs2 from "fs";
import * as path2 from "path";
import * as os2 from "os";
import * as crypto2 from "crypto";
import { EventEmitter as EventEmitter2 } from "events";
var PROTOCOL_VERSION = "2024-11-05";
var SERVER_NAME = "opencode_proxy";
var PROXY_TOOL_PREFIX = `mcp__${SERVER_NAME}__`;
var DEFAULT_PROXY_TOOLS = [
  {
    name: "bash",
    description: "Execute a shell command. Routed through opencode's bash tool so permission prompts flow through opencode's UI.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute."
        },
        description: {
          type: "string",
          description: "Short human-readable description of what the command does."
        },
        timeout: {
          type: "number",
          description: "Optional timeout in milliseconds."
        }
      },
      required: ["command"]
    }
  },
  {
    name: "write",
    description: "Write a file. Routed through opencode's write tool so permission prompts flow through opencode's UI.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The file to write. Absolute paths are preferred."
        },
        content: {
          type: "string",
          description: "The full content to write to the file."
        }
      },
      required: ["filePath", "content"]
    }
  },
  {
    name: "edit",
    description: "Replace text in an existing file. Routed through opencode's edit tool so permission prompts flow through opencode's UI.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The file to edit. Absolute paths are preferred."
        },
        oldString: {
          type: "string",
          description: "The exact text to replace."
        },
        newString: {
          type: "string",
          description: "The replacement text."
        },
        replaceAll: {
          type: "boolean",
          description: "Replace all occurrences instead of just the first one."
        }
      },
      required: ["filePath", "oldString", "newString"]
    }
  },
  {
    name: "webfetch",
    description: "Fetch content from a URL. Routed through opencode's webfetch tool so permission prompts flow through opencode's UI. Returns the page content in the requested format.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch content from. Must start with http:// or https://."
        },
        format: {
          type: "string",
          enum: ["text", "markdown", "html"],
          description: "The format to return the content in. Defaults to markdown."
        },
        timeout: {
          type: "number",
          description: "Optional timeout in seconds (max 120)."
        }
      },
      required: ["url"]
    }
  }
];
async function createProxyMcpServer(tools = DEFAULT_PROXY_TOOLS) {
  const calls = new EventEmitter2();
  const pending = /* @__PURE__ */ new Map();
  const server2 = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/mcp")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    try {
      const body = await readBody(req);
      const request = JSON.parse(body);
      if (request?.jsonrpc !== "2.0" || typeof request.method !== "string") {
        writeJson(res, {
          jsonrpc: "2.0",
          id: request?.id ?? null,
          error: { code: -32600, message: "Invalid request" }
        });
        return;
      }
      log.debug("proxy-mcp request", {
        method: request.method,
        id: request.id
      });
      if (request.method === "initialize") {
        writeJson(res, {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: {
              name: SERVER_NAME,
              version: "0.1.0"
            }
          }
        });
        return;
      }
      if (request.method === "notifications/initialized") {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (request.method === "tools/list") {
        writeJson(res, {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema
            }))
          }
        });
        return;
      }
      if (request.method === "tools/call") {
        const params = request.params ?? {};
        const toolName = String(params.name ?? "");
        const input = params.arguments ?? {};
        if (!tools.some((t) => t.name === toolName)) {
          writeJson(res, {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: {
              code: -32601,
              message: `Unknown proxy tool: ${toolName}`
            }
          });
          return;
        }
        const callId = crypto2.randomUUID();
        log.info("proxy-mcp tool call received", {
          callId,
          toolName,
          hasInput: input != null
        });
        const result = await new Promise(
          (resolve3, reject) => {
            const entry = {
              id: callId,
              toolName,
              input,
              resolve: resolve3,
              reject
            };
            pending.set(callId, entry);
            calls.emit("call", entry);
          }
        ).finally(() => {
          pending.delete(callId);
        });
        if (result.kind === "error") {
          writeJson(res, {
            jsonrpc: "2.0",
            id: request.id ?? null,
            error: {
              code: -32e3,
              message: result.message
            }
          });
          return;
        }
        writeJson(res, {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            content: [{ type: "text", text: result.text }],
            isError: result.isError === true
          }
        });
        return;
      }
      writeJson(res, {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: { code: -32601, message: `Unknown method: ${request.method}` }
      });
    } catch (error) {
      log.warn("proxy-mcp error handling request", {
        error: error instanceof Error ? error.message : String(error)
      });
      try {
        writeJson(res, {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal error"
          }
        });
      } catch {
        try {
          res.statusCode = 500;
          res.end();
        } catch {
        }
      }
    }
  });
  await new Promise((resolve3, reject) => {
    server2.once("error", reject);
    server2.listen(0, "127.0.0.1", () => {
      server2.off("error", reject);
      resolve3();
    });
  });
  const addr = server2.address();
  if (!addr) {
    server2.close();
    throw new Error("Failed to bind proxy MCP server");
  }
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  log.info("proxy-mcp server started", {
    url,
    tools: tools.map((t) => t.name)
  });
  let configFilePath = null;
  const api = {
    url,
    serverName: SERVER_NAME,
    tools,
    calls,
    configPath() {
      if (configFilePath) return configFilePath;
      const body = JSON.stringify(
        {
          mcpServers: {
            [SERVER_NAME]: {
              type: "http",
              url
            }
          }
        },
        null,
        2
      );
      const hash = crypto2.createHash("sha256").update(body).digest("hex").slice(0, 12);
      const outPath = path2.join(
        os2.tmpdir(),
        `opencode-claude-code-proxy-${hash}.json`
      );
      fs2.writeFileSync(outPath, body, { encoding: "utf8", mode: 384 });
      configFilePath = outPath;
      return outPath;
    },
    async close() {
      for (const entry of pending.values()) {
        entry.reject(new Error("proxy MCP server closed"));
      }
      pending.clear();
      await new Promise((resolve3) => {
        server2.close(() => resolve3());
      });
    }
  };
  return api;
}
function disallowedToolFlags(tools) {
  const nameMap = {
    bash: "Bash",
    read: "Read",
    write: "Write",
    edit: "Edit",
    glob: "Glob",
    grep: "Grep",
    webfetch: "WebFetch"
  };
  const out = [];
  for (const t of tools) {
    const mapped = nameMap[t.name.toLowerCase()];
    if (mapped) out.push(mapped);
  }
  return out;
}
function readBody(req) {
  return new Promise((resolve3, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve3(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function writeJson(res, body) {
  const payload = JSON.stringify(body);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
  res.end(payload);
}

// src/proxy-broker.ts
import { EventEmitter as EventEmitter3 } from "events";
var pendingBySession = /* @__PURE__ */ new Map();
var emitter = new EventEmitter3();
function eventName(sessionKey2) {
  return `pending:${sessionKey2}`;
}
function onPendingProxyCall(sessionKey2, handler) {
  const name = eventName(sessionKey2);
  emitter.on(name, handler);
  return () => emitter.off(name, handler);
}
function queuePendingProxyCall(sessionKey2, call) {
  const existing = pendingBySession.get(sessionKey2);
  if (existing) {
    existing.reject(
      new Error(`Another proxy tool call is already pending for ${sessionKey2}`)
    );
    pendingBySession.delete(sessionKey2);
  }
  const pending = {
    sessionKey: sessionKey2,
    toolCallId: call.id,
    toolName: call.toolName,
    input: call.input,
    resolve: call.resolve,
    reject: call.reject
  };
  pendingBySession.set(sessionKey2, pending);
  emitter.emit(eventName(sessionKey2), pending);
  log.info("queued pending proxy call", {
    sessionKey: sessionKey2,
    toolCallId: call.id,
    toolName: call.toolName
  });
  return pending;
}
function getPendingProxyCall(sessionKey2) {
  return pendingBySession.get(sessionKey2);
}
function resolvePendingProxyCall(sessionKey2, result) {
  const pending = pendingBySession.get(sessionKey2);
  if (!pending) return false;
  pendingBySession.delete(sessionKey2);
  pending.resolve(result);
  log.info("resolved pending proxy call", {
    sessionKey: sessionKey2,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName
  });
  return true;
}

// src/claude-code-language-model.ts
import { readFileSync as readFileSync2, writeFileSync as writeFileSync3 } from "fs";
import { unlink as unlink2 } from "fs/promises";
import { homedir as homedir2, tmpdir as tmpdir3 } from "os";
import { randomUUID as randomUUID2 } from "crypto";
import { dirname as dirname2, join as join3 } from "path";
function readPromptFileIfPresent(path4) {
  try {
    const content = readFileSync2(path4, "utf8").trim();
    return content || void 0;
  } catch {
    return void 0;
  }
}
function nearestWorkspaceAgentsPrompt(cwd) {
  let dir = cwd;
  while (true) {
    const content = readPromptFileIfPresent(join3(dir, "AGENTS.md"));
    if (content) return content;
    const parent = dirname2(dir);
    if (parent === dir) return void 0;
    dir = parent;
  }
}
function buildAppendedSystemPrompt(cwd) {
  const parts = [];
  const configRoot = process.env.XDG_CONFIG_HOME ?? join3(homedir2(), ".config");
  const globalAgents = readPromptFileIfPresent(join3(configRoot, "opencode", "AGENTS.md"));
  const workspaceAgents = nearestWorkspaceAgentsPrompt(cwd);
  if (globalAgents) parts.push(globalAgents);
  if (workspaceAgents && workspaceAgents !== globalAgents) parts.push(workspaceAgents);
  const content = parts.join("\n\n");
  if (!content) return void 0;
  const path4 = join3(tmpdir3(), `opencode-cc-sys-${randomUUID2()}.md`);
  try {
    writeFileSync3(path4, content, "utf8");
    return path4;
  } catch (err) {
    log.warn("failed to write system prompt file", { error: String(err) });
    return void 0;
  }
}
var ClaudeCodeLanguageModel = class {
  specificationVersion = "v3";
  modelId;
  config;
  constructor(modelId, config) {
    this.modelId = modelId;
    this.config = config;
  }
  supportedUrls = {};
  get provider() {
    return this.config.provider;
  }
  toUsage(rawUsage) {
    const iter = rawUsage?.iterations;
    const effective = iter?.length ? iter[iter.length - 1] : rawUsage;
    const noCache = effective?.input_tokens ?? 0;
    const cacheRead = effective?.cache_read_input_tokens ?? 0;
    const cacheWrite = effective?.cache_creation_input_tokens ?? 0;
    return {
      inputTokens: {
        total: noCache + cacheRead + cacheWrite,
        noCache,
        cacheRead: cacheRead || void 0,
        cacheWrite: cacheWrite || void 0
      },
      outputTokens: {
        total: effective?.output_tokens,
        text: effective?.output_tokens,
        reasoning: void 0
      },
      raw: rawUsage
    };
  }
  toFinishReason(reason = "stop") {
    return {
      unified: reason,
      raw: reason
    };
  }
  requestScope(options) {
    const tools = options?.tools;
    if (Array.isArray(tools)) return "tools";
    if (tools && typeof tools === "object") {
      return Object.keys(tools).length > 0 ? "tools" : "no-tools";
    }
    return "no-tools";
  }
  /**
   * Build the combined `--mcp-config` list and return both the list and the
   * hash of the bridged opencode MCP block (or null when bridging is off /
   * yields nothing). The hash is used to detect mid-session config changes
   * and respawn the underlying claude process.
   *
   * `runtimeStatus` is a snapshot of opencode's `client.mcp.status()`. When
   * provided it overlays opencode's UI-toggled state on top of disk config
   * so `/mcps` toggles propagate without a config file write.
   */
  effectiveMcpConfig(cwd, proxyConfigPath, runtimeStatus) {
    const paths = Array.isArray(this.config.mcpConfig) ? this.config.mcpConfig.slice() : this.config.mcpConfig ? [this.config.mcpConfig] : [];
    let bridgedHash = null;
    if (this.config.bridgeOpencodeMcp !== false) {
      const bridged = bridgeOpencodeMcp(cwd, runtimeStatus);
      if (bridged) {
        paths.push(bridged.path);
        bridgedHash = bridged.hash;
      }
    }
    if (proxyConfigPath) paths.push(proxyConfigPath);
    return { paths, bridgedHash };
  }
  /** Resolve ProxyToolDef[] for the configured proxyTools names. */
  resolvedProxyTools() {
    const names = this.config.proxyTools;
    if (!names || names.length === 0) return null;
    const defsByName = new Map(
      DEFAULT_PROXY_TOOLS.map((t) => [t.name.toLowerCase(), t])
    );
    const picked = [];
    for (const n of names) {
      const def = defsByName.get(String(n).toLowerCase());
      if (def) picked.push(def);
    }
    return picked.length > 0 ? picked : null;
  }
  /**
   * Create a proxy MCP server for a single active Claude process/session.
   * The process lifecycle owns the server lifecycle via session-manager.
   */
  async ensureProxyServer(tools, sessionKeyForCalls) {
    const srv = await createProxyMcpServer(tools);
    srv.calls.on("call", (call) => {
      queuePendingProxyCall(sessionKeyForCalls, call);
    });
    return srv;
  }
  extractPendingProxyResult(prompt, toolCallId) {
    for (let i = prompt.length - 1; i >= 0; i--) {
      const msg = prompt[i];
      if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part.type !== "tool-result" || part.toolCallId !== toolCallId) continue;
        const output = part.output;
        if (!output || typeof output !== "object") {
          return {
            kind: "text",
            text: String(output ?? "")
          };
        }
        if (output.type === "text") {
          return {
            kind: "text",
            text: String(output.value ?? "")
          };
        }
        if (output.type === "json") {
          return {
            kind: "text",
            text: JSON.stringify(output.value)
          };
        }
        if (output.type === "content" && Array.isArray(output.value)) {
          const text = output.value.filter((v) => v?.type === "text" && typeof v.text === "string").map((v) => v.text).join("\n");
          return {
            kind: "text",
            text
          };
        }
        return {
          kind: "text",
          text: JSON.stringify(output)
        };
      }
    }
    return null;
  }
  /**
   * Opencode sets `x-session-affinity: <sessionID>` on LLM calls for
   * third-party providers (packages/opencode/src/session/llm.ts). Use it so
   * two chats in the same cwd+model get separate CLI processes instead of
   * stomping on each other. Falls back to "default" when absent (older
   * opencode, direct AI-SDK use, title synthesis paths, etc).
   */
  sessionAffinity(options) {
    const headers = options?.headers;
    if (!headers) return "default";
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "x-session-affinity") {
        const v = headers[key];
        if (typeof v === "string" && v.length > 0) return v;
      }
    }
    return "default";
  }
  controlRequestBehaviorForTool(toolName) {
    const configured = this.config.controlRequestToolBehaviors;
    if (configured && toolName) {
      const direct = configured[toolName] ?? configured[toolName.toLowerCase()];
      if (direct === "allow" || direct === "deny") return direct;
      const lower = toolName.toLowerCase();
      for (const [key, behavior] of Object.entries(configured)) {
        if (key.toLowerCase() === lower && (behavior === "allow" || behavior === "deny")) {
          return behavior;
        }
      }
    }
    return this.config.controlRequestBehavior ?? "allow";
  }
  writeControlResponse(proc, requestId, response) {
    const payload = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response
      }
    };
    try {
      proc.stdin?.write(JSON.stringify(payload) + "\n");
    } catch (error) {
      log.warn("failed to write control response", {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  /**
   * Handle Claude stream-json control requests (`can_use_tool`, etc.) and
   * respond via stdin with a matching `control_response`.
   */
  handleControlRequest(msg, proc) {
    if (msg.type !== "control_request") return false;
    const requestId = msg.request_id;
    const request = msg.request;
    if (!requestId || !request?.subtype) return false;
    if (request.subtype === "can_use_tool") {
      const toolName = request.tool_name ?? "unknown";
      const behavior = this.controlRequestBehaviorForTool(toolName);
      if (behavior === "allow") {
        this.writeControlResponse(proc, requestId, {
          behavior: "allow",
          updatedInput: request.input ?? {},
          toolUseID: request.tool_use_id
        });
        log.info("control request auto-allowed", {
          requestId,
          toolName
        });
      } else {
        this.writeControlResponse(proc, requestId, {
          behavior: "deny",
          message: this.config.controlRequestDenyMessage ?? `Denied by opencode-claude-code policy for tool ${toolName}`,
          toolUseID: request.tool_use_id
        });
        log.info("control request auto-denied", {
          requestId,
          toolName
        });
      }
      return true;
    }
    this.writeControlResponse(proc, requestId, {});
    log.debug("control request acknowledged", {
      requestId,
      subtype: request.subtype
    });
    return true;
  }
  getReasoningEffort(providerOptions) {
    if (!providerOptions) return void 0;
    const ownKey = this.config.provider;
    const bag = providerOptions[ownKey] ?? providerOptions["claude-code"];
    const effort = bag?.reasoningEffort;
    const valid = [
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ];
    return valid.includes(effort) ? effort : void 0;
  }
  latestUserText(prompt) {
    for (let i = prompt.length - 1; i >= 0; i--) {
      const msg = prompt[i];
      if (msg.role !== "user") continue;
      if (typeof msg.content === "string") {
        return String(msg.content).trim();
      }
      if (Array.isArray(msg.content)) {
        const text = msg.content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => String(part.text).trim()).filter(Boolean).join(" ");
        if (text) return text;
      }
    }
    return "";
  }
  synthesizeTitle(prompt) {
    const source = this.latestUserText(prompt).replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s-]/gu, " ").trim();
    if (!source) return "New Session";
    const stop = /* @__PURE__ */ new Set([
      "a",
      "an",
      "the",
      "and",
      "or",
      "but",
      "to",
      "for",
      "of",
      "in",
      "on",
      "at",
      "with",
      "can",
      "could",
      "would",
      "should",
      "please",
      "hi",
      "hello",
      "hey",
      "there",
      "you",
      "your",
      "this",
      "that",
      "is",
      "are",
      "was",
      "were",
      "be",
      "do",
      "does",
      "did",
      "summarize",
      "summary",
      "project"
    ]);
    const words = source.split(" ").map((word) => word.trim()).filter(Boolean).filter((word) => !stop.has(word.toLowerCase()));
    const picked = (words.length > 0 ? words : source.split(" ").filter(Boolean)).slice(0, 6).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    return picked || "New Session";
  }
  async doGenerateViaStream(options) {
    const result = await this.doStream(options);
    const reader = result.stream.getReader();
    let text = "";
    let reasoning = "";
    const toolCalls = [];
    let finishReason = this.toFinishReason("stop");
    let usage = this.toUsage();
    let providerMetadata;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      switch (value.type) {
        case "text-delta":
          text += value.delta ?? "";
          break;
        case "reasoning-delta":
          reasoning += value.delta ?? "";
          break;
        case "tool-call":
          toolCalls.push({
            type: "tool-call",
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            input: value.input,
            providerExecuted: value.providerExecuted
          });
          break;
        case "finish":
          finishReason = value.finishReason ?? finishReason;
          usage = value.usage ?? usage;
          providerMetadata = value.providerMetadata ?? providerMetadata;
          break;
      }
    }
    const content = [];
    if (reasoning) {
      content.push({ type: "reasoning", text: reasoning });
    }
    if (text) {
      content.push({ type: "text", text, providerMetadata });
    }
    content.push(...toolCalls);
    return {
      content,
      finishReason,
      usage,
      request: result.request,
      response: {
        id: generateId(),
        timestamp: /* @__PURE__ */ new Date(),
        modelId: this.modelId
      },
      providerMetadata,
      warnings: []
    };
  }
  async doGenerate(options) {
    const warnings = [];
    const cwd = this.config.cwd ?? process.cwd();
    const scope = this.requestScope(options);
    const affinity = this.sessionAffinity(options);
    const sk = sessionKey(cwd, `${this.modelId}::${scope}::${affinity}`);
    if (scope === "tools" && this.resolvedProxyTools()) {
      return this.doGenerateViaStream(options);
    }
    if (scope === "no-tools") {
      const text = this.synthesizeTitle(options.prompt);
      return {
        content: [{ type: "text", text }],
        finishReason: this.toFinishReason("stop"),
        usage: this.toUsage({ input_tokens: 0, output_tokens: 0 }),
        request: { body: { text: "" } },
        response: {
          id: generateId(),
          timestamp: /* @__PURE__ */ new Date(),
          modelId: this.modelId
        },
        providerMetadata: {
          "claude-code": {
            synthetic: true,
            path: "no-tools"
          }
        },
        warnings
      };
    }
    const hasPriorConversation = options.prompt.filter((m) => m.role === "user" || m.role === "assistant").length > 1;
    if (!hasPriorConversation) {
      deleteClaudeSessionId(sk);
      deleteActiveProcess(sk);
    }
    const hasExistingSession = !!getClaudeSessionId(sk);
    const includeHistoryContext = !hasExistingSession && hasPriorConversation;
    const reasoningEffort = this.getReasoningEffort(options.providerOptions);
    const userMsg = getClaudeUserMessage(
      options.prompt,
      includeHistoryContext,
      reasoningEffort
    );
    const runtimeStatus = await getRuntimeMcpStatus();
    const systemPromptFile = buildAppendedSystemPrompt(cwd);
    const cliArgs = buildCliArgs({
      sessionKey: sk,
      skipPermissions: this.config.skipPermissions !== false,
      includeSessionId: false,
      model: this.modelId,
      permissionMode: this.config.permissionMode,
      mcpConfig: this.effectiveMcpConfig(cwd, void 0, runtimeStatus).paths,
      strictMcpConfig: this.config.strictMcpConfig,
      disallowedTools: this.config.webSearch === "disabled" ? ["WebSearch"] : void 0,
      appendSystemPromptFile: systemPromptFile
    });
    log.info("doGenerate starting", {
      cwd,
      model: this.modelId,
      textLength: userMsg.length,
      includeHistoryContext
    });
    const { spawn: spawn2 } = await import("child_process");
    const { createInterface: createInterface2 } = await import("readline");
    const proc = spawn2(this.config.cliPath, cliArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" },
      shell: process.platform === "win32"
    });
    if (systemPromptFile) {
      proc.on("exit", () => {
        void unlink2(systemPromptFile).catch(() => {
        });
      });
    }
    const rl = createInterface2({ input: proc.stdout });
    let responseText = "";
    let thinkingText = "";
    let resultMeta = {};
    const toolCalls = [];
    const result = await new Promise((resolve3, reject) => {
      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          if (this.handleControlRequest(msg, proc)) {
            return;
          }
          if (msg.type === "system" && msg.subtype === "init") {
            if (msg.session_id) {
              setClaudeSessionId(sk, msg.session_id);
            }
          }
          if (msg.type === "assistant" && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === "text" && block.text) {
                responseText += block.text;
              }
              if (block.type === "thinking" && block.thinking) {
                thinkingText += block.thinking;
              }
              if (block.type === "tool_use" && block.id && block.name) {
                if (block.name === "AskUserQuestion" || block.name === "ask_user_question") {
                  const parsedInput = block.input ?? {};
                  const question = parsedInput?.question || "Question?";
                  responseText += `

_Asking: ${question}_

`;
                  continue;
                }
                if (block.name === "ExitPlanMode") {
                  const parsedInput = block.input ?? {};
                  const plan = parsedInput?.plan || "";
                  responseText += `

${plan}

---
**Do you want to proceed with this plan?** (yes/no)
`;
                  continue;
                }
                toolCalls.push({
                  id: block.id,
                  name: block.name,
                  args: block.input ?? {}
                });
              }
            }
          }
          if (msg.type === "content_block_start" && msg.content_block) {
            if (msg.content_block.type === "tool_use" && msg.content_block.id && msg.content_block.name) {
              toolCalls.push({
                id: msg.content_block.id,
                name: msg.content_block.name,
                args: {}
              });
            }
          }
          if (msg.type === "content_block_delta" && msg.delta) {
            if (msg.delta.type === "text_delta" && msg.delta.text) {
              responseText += msg.delta.text;
            }
            if (msg.delta.type === "thinking_delta" && msg.delta.thinking) {
              thinkingText += msg.delta.thinking;
            }
            if (msg.delta.type === "input_json_delta" && msg.delta.partial_json && msg.index !== void 0) {
              const tc = toolCalls[msg.index];
              if (tc) {
                try {
                  tc.args = JSON.parse(msg.delta.partial_json);
                } catch {
                }
              }
            }
          }
          if (msg.type === "result") {
            if (msg.session_id) {
              setClaudeSessionId(sk, msg.session_id);
            }
            if (!responseText && msg.is_error && typeof msg.result === "string" && msg.result.trim().length > 0) {
              responseText = msg.result;
            }
            resultMeta = {
              sessionId: msg.session_id,
              costUsd: msg.total_cost_usd,
              durationMs: msg.duration_ms,
              usage: msg.usage
            };
            resolve3({
              ...resultMeta,
              text: responseText,
              thinking: thinkingText,
              toolCalls
            });
          }
        } catch {
        }
      });
      rl.on("close", () => {
        resolve3({
          ...resultMeta,
          text: responseText,
          thinking: thinkingText,
          toolCalls
        });
      });
      proc.on("error", (err) => {
        log.error("process error", { error: err.message });
        reject(err);
      });
      proc.stderr?.on("data", (data) => {
        log.debug("stderr", { data: data.toString().slice(0, 200) });
      });
      proc.stdin?.write(userMsg + "\n");
    });
    const content = [];
    if (result.thinking) {
      content.push({
        type: "reasoning",
        text: result.thinking
      });
    }
    if (result.text) {
      content.push({
        type: "text",
        text: result.text,
        providerMetadata: {
          "claude-code": {
            sessionId: result.sessionId ?? null,
            costUsd: result.costUsd ?? null,
            durationMs: result.durationMs ?? null
          },
          ...typeof result.usage?.cache_creation_input_tokens === "number" ? {
            anthropic: {
              cacheCreationInputTokens: result.usage.cache_creation_input_tokens
            }
          } : {}
        }
      });
    }
    for (const tc of result.toolCalls) {
      const {
        name: mappedName,
        input: mappedInput,
        executed,
        skip
      } = mapTool(tc.name, tc.args, { webSearch: this.config.webSearch });
      if (skip) continue;
      content.push({
        type: "tool-call",
        toolCallId: tc.id,
        toolName: mappedName,
        input: JSON.stringify(mappedInput),
        providerExecuted: executed
      });
    }
    const usage = this.toUsage(result.usage);
    return {
      content,
      // Claude CLI's `result` message signals a fully-completed turn —
      // tools have already been executed internally and final assistant
      // text has been produced. Always report "stop" so opencode doesn't
      // loop expecting to run tools itself.
      finishReason: this.toFinishReason("stop"),
      usage,
      request: { body: { text: userMsg } },
      response: {
        id: result.sessionId ?? generateId(),
        timestamp: /* @__PURE__ */ new Date(),
        modelId: this.modelId
      },
      providerMetadata: {
        "claude-code": {
          sessionId: result.sessionId ?? null,
          costUsd: result.costUsd ?? null,
          durationMs: result.durationMs ?? null
        },
        ...typeof result.usage?.cache_creation_input_tokens === "number" ? {
          anthropic: {
            cacheCreationInputTokens: result.usage.cache_creation_input_tokens
          }
        } : {}
      },
      warnings
    };
  }
  async doStream(options) {
    const warnings = [];
    const cwd = this.config.cwd ?? process.cwd();
    const cliPath = this.config.cliPath;
    const skipPermissions = this.config.skipPermissions !== false;
    const scope = this.requestScope(options);
    const affinity = this.sessionAffinity(options);
    const sk = sessionKey(cwd, `${this.modelId}::${scope}::${affinity}`);
    const toUsage = this.toUsage.bind(this);
    const toFinishReason = this.toFinishReason.bind(this);
    const handleControlRequest = this.handleControlRequest.bind(this);
    if (scope === "no-tools") {
      const text = this.synthesizeTitle(options.prompt);
      const textId = generateId();
      const stream2 = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings });
          controller.enqueue({ type: "text-start", id: textId });
          controller.enqueue({
            type: "text-delta",
            id: textId,
            delta: text
          });
          controller.enqueue({ type: "text-end", id: textId });
          controller.enqueue({
            type: "finish",
            finishReason: toFinishReason("stop"),
            usage: toUsage({ input_tokens: 0, output_tokens: 0 }),
            providerMetadata: {
              "claude-code": {
                synthetic: true,
                path: "no-tools"
              }
            }
          });
          controller.close();
        }
      });
      return {
        stream: stream2,
        request: { body: { text: "" } }
      };
    }
    const hasPriorConversation = options.prompt.filter((m) => m.role === "user" || m.role === "assistant").length > 1;
    if (!hasPriorConversation) {
      deleteClaudeSessionId(sk);
      deleteActiveProcess(sk);
    }
    const hasExistingSession = !!getClaudeSessionId(sk);
    const hasActiveProcess = !!getActiveProcess(sk);
    const includeHistoryContext = !hasExistingSession && !hasActiveProcess && hasPriorConversation;
    const reasoningEffort = this.getReasoningEffort(options.providerOptions);
    const userMsg = getClaudeUserMessage(
      options.prompt,
      includeHistoryContext,
      reasoningEffort
    );
    const resolvedProxy = this.resolvedProxyTools();
    const self = this;
    const pendingProxyCall = getPendingProxyCall(sk);
    const pendingProxyResult = pendingProxyCall ? this.extractPendingProxyResult(options.prompt, pendingProxyCall.toolCallId) : null;
    const runtimeStatus = await getRuntimeMcpStatus();
    log.info("doStream starting", {
      cwd,
      model: this.modelId,
      textLength: userMsg.length,
      includeHistoryContext,
      hasActiveProcess,
      reasoningEffort,
      proxyTools: resolvedProxy?.map((t) => t.name) ?? null
    });
    const stream = new ReadableStream({
      start(controller) {
        let activeProcess = getActiveProcess(sk);
        let proc;
        let lineEmitter;
        let proxyServer = activeProcess?.proxyServer ?? null;
        if (activeProcess && self.config.hotReloadMcp !== false && self.config.bridgeOpencodeMcp !== false) {
          const probe = self.effectiveMcpConfig(cwd, void 0, runtimeStatus);
          const previousHash = activeProcess.mcpHash ?? null;
          if (previousHash !== probe.bridgedHash) {
            log.info("opencode MCP config changed, respawning claude", {
              sk,
              previousHash,
              currentHash: probe.bridgedHash
            });
            deleteActiveProcess(sk);
            activeProcess = void 0;
            proxyServer = null;
          }
        }
        const setup = async () => {
          if (!proxyServer && resolvedProxy) {
            proxyServer = await self.ensureProxyServer(resolvedProxy, sk);
          }
          const proxyDisallowed = resolvedProxy ? disallowedToolFlags(resolvedProxy) : [];
          const extraDisallowed = [];
          if (self.config.webSearch === "disabled") extraDisallowed.push("WebSearch");
          const allDisallowed = [...proxyDisallowed, ...extraDisallowed];
          const mcp = self.effectiveMcpConfig(
            cwd,
            proxyServer?.configPath(),
            runtimeStatus
          );
          const systemPromptFile = activeProcess ? void 0 : buildAppendedSystemPrompt(cwd);
          const cliArgs = buildCliArgs({
            sessionKey: sk,
            skipPermissions,
            model: self.modelId,
            permissionMode: self.config.permissionMode,
            mcpConfig: mcp.paths,
            strictMcpConfig: self.config.strictMcpConfig,
            disallowedTools: allDisallowed.length > 0 ? allDisallowed : void 0,
            appendSystemPromptFile: systemPromptFile
          });
          if (activeProcess) {
            proc = activeProcess.proc;
            lineEmitter = activeProcess.lineEmitter;
            log.debug("reusing active process", { sk });
          } else {
            const ap = spawnClaudeProcess(
              cliPath,
              cliArgs,
              cwd,
              sk,
              proxyServer,
              mcp.bridgedHash,
              systemPromptFile
            );
            proc = ap.proc;
            lineEmitter = ap.lineEmitter;
            activeProcess = ap;
          }
          controller.enqueue({ type: "stream-start", warnings });
          let currentTextId = null;
          const textBlockIndices = /* @__PURE__ */ new Set();
          const startTextBlock = () => {
            if (currentTextId) {
              controller.enqueue({ type: "text-end", id: currentTextId });
            }
            const id = generateId();
            currentTextId = id;
            controller.enqueue({ type: "text-start", id });
            return id;
          };
          const endTextBlock = () => {
            if (currentTextId) {
              controller.enqueue({ type: "text-end", id: currentTextId });
              currentTextId = null;
            }
          };
          const reasoningIds = /* @__PURE__ */ new Map();
          const reasoningStarted = /* @__PURE__ */ new Map();
          let turnCompleted = false;
          let controllerClosed = false;
          let pendingProxyUnsubscribe = null;
          let resultFallbackTimer = null;
          let hasReceivedContent = false;
          const clearFallbackTimer = () => {
            if (resultFallbackTimer) {
              clearTimeout(resultFallbackTimer);
              resultFallbackTimer = null;
            }
          };
          const startResultFallback = () => {
            clearFallbackTimer();
            if (!hasReceivedContent || controllerClosed) return;
            resultFallbackTimer = setTimeout(() => {
              if (controllerClosed) return;
              log.warn("result fallback timer fired \u2014 closing stream without result event");
              closeHandler();
            }, 5e3);
          };
          const toolCallMap = /* @__PURE__ */ new Map();
          const skipResultForIds = /* @__PURE__ */ new Set();
          const toolCallsById = /* @__PURE__ */ new Map();
          let resultMeta = {};
          const finishWithToolCall = (call) => {
            if (controllerClosed) return;
            controller.enqueue({
              type: "tool-input-start",
              id: call.toolCallId,
              toolName: call.toolName
            });
            controller.enqueue({
              type: "tool-call",
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: JSON.stringify(call.input),
              providerExecuted: false
            });
            skipResultForIds.add(call.toolCallId);
            controller.enqueue({
              type: "finish",
              finishReason: toFinishReason("tool-calls"),
              usage: toUsage(resultMeta.usage),
              providerMetadata: {
                "claude-code": resultMeta
              }
            });
            controllerClosed = true;
            cleanupTurn();
            try {
              controller.close();
            } catch {
            }
          };
          const lineHandler = (line) => {
            if (!line.trim()) return;
            if (controllerClosed) return;
            try {
              const msg = JSON.parse(line);
              if (handleControlRequest(msg, proc)) {
                return;
              }
              log.debug("stream message", {
                type: msg.type,
                subtype: msg.subtype
              });
              if (msg.type === "system" && msg.subtype === "init") {
                if (msg.session_id) {
                  setClaudeSessionId(sk, msg.session_id);
                  log.info("session initialized", {
                    claudeSessionId: msg.session_id
                  });
                }
              }
              if (msg.type === "content_block_start" && msg.content_block && msg.index !== void 0) {
                const block = msg.content_block;
                const idx = msg.index;
                if (block.type === "thinking") {
                  const reasoningId = generateId();
                  reasoningIds.set(idx, reasoningId);
                  controller.enqueue({
                    type: "reasoning-start",
                    id: reasoningId
                  });
                  reasoningStarted.set(idx, true);
                }
                if (block.type === "text") {
                  clearFallbackTimer();
                  textBlockIndices.add(idx);
                  if (block.text) {
                    if (!currentTextId) startTextBlock();
                    controller.enqueue({
                      type: "text-delta",
                      id: currentTextId,
                      delta: block.text
                    });
                    hasReceivedContent = true;
                  }
                }
                if (block.type === "tool_use" && block.id && block.name) {
                  clearFallbackTimer();
                  toolCallMap.set(idx, {
                    id: block.id,
                    name: block.name,
                    inputJson: ""
                  });
                  if (block.name !== "AskUserQuestion" && block.name !== "ask_user_question" && block.name !== "ExitPlanMode" && !block.name.startsWith(PROXY_TOOL_PREFIX)) {
                    const { name: mappedName, skip, executed } = mapTool(
                      block.name,
                      void 0,
                      { webSearch: self.config.webSearch }
                    );
                    if (!skip) {
                      controller.enqueue({
                        type: "tool-input-start",
                        id: block.id,
                        toolName: mappedName,
                        providerExecuted: executed
                      });
                      log.info("tool started", {
                        name: block.name,
                        mappedName,
                        id: block.id
                      });
                    }
                  }
                }
              }
              if (msg.type === "content_block_delta" && msg.delta && msg.index !== void 0) {
                const delta = msg.delta;
                const idx = msg.index;
                if (delta.type === "thinking_delta" && delta.thinking) {
                  const reasoningId = reasoningIds.get(idx);
                  if (reasoningId) {
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: reasoningId,
                      delta: delta.thinking
                    });
                  }
                }
                if (delta.type === "text_delta" && delta.text) {
                  if (!currentTextId) startTextBlock();
                  controller.enqueue({
                    type: "text-delta",
                    id: currentTextId,
                    delta: delta.text
                  });
                  hasReceivedContent = true;
                }
                if (delta.type === "input_json_delta" && delta.partial_json) {
                  const tc = toolCallMap.get(idx);
                  if (tc) {
                    tc.inputJson += delta.partial_json;
                    controller.enqueue({
                      type: "tool-input-delta",
                      id: tc.id,
                      delta: delta.partial_json
                    });
                  }
                }
              }
              if (msg.type === "content_block_stop" && msg.index !== void 0) {
                const idx = msg.index;
                const reasoningId = reasoningIds.get(idx);
                if (reasoningId && reasoningStarted.get(idx)) {
                  controller.enqueue({
                    type: "reasoning-end",
                    id: reasoningId
                  });
                  reasoningStarted.delete(idx);
                }
                if (textBlockIndices.has(idx)) {
                  endTextBlock();
                  textBlockIndices.delete(idx);
                  startResultFallback();
                }
                const tc = toolCallMap.get(idx);
                if (tc) {
                  let parsedInput = {};
                  try {
                    parsedInput = JSON.parse(tc.inputJson || "{}");
                  } catch {
                  }
                  if (tc.name === "AskUserQuestion" || tc.name === "ask_user_question") {
                    let question = "Question?";
                    if (parsedInput?.questions && Array.isArray(parsedInput.questions) && parsedInput.questions.length > 0) {
                      question = parsedInput.questions[0].question || parsedInput.questions[0].text || "Question?";
                    } else {
                      question = parsedInput?.question || parsedInput?.text || "Question?";
                    }
                    const askId = startTextBlock();
                    controller.enqueue({
                      type: "text-delta",
                      id: askId,
                      delta: `

_Asking: ${question}_

`
                    });
                    endTextBlock();
                  } else if (tc.name === "ExitPlanMode") {
                    const plan = parsedInput?.plan || "";
                    const planId = startTextBlock();
                    controller.enqueue({
                      type: "text-delta",
                      id: planId,
                      delta: `

${plan}

---
**Do you want to proceed with this plan?** (yes/no)
`
                    });
                    endTextBlock();
                  } else if (tc.name.startsWith(PROXY_TOOL_PREFIX)) {
                    log.debug("ignoring proxy tool_use block; broker handles it", {
                      name: tc.name,
                      id: tc.id
                    });
                  } else {
                    const {
                      name: mappedName,
                      input: mappedInput,
                      executed,
                      skip
                    } = mapTool(tc.name, parsedInput, { webSearch: self.config.webSearch });
                    if (!skip) {
                      toolCallsById.set(tc.id, {
                        id: tc.id,
                        name: tc.name,
                        input: parsedInput
                      });
                      if (!executed) skipResultForIds.add(tc.id);
                      controller.enqueue({
                        type: "tool-call",
                        toolCallId: tc.id,
                        toolName: mappedName,
                        input: JSON.stringify(mappedInput),
                        providerExecuted: executed
                      });
                    }
                    log.info("tool call complete", {
                      name: tc.name,
                      mappedName,
                      id: tc.id,
                      executed
                    });
                  }
                }
              }
              if (msg.type === "assistant" && msg.message?.content) {
                const hasText = msg.message.content.some(
                  (b) => b.type === "text" && b.text
                );
                const hasToolUse = msg.message.content.some(
                  (b) => b.type === "tool_use"
                );
                if (hasText) {
                  hasReceivedContent = true;
                }
                if (hasText && !hasToolUse) {
                  startResultFallback();
                }
                if (hasToolUse) {
                  clearFallbackTimer();
                }
                for (const block of msg.message.content) {
                  if (block.type === "text" && block.text) {
                    const blockId = startTextBlock();
                    controller.enqueue({
                      type: "text-delta",
                      id: blockId,
                      delta: block.text
                    });
                    endTextBlock();
                    hasReceivedContent = true;
                  }
                  if (block.type === "thinking" && block.thinking) {
                    const thinkingId = generateId();
                    controller.enqueue({
                      type: "reasoning-start",
                      id: thinkingId
                    });
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: thinkingId,
                      delta: block.thinking
                    });
                    controller.enqueue({
                      type: "reasoning-end",
                      id: thinkingId
                    });
                  }
                  if (block.type === "tool_use" && block.id && block.name) {
                    const parsedInput = block.input ?? {};
                    toolCallsById.set(block.id, {
                      id: block.id,
                      name: block.name,
                      input: parsedInput
                    });
                    if (block.name === "AskUserQuestion" || block.name === "ask_user_question") {
                      let question = "Question?";
                      if (parsedInput?.questions && Array.isArray(parsedInput.questions) && parsedInput.questions.length > 0) {
                        const q = parsedInput.questions[0];
                        question = q.question || q.text || "Question?";
                      } else {
                        question = parsedInput?.question || parsedInput?.text || "Question?";
                      }
                      const askId = startTextBlock();
                      controller.enqueue({
                        type: "text-delta",
                        id: askId,
                        delta: `

_Asking: ${question}_

`
                      });
                      endTextBlock();
                    } else if (block.name === "ExitPlanMode") {
                      const plan = parsedInput?.plan || "";
                      const planId = startTextBlock();
                      controller.enqueue({
                        type: "text-delta",
                        id: planId,
                        delta: `

${plan}

---
**Do you want to proceed with this plan?** (yes/no)
`
                      });
                      endTextBlock();
                    } else if (block.name.startsWith(PROXY_TOOL_PREFIX)) {
                      log.debug("ignoring proxy tool_use from assistant message", {
                        name: block.name,
                        id: block.id
                      });
                    } else {
                      const {
                        name: mappedName,
                        input: mappedInput,
                        executed,
                        skip
                      } = mapTool(block.name, parsedInput, { webSearch: self.config.webSearch });
                      if (!skip) {
                        if (!executed) skipResultForIds.add(block.id);
                        controller.enqueue({
                          type: "tool-input-start",
                          id: block.id,
                          toolName: mappedName,
                          providerExecuted: executed
                        });
                        controller.enqueue({
                          type: "tool-call",
                          toolCallId: block.id,
                          toolName: mappedName,
                          input: JSON.stringify(mappedInput),
                          providerExecuted: executed
                        });
                      }
                      log.info("tool_use from assistant message", {
                        name: block.name,
                        mappedName,
                        id: block.id,
                        executed
                      });
                    }
                  }
                  if (block.type === "tool_result") {
                    log.debug("tool_result", {
                      toolUseId: block.tool_use_id
                    });
                  }
                }
              }
              if (msg.type === "user" && msg.message?.content) {
                for (const block of msg.message.content) {
                  if (block.type === "tool_result" && block.tool_use_id) {
                    if (skipResultForIds.has(block.tool_use_id)) {
                      log.debug("skipping tool-result (opencode runs it)", {
                        toolUseId: block.tool_use_id
                      });
                      continue;
                    }
                    const toolCall = toolCallsById.get(block.tool_use_id);
                    if (toolCall) {
                      let resultText = "";
                      if (typeof block.content === "string") {
                        resultText = block.content;
                      } else if (Array.isArray(block.content)) {
                        resultText = block.content.filter(
                          (c) => c.type === "text" && typeof c.text === "string"
                        ).map((c) => c.text).join("\n");
                      }
                      controller.enqueue({
                        type: "tool-result",
                        toolCallId: block.tool_use_id,
                        toolName: toolCall.name,
                        result: {
                          output: resultText,
                          title: toolCall.name,
                          metadata: {}
                        },
                        providerExecuted: true
                      });
                      log.info("tool result emitted", {
                        toolUseId: block.tool_use_id,
                        name: toolCall.name
                      });
                      toolCallsById.delete(block.tool_use_id);
                    }
                  }
                }
              }
              if (msg.type === "result") {
                clearFallbackTimer();
                if (msg.session_id) {
                  setClaudeSessionId(sk, msg.session_id);
                }
                if (!currentTextId && msg.is_error && typeof msg.result === "string" && msg.result.trim().length > 0) {
                  const errId = startTextBlock();
                  controller.enqueue({
                    type: "text-delta",
                    id: errId,
                    delta: msg.result
                  });
                }
                resultMeta = {
                  sessionId: msg.session_id,
                  costUsd: msg.total_cost_usd,
                  durationMs: msg.duration_ms,
                  usage: msg.usage
                };
                log.info("conversation result", {
                  sessionId: msg.session_id,
                  durationMs: msg.duration_ms,
                  numTurns: msg.num_turns,
                  isError: msg.is_error
                });
                turnCompleted = true;
                endTextBlock();
                for (const [idx, reasoningId] of reasoningIds) {
                  if (reasoningStarted.get(idx)) {
                    controller.enqueue({
                      type: "reasoning-end",
                      id: reasoningId
                    });
                  }
                }
                controller.enqueue({
                  type: "finish",
                  finishReason: toFinishReason("stop"),
                  usage: toUsage(msg.usage),
                  providerMetadata: {
                    "claude-code": resultMeta,
                    ...typeof msg.usage?.cache_creation_input_tokens === "number" ? {
                      anthropic: {
                        cacheCreationInputTokens: msg.usage.cache_creation_input_tokens
                      }
                    } : {}
                  }
                });
                controllerClosed = true;
                cleanupTurn();
                try {
                  controller.close();
                } catch {
                }
              }
            } catch (e) {
              log.debug("failed to parse line", {
                error: e instanceof Error ? e.message : String(e)
              });
            }
          };
          const closeHandler = () => {
            log.debug("readline closed");
            if (controllerClosed) return;
            controllerClosed = true;
            cleanupTurn();
            endTextBlock();
            controller.enqueue({
              type: "finish",
              finishReason: toFinishReason("stop"),
              usage: toUsage(),
              providerMetadata: {
                "claude-code": resultMeta
              }
            });
            try {
              controller.close();
            } catch {
            }
          };
          let cleanedUp = false;
          const cleanupTurn = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            clearFallbackTimer();
            lineEmitter.off("line", lineHandler);
            lineEmitter.off("close", closeHandler);
            pendingProxyUnsubscribe?.();
            pendingProxyUnsubscribe = null;
            proc.off("error", procErrorHandler);
          };
          const procErrorHandler = (err) => {
            log.error("process error", { error: err.message });
            if (controllerClosed) return;
            controllerClosed = true;
            cleanupTurn();
            controller.enqueue({ type: "error", error: err });
            try {
              controller.close();
            } catch {
            }
          };
          lineEmitter.on("line", lineHandler);
          lineEmitter.on("close", closeHandler);
          pendingProxyUnsubscribe = onPendingProxyCall(sk, (call) => {
            log.info("received pending proxy call for session", {
              sessionKey: sk,
              toolCallId: call.toolCallId,
              toolName: call.toolName
            });
            finishWithToolCall(call);
          });
          proc.on("error", procErrorHandler);
          if (options.abortSignal) {
            options.abortSignal.addEventListener("abort", () => {
              if (turnCompleted || controllerClosed) return;
              if (!hasReceivedContent) {
                log.info(
                  "abort signal received before content, closing stream immediately",
                  { cwd }
                );
                controllerClosed = true;
                cleanupTurn();
                try {
                  controller.close();
                } catch {
                }
                return;
              }
              log.info(
                "abort signal received mid-turn, starting grace period",
                { cwd }
              );
              startResultFallback();
            });
          }
          if (pendingProxyCall && pendingProxyResult) {
            log.info("resolving pending proxy call from tool result prompt", {
              sessionKey: sk,
              toolCallId: pendingProxyCall.toolCallId,
              toolName: pendingProxyCall.toolName
            });
            const resolved = resolvePendingProxyCall(sk, pendingProxyResult);
            if (!resolved) {
              log.warn("failed to resolve pending proxy call; no pending state", {
                sessionKey: sk,
                toolCallId: pendingProxyCall.toolCallId
              });
            }
            return;
          }
          proc.stdin?.write(userMsg + "\n");
          log.debug("sent user message", { textLength: userMsg.length });
        };
        void setup().catch((err) => {
          log.error("failed to set up doStream", {
            error: err instanceof Error ? err.message : String(err)
          });
          controller.enqueue({
            type: "error",
            error: err instanceof Error ? err : new Error(String(err))
          });
          try {
            controller.close();
          } catch {
          }
        });
      },
      cancel() {
      }
    });
    return {
      stream,
      request: { body: { text: userMsg } },
      response: { headers: {} }
    };
  }
};

// src/models.ts
var PROVIDER_ID = "claude-code";
var NPM = "@khalilgharbaoui/opencode-claude-code-plugin";
var reasoningVariants = {
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  xhigh: { reasoningEffort: "xhigh" },
  max: { reasoningEffort: "max" }
};
var baseCapabilities = {
  temperature: false,
  attachment: true,
  toolcall: true,
  input: { text: true, audio: false, image: true, video: false, pdf: false },
  output: { text: true, audio: false, image: false, video: false, pdf: false },
  interleaved: false
};
function defineModel(opts) {
  return {
    id: opts.id,
    providerID: PROVIDER_ID,
    api: { id: opts.id, url: "", npm: NPM },
    name: opts.name,
    family: opts.family,
    capabilities: { ...baseCapabilities, reasoning: opts.reasoning },
    cost: {
      input: opts.cost.input,
      output: opts.cost.output,
      cache: { read: opts.cost.cacheRead, write: opts.cost.cacheWrite }
    },
    limit: { context: opts.context, output: opts.output },
    status: opts.status ?? "active",
    options: {},
    headers: {},
    release_date: opts.releaseDate,
    variants: opts.reasoning ? reasoningVariants : void 0
  };
}
var haikuCost = { input: 1e-6, output: 5e-6, cacheRead: 1e-7, cacheWrite: 125e-8 };
var sonnetCost = { input: 3e-6, output: 15e-6, cacheRead: 3e-7, cacheWrite: 375e-8 };
var opusCost = { input: 15e-6, output: 75e-6, cacheRead: 15e-7, cacheWrite: 1875e-8 };
function toConfigModel(model) {
  const inputMods = [];
  const outputMods = [];
  for (const [k, v] of Object.entries(model.capabilities.input)) {
    if (v) inputMods.push(k);
  }
  for (const [k, v] of Object.entries(model.capabilities.output)) {
    if (v) outputMods.push(k);
  }
  return {
    id: model.api.id,
    name: model.name,
    status: model.status,
    family: model.family ?? "",
    release_date: model.release_date,
    temperature: model.capabilities.temperature,
    reasoning: model.capabilities.reasoning,
    attachment: model.capabilities.attachment,
    tool_call: model.capabilities.toolcall,
    modalities: { input: inputMods, output: outputMods },
    interleaved: model.capabilities.interleaved,
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cache_read: model.cost.cache.read,
      cache_write: model.cost.cache.write
    },
    limit: model.limit,
    options: model.options,
    headers: model.headers,
    variants: model.variants
  };
}
var defaultModels = {
  "claude-haiku-4-5": defineModel({
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    family: "haiku",
    reasoning: false,
    context: 2e5,
    output: 8192,
    cost: haikuCost,
    releaseDate: "2024-10-22"
  }),
  "claude-sonnet-4-5": defineModel({
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    family: "sonnet",
    reasoning: true,
    context: 1e6,
    output: 16384,
    cost: sonnetCost,
    releaseDate: "2025-04-14"
  }),
  "claude-sonnet-4-6": defineModel({
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    family: "sonnet",
    reasoning: true,
    context: 1e6,
    output: 16384,
    cost: sonnetCost,
    releaseDate: "2025-06-19"
  }),
  "claude-opus-4-5": defineModel({
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    family: "opus",
    reasoning: true,
    context: 1e6,
    output: 16384,
    cost: opusCost,
    releaseDate: "2025-04-14"
  }),
  "claude-opus-4-6": defineModel({
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    family: "opus",
    reasoning: true,
    context: 1e6,
    output: 16384,
    cost: opusCost,
    releaseDate: "2025-06-19"
  }),
  "claude-opus-4-7": defineModel({
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    family: "opus",
    reasoning: true,
    context: 1e6,
    output: 16384,
    cost: opusCost,
    releaseDate: "2025-07-16"
  })
};

// src/accounts.ts
import { chmod, lstat, mkdir, readlink, symlink, writeFile } from "fs/promises";
import path3 from "path";
var BASE_PROVIDER_ID = "claude-code";
var DEFAULT_ACCOUNT = "default";
var SHARED_CAPABILITY_ITEMS = [
  "CLAUDE.md",
  "settings.json",
  "skills",
  "agents",
  "commands",
  "plugins"
];
function normalizeAccountName(account) {
  return account.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function resolveAccounts(value) {
  if (!Array.isArray(value)) return null;
  const accounts = value.map((account) => normalizeAccountName(String(account))).filter(Boolean);
  return Array.from(/* @__PURE__ */ new Set([DEFAULT_ACCOUNT, ...accounts]));
}
function accountProviderId(account) {
  return `${BASE_PROVIDER_ID}-${normalizeAccountName(account)}`;
}
function accountDisplayName(account) {
  return `Claude Code (${titleizeAccount(account)})`;
}
function accountModelSuffix(account) {
  const normalized = normalizeAccountName(account);
  return normalized === DEFAULT_ACCOUNT ? void 0 : normalized;
}
function accountConfigDir(account) {
  const normalized = normalizeAccountName(account);
  if (!normalized || normalized === DEFAULT_ACCOUNT) return void 0;
  return `~/.claude-${normalized}`;
}
function expandHome(value) {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (value === "~") return home ?? value;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return home ? path3.join(home, value.slice(2)) : value;
  }
  return value;
}
async function ensureAccountRuntime(account, baseCliPath) {
  const configDir = accountConfigDir(account);
  if (!configDir) return { cliPath: baseCliPath };
  const expandedConfigDir = expandHome(configDir);
  await mkdir(expandedConfigDir, { recursive: true });
  try {
    await ensureSharedCapabilities(expandedConfigDir);
  } catch (err) {
    log.warn("failed to symlink shared capabilities; continuing anyway", {
      account,
      configDir: expandedConfigDir,
      error: String(err)
    });
  }
  const cliPath = await writeAccountWrapper(
    normalizeAccountName(account),
    baseCliPath,
    expandedConfigDir
  );
  return { cliPath, configDir };
}
async function ensureSharedCapabilities(targetRoot) {
  const sourceRoot = expandHome("~/.claude");
  for (const item of SHARED_CAPABILITY_ITEMS) {
    await ensureSharedCapabilityItem(sourceRoot, targetRoot, item);
  }
}
async function ensureSharedCapabilityItem(sourceRoot, targetRoot, item) {
  const source = path3.join(sourceRoot, item);
  const target = path3.join(targetRoot, item);
  let sourceStat;
  try {
    sourceStat = await lstat(source);
  } catch {
    return;
  }
  try {
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink()) {
      const current = await readlink(target);
      const resolvedCurrent = path3.resolve(path3.dirname(target), current);
      const resolvedSource = path3.resolve(source);
      if (resolvedCurrent === resolvedSource) return;
    }
    log.warn("shared Claude capability already exists; leaving untouched", {
      item,
      target,
      source
    });
    return;
  } catch {
  }
  const type = sourceStat.isDirectory() ? process.platform === "win32" ? "junction" : "dir" : "file";
  await symlink(source, target, type);
}
async function writeAccountWrapper(account, baseCliPath, configDir) {
  const cacheRoot = path3.join(
    process.env.XDG_CACHE_HOME ?? expandHome("~/.cache"),
    "opencode-claude-code-plugin"
  );
  const wrapperPath = path3.join(cacheRoot, `claude-${account}`);
  const suffix = `@${account}`;
  await mkdir(cacheRoot, { recursive: true });
  const script = `#!/usr/bin/env bash
set -euo pipefail

args=()
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--model" && $# -ge 2 ]]; then
    model="$2"
    if [[ "$model" == *${shellDoubleQuote(suffix)} ]]; then
      model="\${model%${shellDoubleQuote(suffix)}}"
    fi
    args+=("$1" "$model")
    shift 2
  else
    args+=("$1")
    shift
  fi
done

export CLAUDE_CONFIG_DIR=${shellSingleQuote(configDir)}
exec ${shellSingleQuote(baseCliPath)} "\${args[@]}"
`;
  await writeFile(wrapperPath, script, "utf8");
  await chmod(wrapperPath, 493);
  return wrapperPath;
}
function shellSingleQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function shellDoubleQuote(value) {
  return value.replace(/[$`"\\]/g, "\\$&");
}
function titleizeAccount(account) {
  return normalizeAccountName(account).split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

// src/cleanup-stale.ts
import {
  existsSync as existsSync2,
  readFileSync as readFileSync3,
  realpathSync,
  rmSync,
  writeFileSync as writeFileSync4
} from "fs";
import { homedir as homedir3 } from "os";
import { join as join4, resolve as resolve2 } from "path";
import { fileURLToPath } from "url";
var STALE_PACKAGE_NAME = "opencode-claude-code-plugin";
var SUSPECT_DESCRIPTION_TOKEN = "Claude Code";
var alreadyRan = false;
function candidateCacheRoots() {
  const xdg = process.env.XDG_CACHE_HOME;
  return [
    xdg ? join4(xdg, "opencode") : null,
    join4(homedir3(), ".cache", "opencode"),
    join4(homedir3(), "Library", "Caches", "opencode")
  ].filter((p) => Boolean(p));
}
function userOpencodeJsonPath() {
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join4(homedir3(), ".config");
  return join4(xdgConfig, "opencode", "opencode.json");
}
function userIntendsToUseUnscoped() {
  const cfg = userOpencodeJsonPath();
  if (!existsSync2(cfg)) return false;
  try {
    const json = JSON.parse(readFileSync3(cfg, "utf8"));
    const plugins = json.plugin;
    if (!Array.isArray(plugins)) return false;
    return plugins.some(
      (entry) => typeof entry === "string" && /^opencode-claude-code-plugin(@[^/]+)?$/.test(entry)
    );
  } catch {
    return false;
  }
}
function ourLoadedDir() {
  try {
    const filePath = fileURLToPath(import.meta.url);
    return realpathSync(resolve2(filePath, "..", ".."));
  } catch {
    return null;
  }
}
function cleanupStaleUnscopedInstall() {
  if (alreadyRan) return;
  alreadyRan = true;
  if (process.env.OPENCODE_CLAUDE_CODE_PLUGIN_NO_CLEANUP === "1") return;
  if (userIntendsToUseUnscoped()) return;
  const ourDir = ourLoadedDir();
  for (const cacheRoot of candidateCacheRoots()) {
    try {
      cleanupOne(cacheRoot, ourDir);
    } catch (err) {
      log.warn("cleanup-stale: error processing cache root", {
        cacheRoot,
        error: String(err)
      });
    }
  }
}
function cleanupOne(cacheRoot, ourDir) {
  if (!existsSync2(cacheRoot)) return;
  const stalePath = join4(cacheRoot, "node_modules", STALE_PACKAGE_NAME);
  if (!existsSync2(stalePath)) return;
  let realStalePath = stalePath;
  try {
    realStalePath = realpathSync(stalePath);
  } catch {
  }
  if (ourDir && realStalePath === ourDir) return;
  const pkgJsonPath = join4(stalePath, "package.json");
  if (!existsSync2(pkgJsonPath)) return;
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync3(pkgJsonPath, "utf8"));
  } catch {
    return;
  }
  if (pkg.name !== STALE_PACKAGE_NAME) return;
  if (!pkg.description?.includes(SUSPECT_DESCRIPTION_TOKEN)) return;
  log.info("cleanup-stale: removing unscoped install", { stalePath });
  try {
    rmSync(stalePath, { recursive: true, force: true });
  } catch (err) {
    log.warn("cleanup-stale: rmSync failed", {
      stalePath,
      error: String(err)
    });
    return;
  }
  const cachePkgJson = join4(cacheRoot, "package.json");
  if (!existsSync2(cachePkgJson)) return;
  try {
    const cfg = JSON.parse(readFileSync3(cachePkgJson, "utf8"));
    if (cfg?.dependencies?.[STALE_PACKAGE_NAME]) {
      delete cfg.dependencies[STALE_PACKAGE_NAME];
      writeFileSync4(cachePkgJson, JSON.stringify(cfg, null, 2) + "\n");
      log.info("cleanup-stale: pruned dep from cache package.json");
    }
  } catch (err) {
    log.warn("cleanup-stale: cache package.json update failed", {
      error: String(err)
    });
  }
}

// src/index.ts
function createClaudeCode(settings = {}) {
  const cliPath = settings.cliPath ?? process.env.CLAUDE_CLI_PATH ?? "claude";
  const providerName = settings.providerID ?? settings.name ?? "claude-code";
  const proxyTools = settings.proxyTools ?? ["Bash", "Edit", "Write", "WebFetch"];
  const createModel = (modelId) => {
    return new ClaudeCodeLanguageModel(modelId, {
      provider: providerName,
      cliPath,
      cwd: settings.cwd,
      account: settings.account,
      configDir: settings.configDir,
      providerID: settings.providerID,
      skipPermissions: settings.skipPermissions ?? true,
      permissionMode: settings.permissionMode,
      mcpConfig: settings.mcpConfig,
      strictMcpConfig: settings.strictMcpConfig,
      bridgeOpencodeMcp: settings.bridgeOpencodeMcp ?? true,
      controlRequestBehavior: settings.controlRequestBehavior ?? "allow",
      controlRequestToolBehaviors: settings.controlRequestToolBehaviors,
      controlRequestDenyMessage: settings.controlRequestDenyMessage,
      proxyTools,
      webSearch: settings.webSearch,
      hotReloadMcp: settings.hotReloadMcp ?? true
    });
  };
  const provider = function(modelId) {
    return createModel(modelId);
  };
  provider.specificationVersion = "v3";
  provider.languageModel = createModel;
  return provider;
}
var PROVIDER_ID2 = BASE_PROVIDER_ID;
var PACKAGE_NPM = "@khalilgharbaoui/opencode-claude-code-plugin";
function pluginEntrypoint() {
  return import.meta.url.startsWith("file:") ? import.meta.url : PACKAGE_NPM;
}
function cleanProviderOptions(options = {}) {
  const result = { ...options };
  delete result.accounts;
  return result;
}
function mergeDefaultVariants(models = {}) {
  const result = { ...models };
  for (const [id, model] of Object.entries(defaultModels)) {
    if (!model.variants) continue;
    const existing = result[id] && typeof result[id] === "object" ? result[id] : {};
    const variants = existing.variants && typeof existing.variants === "object" ? existing.variants : {};
    result[id] = {
      ...existing,
      variants: {
        ...model.variants,
        ...variants
      }
    };
  }
  return result;
}
function defaultModelsForProvider(providerModels, providerID = PROVIDER_ID2, modelSuffix) {
  const models = Object.fromEntries(
    Object.entries(defaultModels).map(([id, model]) => {
      const modelId = modelSuffix ? `${id}@${modelSuffix}` : id;
      const existing = providerModels[id] ?? providerModels[modelId];
      return [
        modelId,
        {
          ...model,
          id: modelId,
          providerID,
          api: {
            ...model.api,
            id: modelId,
            npm: existing?.api?.npm ?? model.api.npm,
            url: existing?.api?.url ?? model.api.url
          }
        }
      ];
    })
  );
  for (const [id, model] of Object.entries(providerModels)) {
    if (!(id in models)) {
      models[id] = {
        ...model,
        providerID
      };
    }
  }
  return models;
}
function configModelsForProvider(providerModels, providerID, modelSuffix) {
  const models = {};
  for (const [id, model] of Object.entries(defaultModels)) {
    const modelId = modelSuffix ? `${id}@${modelSuffix}` : id;
    const existing = providerModels[id] ?? providerModels[modelId];
    const full = {
      ...model,
      id: modelId,
      providerID,
      api: {
        ...model.api,
        id: modelId,
        npm: existing?.api?.npm ?? model.api.npm,
        url: existing?.api?.url ?? model.api.url
      }
    };
    models[modelId] = toConfigModel(full);
  }
  for (const [id, model] of Object.entries(providerModels)) {
    if (!(id in models)) {
      models[id] = toConfigModel({ ...model, providerID });
    }
  }
  return models;
}
async function providerConfig(existing, providerID = PROVIDER_ID2, optionDefaults = {}, displayName) {
  const mergedOptions = {
    cliPath: "claude",
    proxyTools: ["Bash", "Edit", "Write", "WebFetch"],
    ...optionDefaults,
    ...cleanProviderOptions(existing?.options),
    providerID
  };
  const cliPath = String(mergedOptions.cliPath ?? "claude");
  const account = typeof mergedOptions.account === "string" ? mergedOptions.account : void 0;
  const runtime = account ? await ensureAccountRuntime(account, cliPath) : { cliPath };
  return {
    name: displayName ?? existing?.name,
    npm: existing?.npm ?? pluginEntrypoint(),
    options: {
      ...mergedOptions,
      ...runtime
    },
    models: mergeDefaultVariants(existing?.models)
  };
}
async function expandAccountProviders(config) {
  const seed = config.provider?.[PROVIDER_ID2];
  const accounts = resolveAccounts(seed?.options?.accounts);
  if (!accounts) return false;
  config.provider ??= {};
  const seedOptions = cleanProviderOptions(seed?.options);
  let expandedCount = 0;
  for (const account of accounts) {
    const providerID = accountProviderId(account);
    try {
      const existing = config.provider[providerID];
      const modelSuffix = accountModelSuffix(account);
      config.provider[providerID] = {
        ...existing,
        ...await providerConfig(
          existing,
          providerID,
          {
            ...seedOptions,
            account
          },
          accountDisplayName(account)
        ),
        models: configModelsForProvider(
          existing?.models ?? seed?.models ?? {},
          providerID,
          modelSuffix
        )
      };
      expandedCount++;
    } catch (err) {
      log.error("failed to expand account provider", {
        account,
        providerID,
        error: String(err)
      });
    }
  }
  if (expandedCount > 0) {
    delete config.provider[PROVIDER_ID2];
  }
  return expandedCount > 0;
}
var server = async (input) => {
  cleanupStaleUnscopedInstall();
  if (input && typeof input === "object" && "client" in input) {
    setOpencodeClient(input.client);
  }
  return {
    config: async (config) => {
      config.provider ??= {};
      const expanded = await expandAccountProviders(config);
      if (expanded) {
        const registered = Object.entries(config.provider).filter(([id]) => id === PROVIDER_ID2 || id.startsWith(`${PROVIDER_ID2}-`)).map(([id, p]) => ({ id, name: p?.name ?? id }));
        log.notice("registered claude-code providers", { providers: registered });
        return;
      }
      const existing = config.provider[PROVIDER_ID2];
      config.provider[PROVIDER_ID2] = {
        ...existing,
        ...await providerConfig(existing)
      };
      log.notice("registered claude-code provider", {
        id: PROVIDER_ID2,
        name: config.provider[PROVIDER_ID2]?.name ?? PROVIDER_ID2
      });
    },
    // No `event` hook: MCP config drift is detected at turn start by the
    // hot-reload check in `claude-code-language-model.ts`, which respawns
    // claude safely between turns. Eviction on `global.disposed` would kill
    // an in-flight stream and abort the user's current turn.
    provider: {
      id: PROVIDER_ID2,
      models: async (provider) => defaultModelsForProvider(provider.models)
    }
  };
};
var index_default = {
  id: "@khalilgharbaoui/opencode-claude-code-plugin",
  server
};
export {
  ClaudeCodeLanguageModel,
  bridgeOpencodeMcp,
  createClaudeCode,
  index_default as default,
  defaultModels
};
//# sourceMappingURL=index.js.map
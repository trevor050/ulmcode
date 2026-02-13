import os from "os"
import fs from "fs"
import path from "path"

type ToolSpec = {
  name: string
  category: string
  // Candidate args to retrieve a short version string; tried in order.
  versionArgs?: string[][]
}

type ToolDetected = {
  name: string
  path: string
  version?: string
}

function isUlmcodeBinary() {
  const exe = path.basename(process.execPath || process.argv[0] || "").toLowerCase().replace(/\.exe$/, "")
  return exe === "ulmcode" || process.env.OPENCODE_APP_NAME === "ulmcode"
}

function short(s: string, max = 120) {
  const trimmed = s.trim().replace(/\s+/g, " ")
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + "…"
}

async function runVersion(cmd: string, candidates: string[][], timeoutMs: number) {
  for (const args of candidates) {
    try {
      const proc = Bun.spawn([cmd, ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })

      const killer = setTimeout(() => {
        try {
          proc.kill()
        } catch {}
      }, timeoutMs)

      // Read output concurrently with exit to avoid pipe buffer deadlocks.
      const [code, outBuf, errBuf] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).arrayBuffer().catch(() => new ArrayBuffer(0)),
        new Response(proc.stderr).arrayBuffer().catch(() => new ArrayBuffer(0)),
      ])
      clearTimeout(killer)

      const stdout = Buffer.from(outBuf).toString("utf8")
      const stderr = Buffer.from(errBuf).toString("utf8")
      const combined = (stdout + "\n" + stderr).trim()

      if (code === 0 && combined) return short(combined.split("\n")[0] || combined)
      if (combined) return short(combined.split("\n")[0] || combined)
    } catch {
      // keep trying fallbacks
    }
  }
  return undefined
}

const TOOL_SPECS: ToolSpec[] = [
  // recon + vuln
  { name: "amass", category: "recon", versionArgs: [["-version"], ["--version"]] },
  { name: "subfinder", category: "recon", versionArgs: [["-version"], ["--version"]] },
  { name: "assetfinder", category: "recon", versionArgs: [["--version"], ["-h"]] },
  { name: "gau", category: "recon", versionArgs: [["--version"], ["-h"]] },
  { name: "waybackurls", category: "recon", versionArgs: [["--version"], ["-h"]] },
  { name: "katana", category: "recon", versionArgs: [["-version"], ["--version"]] },
  { name: "dnsx", category: "recon", versionArgs: [["-version"], ["--version"]] },
  { name: "naabu", category: "recon", versionArgs: [["-version"], ["--version"]] },
  { name: "httpx", category: "recon", versionArgs: [["-version"], ["--version"]] },
  { name: "nuclei", category: "vuln", versionArgs: [["-version"], ["--version"]] },
  { name: "ffuf", category: "vuln", versionArgs: [["-V"], ["--version"]] },
  { name: "gobuster", category: "vuln", versionArgs: [["version"], ["--version"]] },
  { name: "feroxbuster", category: "vuln", versionArgs: [["--version"], ["-V"]] },
  { name: "nikto", category: "vuln", versionArgs: [["-Version"], ["-version"]] },
  { name: "sqlmap", category: "vuln", versionArgs: [["--version"]] },

  // network/protocol
  { name: "nmap", category: "net", versionArgs: [["--version"], ["-V"]] },
  { name: "masscan", category: "net", versionArgs: [["--version"], ["-V"]] },
  { name: "rustscan", category: "net", versionArgs: [["--version"], ["-V"]] },
  { name: "nc", category: "net", versionArgs: [["-h"], ["--help"]] }, // netcat variants
  { name: "netcat", category: "net", versionArgs: [["-h"], ["--help"]] },
  { name: "tcpdump", category: "net", versionArgs: [["--version"], ["-h"]] },
  { name: "tshark", category: "net", versionArgs: [["--version"]] },
  { name: "sslscan", category: "net", versionArgs: [["--version"], ["-h"]] },
  { name: "testssl.sh", category: "net", versionArgs: [["--version"], ["-h"]] },
  { name: "whois", category: "net", versionArgs: [["--version"], ["-h"]] },

  // auth/ad/smb + cracking
  { name: "hydra", category: "auth", versionArgs: [["-h"]] },
  { name: "john", category: "auth", versionArgs: [["--version"]] },
  { name: "hashcat", category: "auth", versionArgs: [["--version"]] },
  { name: "nxc", category: "auth", versionArgs: [["--version"], ["-h"]] }, // NetExec
  { name: "enum4linux-ng", category: "auth", versionArgs: [["--version"], ["-h"]] },
  { name: "smbmap", category: "auth", versionArgs: [["-V"], ["--version"]] },
  { name: "impacket-smbclient", category: "auth", versionArgs: [["-h"]] },

  // operator/misc
  { name: "wafw00f", category: "ops", versionArgs: [["--version"], ["-h"]] },
  { name: "dnsrecon", category: "ops", versionArgs: [["--version"], ["-h"]] },
  { name: "dirsearch", category: "ops", versionArgs: [["--version"], ["-h"]] },
  { name: "mitmproxy", category: "ops", versionArgs: [["--version"]] },
  { name: "bettercap", category: "ops", versionArgs: [["--version"], ["-h"]] },
  { name: "searchsploit", category: "ops", versionArgs: [["--version"], ["-h"]] },
  { name: "binwalk", category: "ops", versionArgs: [["--version"], ["-h"]] },
  { name: "r2", category: "ops", versionArgs: [["-v"]] },
  { name: "yara", category: "ops", versionArgs: [["--version"]] },
  { name: "yr", category: "ops", versionArgs: [["--version"], ["-h"]] }, // yara-x
  { name: "trivy", category: "ops", versionArgs: [["--version"]] },
  { name: "semgrep", category: "ops", versionArgs: [["--version"]] },
  { name: "gitleaks", category: "ops", versionArgs: [["version"], ["--version"]] },
  { name: "wpscan", category: "ops", versionArgs: [["--version"]] },
  { name: "whatweb", category: "ops", versionArgs: [["--version"], ["-v"], ["-h"]] },
]

const CATEGORY_ORDER = ["recon", "vuln", "net", "auth", "ops"]

let cached:
  | {
      at: number
      text: string
    }
  | undefined

export namespace ToolingInventory {
  export async function render() {
    // Default behavior (ULM fork): ON unless explicitly disabled.
    // Rationale: teach the agent what local security tooling exists without wasting turns on probing.
    const flag = process.env.ULMCODE_TOOLING_INVENTORY
    const enabled = flag ? flag !== "0" : true
    if (!enabled) return ""

    // Avoid re-probing repeatedly within a single run.
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.text

    const timeoutMs = Number(process.env.ULMCODE_TOOLING_TIMEOUT_MS || "600")
    const wantVersions = (process.env.ULMCODE_TOOLING_VERSIONS || "1") !== "0"

    const home = os.homedir()
    const seclistsPath = path.join(home, "tools", "SecLists")

    const found: ToolDetected[] = []
    const missing: string[] = []

    for (const spec of TOOL_SPECS) {
      const resolved = Bun.which(spec.name)
      if (!resolved) {
        missing.push(spec.name)
        continue
      }
      found.push({ name: spec.name, path: resolved })
    }

    // Optionally enrich with versions (best-effort, timeboxed).
    if (wantVersions) {
      const byName = new Map(found.map((t) => [t.name, t]))
      const toVersion = TOOL_SPECS.filter((s) => byName.has(s.name) && s.versionArgs && s.versionArgs.length > 0)

      // Basic concurrency cap so we don't spawn 50 processes at once.
      const queue = [...toVersion]
      const workers = Array.from({ length: 8 }, async () => {
        while (queue.length) {
          const spec = queue.shift()
          if (!spec) return
          const entry = byName.get(spec.name)
          if (!entry || !spec.versionArgs) continue
          entry.version = await runVersion(spec.name, spec.versionArgs, timeoutMs)
        }
      })
      await Promise.all(workers)
    }

    const byCategory = new Map<string, ToolDetected[]>()
    for (const t of found) {
      const spec = TOOL_SPECS.find((s) => s.name === t.name)
      const cat = spec?.category || "other"
      const arr = byCategory.get(cat) || []
      arr.push(t)
      byCategory.set(cat, arr)
    }

    for (const arr of byCategory.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name))
    }

    const osLine = `${os.type()} ${os.release()} (${process.platform}/${process.arch})`
    const secListsStatus = fs.existsSync(seclistsPath) ? seclistsPath : "missing"

    const lines: string[] = []
    lines.push("<tooling>")
    lines.push(`  os: ${osLine}`)
    lines.push(`  detected_tools: ${found.length}`)
    lines.push(`  missing_tools: ${missing.length}`)
    lines.push(`  seclists: ${secListsStatus}`)

    for (const cat of CATEGORY_ORDER) {
      const arr = byCategory.get(cat)
      if (!arr || arr.length === 0) continue
      const rendered = arr
        .map((t) => {
          const v = t.version ? ` (${t.version})` : ""
          return `${t.name}${v}`
        })
        .join(", ")
      lines.push(`  ${cat}: ${short(rendered, 900)}`)
    }

    lines.push("</tooling>")

    const text = lines.join("\n")
    cached = { at: Date.now(), text }
    return text
  }
}

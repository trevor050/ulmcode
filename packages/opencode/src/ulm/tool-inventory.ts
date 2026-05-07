import fs from "fs/promises"
import os from "os"
import path from "path"
import { operationPath, slug } from "./artifact"

export type ToolInventoryCategory =
  | "recon"
  | "web"
  | "network"
  | "vuln"
  | "auth"
  | "cloud"
  | "defensive"
  | "reporting"
  | "ops"

export type ToolInventorySpec = {
  id: string
  category: ToolInventoryCategory
  purpose: string
  versionArgs?: string[][]
  install: Array<{ platform: string; command: string }>
  fallbacks: string[]
  highValue?: boolean
}

export type ToolInventoryEntry = {
  id: string
  category: ToolInventoryCategory
  purpose: string
  installed: boolean
  path?: string
  version?: string
  versionError?: string
  install: ToolInventorySpec["install"]
  fallbacks: string[]
  highValue: boolean
}

export type ToolInventoryRecord = {
  operationID: string
  generatedAt: string
  platform: NodeJS.Platform
  arch: string
  seclists: {
    found: boolean
    paths: string[]
    searched: string[]
  }
  counts: {
    total: number
    installed: number
    missing: number
    highValueMissing: number
  }
  categories: Record<ToolInventoryCategory, { installed: number; missing: number }>
  tools: ToolInventoryEntry[]
  nextActions: string[]
}

export type ToolInventoryInput = {
  operationID: string
  includeVersions?: boolean
  probeTimeoutMs?: number
  writeArtifacts?: boolean
}

export type ToolInventoryResult = {
  operationID: string
  record: ToolInventoryRecord
  json?: string
  markdown?: string
}

export const TOOL_INVENTORY_CATALOG: ToolInventorySpec[] = [
  { id: "nmap", category: "network", purpose: "service inventory and version fingerprinting", versionArgs: [["--version"], ["-V"]], install: [{ platform: "darwin", command: "brew install nmap" }, { platform: "linux", command: "sudo apt-get install -y nmap" }], fallbacks: ["rustscan", "httpx"], highValue: true },
  { id: "masscan", category: "network", purpose: "large authorized TCP discovery when ROE allows high-rate scanning", versionArgs: [["--version"]], install: [{ platform: "darwin", command: "brew install masscan" }, { platform: "linux", command: "sudo apt-get install -y masscan" }], fallbacks: ["nmap", "rustscan"] },
  { id: "rustscan", category: "network", purpose: "fast port discovery wrapper for scoped targets", versionArgs: [["--version"]], install: [{ platform: "darwin", command: "brew install rustscan" }, { platform: "cargo", command: "cargo install rustscan" }], fallbacks: ["nmap"] },
  { id: "naabu", category: "network", purpose: "ProjectDiscovery port discovery", versionArgs: [["-version"], ["--version"]], install: [{ platform: "go", command: "go install github.com/projectdiscovery/naabu/v2/cmd/naabu@latest" }], fallbacks: ["nmap", "rustscan"] },
  { id: "httpx", category: "web", purpose: "HTTP discovery, title, status, tech, and URL inventory", versionArgs: [["-version"], ["--version"]], install: [{ platform: "darwin", command: "brew install httpx" }, { platform: "go", command: "go install github.com/projectdiscovery/httpx/cmd/httpx@latest" }], fallbacks: ["curl", "nmap"], highValue: true },
  { id: "dnsx", category: "recon", purpose: "DNS resolution and record inventory", versionArgs: [["-version"], ["--version"]], install: [{ platform: "go", command: "go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest" }], fallbacks: ["dig", "host"], highValue: true },
  { id: "amass", category: "recon", purpose: "external attack-surface enumeration", versionArgs: [["-version"], ["--version"]], install: [{ platform: "darwin", command: "brew install amass" }, { platform: "linux", command: "sudo apt-get install -y amass" }], fallbacks: ["subfinder"] },
  { id: "subfinder", category: "recon", purpose: "passive subdomain discovery", versionArgs: [["-version"], ["--version"]], install: [{ platform: "go", command: "go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest" }], fallbacks: ["amass"] },
  { id: "assetfinder", category: "recon", purpose: "passive domain asset discovery", versionArgs: [["--version"], ["-h"]], install: [{ platform: "go", command: "go install github.com/tomnomnom/assetfinder@latest" }], fallbacks: ["subfinder"] },
  { id: "gau", category: "recon", purpose: "historical URL collection", versionArgs: [["--version"], ["-h"]], install: [{ platform: "go", command: "go install github.com/lc/gau/v2/cmd/gau@latest" }], fallbacks: ["waybackurls"] },
  { id: "waybackurls", category: "recon", purpose: "Wayback Machine URL collection", versionArgs: [["--version"], ["-h"]], install: [{ platform: "go", command: "go install github.com/tomnomnom/waybackurls@latest" }], fallbacks: ["gau"] },
  { id: "katana", category: "web", purpose: "web crawling in authorized scope", versionArgs: [["-version"], ["--version"]], install: [{ platform: "go", command: "go install github.com/projectdiscovery/katana/cmd/katana@latest" }], fallbacks: ["gowitness", "browser-use"] },
  { id: "gowitness", category: "web", purpose: "browser screenshots and page capture", versionArgs: [["version"], ["--version"]], install: [{ platform: "go", command: "go install github.com/sensepost/gowitness@latest" }], fallbacks: ["browser-use", "playwright"] },
  { id: "ffuf", category: "web", purpose: "authorized low-rate content discovery", versionArgs: [["-V"], ["--version"]], install: [{ platform: "darwin", command: "brew install ffuf" }, { platform: "go", command: "go install github.com/ffuf/ffuf/v2@latest" }], fallbacks: ["feroxbuster"], highValue: true },
  { id: "feroxbuster", category: "web", purpose: "authorized recursive content discovery", versionArgs: [["--version"], ["-V"]], install: [{ platform: "darwin", command: "brew install feroxbuster" }, { platform: "linux", command: "sudo apt-get install -y feroxbuster" }], fallbacks: ["ffuf"] },
  { id: "gobuster", category: "web", purpose: "content, DNS, and vhost discovery", versionArgs: [["version"], ["--version"]], install: [{ platform: "darwin", command: "brew install gobuster" }, { platform: "go", command: "go install github.com/OJ/gobuster/v3@latest" }], fallbacks: ["ffuf"] },
  { id: "dirsearch", category: "web", purpose: "content discovery with wordlists", versionArgs: [["--version"], ["-h"]], install: [{ platform: "pipx", command: "pipx install dirsearch" }], fallbacks: ["ffuf", "feroxbuster"] },
  { id: "nuclei", category: "vuln", purpose: "template-based low-noise vulnerability checks", versionArgs: [["-version"], ["--version"]], install: [{ platform: "go", command: "go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest" }], fallbacks: ["manual-validation"], highValue: true },
  { id: "nikto", category: "vuln", purpose: "legacy web server baseline checks", versionArgs: [["-Version"], ["-version"]], install: [{ platform: "darwin", command: "brew install nikto" }, { platform: "linux", command: "sudo apt-get install -y nikto" }], fallbacks: ["nuclei"] },
  { id: "sqlmap", category: "vuln", purpose: "SQL injection validation when ROE explicitly allows it", versionArgs: [["--version"]], install: [{ platform: "darwin", command: "brew install sqlmap" }, { platform: "pipx", command: "pipx install sqlmap" }], fallbacks: ["manual-validation"] },
  { id: "zap-baseline.py", category: "vuln", purpose: "OWASP ZAP passive baseline script", versionArgs: [["--help"]], install: [{ platform: "docker", command: "docker pull ghcr.io/zaproxy/zaproxy:stable" }], fallbacks: ["nuclei", "manual-browser-review"] },
  { id: "sslscan", category: "network", purpose: "TLS configuration inventory", versionArgs: [["--version"], ["-h"]], install: [{ platform: "darwin", command: "brew install sslscan" }, { platform: "linux", command: "sudo apt-get install -y sslscan" }], fallbacks: ["testssl.sh", "nmap"] },
  { id: "testssl.sh", category: "network", purpose: "TLS configuration checks", versionArgs: [["--version"], ["-h"]], install: [{ platform: "darwin", command: "brew install testssl" }, { platform: "git", command: "git clone --depth 1 https://github.com/drwetter/testssl.sh ~/tools/testssl.sh" }], fallbacks: ["sslscan"] },
  { id: "whois", category: "recon", purpose: "registration and ownership lookup", versionArgs: [["--version"], ["-h"]], install: [{ platform: "darwin", command: "brew install whois" }, { platform: "linux", command: "sudo apt-get install -y whois" }], fallbacks: ["web-search"] },
  { id: "dig", category: "recon", purpose: "DNS lookup fallback", versionArgs: [["-v"], ["-h"]], install: [{ platform: "darwin", command: "brew install bind" }, { platform: "linux", command: "sudo apt-get install -y dnsutils" }], fallbacks: ["host", "dnsx"], highValue: true },
  { id: "host", category: "recon", purpose: "DNS lookup fallback", versionArgs: [["-v"], ["-h"]], install: [{ platform: "linux", command: "sudo apt-get install -y bind9-host" }], fallbacks: ["dig", "dnsx"] },
  { id: "tcpdump", category: "network", purpose: "packet capture when authorized", versionArgs: [["--version"], ["-h"]], install: [{ platform: "darwin", command: "brew install tcpdump" }, { platform: "linux", command: "sudo apt-get install -y tcpdump" }], fallbacks: ["tshark"] },
  { id: "tshark", category: "network", purpose: "packet and pcap inspection", versionArgs: [["--version"]], install: [{ platform: "darwin", command: "brew install wireshark" }, { platform: "linux", command: "sudo apt-get install -y tshark" }], fallbacks: ["tcpdump"] },
  { id: "nc", category: "network", purpose: "simple TCP connectivity checks", versionArgs: [["-h"], ["--help"]], install: [{ platform: "darwin", command: "brew install netcat" }, { platform: "linux", command: "sudo apt-get install -y netcat-openbsd" }], fallbacks: ["nmap"] },
  { id: "netcat", category: "network", purpose: "simple TCP connectivity checks", versionArgs: [["-h"], ["--help"]], install: [{ platform: "darwin", command: "brew install netcat" }, { platform: "linux", command: "sudo apt-get install -y netcat-openbsd" }], fallbacks: ["nc"] },
  { id: "hydra", category: "auth", purpose: "credential validation only when ROE explicitly permits", versionArgs: [["-h"]], install: [{ platform: "darwin", command: "brew install hydra" }, { platform: "linux", command: "sudo apt-get install -y hydra" }], fallbacks: ["manual-validation"] },
  { id: "john", category: "auth", purpose: "hash audit support", versionArgs: [["--version"]], install: [{ platform: "darwin", command: "brew install john" }, { platform: "linux", command: "sudo apt-get install -y john" }], fallbacks: ["hashcat"] },
  { id: "hashcat", category: "auth", purpose: "hash audit support", versionArgs: [["--version"]], install: [{ platform: "darwin", command: "brew install hashcat" }, { platform: "linux", command: "sudo apt-get install -y hashcat" }], fallbacks: ["john"] },
  { id: "nxc", category: "auth", purpose: "authorized AD/SMB protocol assessment", versionArgs: [["--version"], ["-h"]], install: [{ platform: "pipx", command: "pipx install git+https://github.com/Pennyw0rth/NetExec" }], fallbacks: ["smbmap", "impacket-smbclient"] },
  { id: "enum4linux-ng", category: "auth", purpose: "SMB/Windows enumeration", versionArgs: [["--version"], ["-h"]], install: [{ platform: "pipx", command: "pipx install enum4linux-ng" }], fallbacks: ["smbmap"] },
  { id: "smbmap", category: "auth", purpose: "SMB share enumeration", versionArgs: [["-V"], ["--version"]], install: [{ platform: "pipx", command: "pipx install smbmap" }], fallbacks: ["nxc", "impacket-smbclient"] },
  { id: "impacket-smbclient", category: "auth", purpose: "Impacket SMB client operations", versionArgs: [["-h"]], install: [{ platform: "pipx", command: "pipx install impacket" }], fallbacks: ["smbmap"] },
  { id: "wafw00f", category: "web", purpose: "WAF fingerprinting", versionArgs: [["--version"], ["-h"]], install: [{ platform: "pipx", command: "pipx install wafw00f" }], fallbacks: ["httpx", "manual-review"] },
  { id: "dnsrecon", category: "recon", purpose: "DNS reconnaissance", versionArgs: [["--version"], ["-h"]], install: [{ platform: "pipx", command: "pipx install dnsrecon" }], fallbacks: ["dnsx", "dig"] },
  { id: "whatweb", category: "web", purpose: "web technology fingerprinting", versionArgs: [["--version"], ["-v"], ["-h"]], install: [{ platform: "darwin", command: "brew install whatweb" }, { platform: "linux", command: "sudo apt-get install -y whatweb" }], fallbacks: ["httpx"] },
  { id: "searchsploit", category: "ops", purpose: "local Exploit-DB search for defensive validation research", versionArgs: [["--version"], ["-h"]], install: [{ platform: "darwin", command: "brew install exploitdb" }, { platform: "linux", command: "sudo apt-get install -y exploitdb" }], fallbacks: ["web-search"] },
  { id: "trivy", category: "defensive", purpose: "container, dependency, and config scanning", versionArgs: [["--version"]], install: [{ platform: "darwin", command: "brew install trivy" }, { platform: "linux", command: "sudo apt-get install -y trivy" }], fallbacks: ["grype"] },
  { id: "semgrep", category: "defensive", purpose: "source and config static analysis", versionArgs: [["--version"]], install: [{ platform: "pipx", command: "pipx install semgrep" }], fallbacks: ["grep"] },
  { id: "gitleaks", category: "defensive", purpose: "secret scanning", versionArgs: [["version"], ["--version"]], install: [{ platform: "darwin", command: "brew install gitleaks" }, { platform: "linux", command: "sudo apt-get install -y gitleaks" }], fallbacks: ["trufflehog", "manual-review"] },
  { id: "yara", category: "defensive", purpose: "YARA rule matching", versionArgs: [["--version"]], install: [{ platform: "darwin", command: "brew install yara" }, { platform: "linux", command: "sudo apt-get install -y yara" }], fallbacks: ["manual-review"] },
  { id: "binwalk", category: "ops", purpose: "firmware/archive inspection", versionArgs: [["--version"], ["-h"]], install: [{ platform: "darwin", command: "brew install binwalk" }, { platform: "linux", command: "sudo apt-get install -y binwalk" }], fallbacks: ["file", "strings"] },
  { id: "r2", category: "ops", purpose: "binary inspection", versionArgs: [["-v"]], install: [{ platform: "darwin", command: "brew install radare2" }, { platform: "linux", command: "sudo apt-get install -y radare2" }], fallbacks: ["strings"] },
]

const categories: ToolInventoryCategory[] = ["recon", "web", "network", "vuln", "auth", "cloud", "defensive", "reporting", "ops"]

function inventoryFiles(worktree: string, operationID: string) {
  const root = path.join(operationPath(worktree, operationID), "tool-inventory")
  return {
    json: path.join(root, "tool-inventory.json"),
    markdown: path.join(root, "tool-inventory.md"),
  }
}

function short(value: string, max = 160) {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

async function runVersion(command: string, args: string[][], timeoutMs: number) {
  for (const candidate of args) {
    try {
      const proc = Bun.spawn([command, ...candidate], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
      const timer = setTimeout(() => {
        try {
          proc.kill()
        } catch {}
      }, timeoutMs)
      const [exit, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text().catch(() => ""),
        new Response(proc.stderr).text().catch(() => ""),
      ])
      clearTimeout(timer)
      const output = short(`${stdout}\n${stderr}`.trim().split("\n")[0] ?? "")
      if (output) return { version: output }
      if (exit !== 0) return { versionError: `version probe exited ${exit}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { versionError: short(message) }
    }
  }
  return {}
}

async function resolveExecutable(command: string) {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${command}${extension}`)
      try {
        await fs.access(candidate, fs.constants.X_OK)
        return candidate
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "EACCES") {
          throw error
        }
      }
    }
  }
  return undefined
}

async function runWithLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (;;) {
        const item = queue.shift()
        if (!item) return
        await fn(item)
      }
    }),
  )
}

async function seclistsStatus() {
  const searched = [
    path.join(os.homedir(), "tools", "SecLists"),
    path.join(os.homedir(), "SecLists"),
    "/usr/share/seclists",
    "/opt/SecLists",
  ]
  const paths: string[] = []
  for (const candidate of searched) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isDirectory()) paths.push(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return { found: paths.length > 0, paths, searched }
}

function categoryCounts(tools: ToolInventoryEntry[]) {
  return Object.fromEntries(
    categories.map((category) => [
      category,
      {
        installed: tools.filter((tool) => tool.category === category && tool.installed).length,
        missing: tools.filter((tool) => tool.category === category && !tool.installed).length,
      },
    ]),
  ) as Record<ToolInventoryCategory, { installed: number; missing: number }>
}

function nextActions(record: Omit<ToolInventoryRecord, "nextActions">) {
  const missingHighValue = record.tools.filter((tool) => !tool.installed && tool.highValue)
  const actions = [
    missingHighValue.length
      ? `Review high-value missing tools: ${missingHighValue.map((tool) => tool.id).join(", ")}`
      : "High-value baseline tools are available.",
    record.seclists.found ? "Use discovered SecLists path for content discovery." : "Install SecLists or provide an authorized wordlist path before broad content discovery.",
    "Use tool_acquire with install=true only after operator authorization.",
  ]
  return actions
}

function inventoryMarkdown(record: ToolInventoryRecord) {
  const installed = record.tools.filter((tool) => tool.installed)
  const missingHighValue = record.tools.filter((tool) => !tool.installed && tool.highValue)
  return [
    `# Tool Inventory ${record.operationID}`,
    "",
    `generated_at: ${record.generatedAt}`,
    `platform: ${record.platform}/${record.arch}`,
    `installed: ${record.counts.installed}`,
    `missing: ${record.counts.missing}`,
    `high_value_missing: ${record.counts.highValueMissing}`,
    `seclists: ${record.seclists.found ? record.seclists.paths.join(", ") : "missing"}`,
    "",
    "## Installed Tools",
    "",
    ...(installed.length ? installed.map((tool) => `- ${tool.id} (${tool.category})${tool.version ? `: ${tool.version}` : ""}`) : ["- none detected"]),
    "",
    "## High-Value Missing Tools",
    "",
    ...(missingHighValue.length
      ? missingHighValue.map((tool) => {
          const install = tool.install.find((item) => item.platform === record.platform)?.command ?? tool.install[0]?.command ?? "no install hint"
          return `- ${tool.id}: ${tool.purpose}; install: ${install}; fallbacks: ${tool.fallbacks.join(", ") || "none"}`
        })
      : ["- none"]),
    "",
    "## Next Actions",
    "",
    ...record.nextActions.map((action) => `- ${action}`),
    "",
  ].join("\n")
}

export async function collectToolInventory(
  worktree: string,
  input: ToolInventoryInput,
  options: { now?: string; catalog?: ToolInventorySpec[] } = {},
): Promise<ToolInventoryResult> {
  const operationID = slug(input.operationID, "operation")
  const includeVersions = input.includeVersions ?? true
  const probeTimeoutMs = input.probeTimeoutMs ?? 800
  const catalog = options.catalog ?? TOOL_INVENTORY_CATALOG
  const tools: ToolInventoryEntry[] = await Promise.all(catalog.map(async (spec) => {
    const resolved = await resolveExecutable(spec.id)
    return {
      id: spec.id,
      category: spec.category,
      purpose: spec.purpose,
      installed: Boolean(resolved),
      ...(resolved ? { path: resolved } : {}),
      install: spec.install,
      fallbacks: spec.fallbacks,
      highValue: spec.highValue ?? false,
    }
  }))

  if (includeVersions) {
    await runWithLimit(
      tools.filter((tool) => tool.installed),
      8,
      async (tool) => {
        const spec = catalog.find((item) => item.id === tool.id)
        if (!spec?.versionArgs || !tool.path) return
        Object.assign(tool, await runVersion(tool.path, spec.versionArgs, probeTimeoutMs))
      },
    )
  }

  const seclists = await seclistsStatus()
  const base = {
    operationID,
    generatedAt: options.now ?? new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    seclists,
    counts: {
      total: tools.length,
      installed: tools.filter((tool) => tool.installed).length,
      missing: tools.filter((tool) => !tool.installed).length,
      highValueMissing: tools.filter((tool) => !tool.installed && tool.highValue).length,
    },
    categories: categoryCounts(tools),
    tools,
  }
  const record: ToolInventoryRecord = { ...base, nextActions: nextActions(base) }
  if (input.writeArtifacts === false) return { operationID, record }

  const files = inventoryFiles(worktree, operationID)
  await fs.mkdir(path.dirname(files.json), { recursive: true })
  await fs.writeFile(files.json, JSON.stringify(record, null, 2) + "\n")
  await fs.writeFile(files.markdown, inventoryMarkdown(record))
  return { operationID, record, json: files.json, markdown: files.markdown }
}

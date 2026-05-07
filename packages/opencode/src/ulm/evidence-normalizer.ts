import fs from "fs/promises"
import type { Dirent } from "fs"
import path from "path"
import { operationPath, slug, writeEvidence, type EvidenceRef } from "./artifact"

export type EvidenceParser =
  | "auto"
  | "httpx-jsonl"
  | "dnsx-jsonl"
  | "ffuf-json"
  | "zap-json"
  | "nmap-xml"
  | "screenshot-json"
  | "tls-jsonl"
  | "cloud-json"
  | "text"

export type EvidenceLead = {
  id: string
  kind:
    | "host"
    | "service"
    | "url"
    | "dns_record"
    | "web_path"
    | "vulnerability"
    | "screenshot"
    | "tls_certificate"
    | "cloud_asset"
    | "auth_surface"
    | "note"
  title: string
  asset?: string
  url?: string
  host?: string
  port?: number
  protocol?: string
  severity: "info" | "low" | "medium" | "high" | "critical"
  confidence: number
  summary: string
  evidence: EvidenceRef[]
  source: {
    parser: Exclude<EvidenceParser, "auto">
    path: string
  }
}

export type EvidenceNormalizationResult = {
  operationID: string
  root: string
  generatedAt: string
  parser: EvidenceParser
  artifacts: string[]
  evidence: EvidenceRef[]
  leads: EvidenceLead[]
  indexPath: string
  leadsPath: string
}

export type EvidenceNormalizeInput = {
  operationID: string
  artifactPaths?: string[]
  commandPlanPaths?: string[]
  parser?: EvidenceParser
  writeEvidenceRecords?: boolean
}

type CommandPlanRecord = {
  command?: string
  stdoutPath?: string
  stderrPath?: string
  artifacts?: string[]
  operationRoot?: string
}

type ParsedArtifact = {
  parser: Exclude<EvidenceParser, "auto">
  leads: Array<Omit<EvidenceLead, "evidence" | "source">>
  summary: string
}

function leadID(input: Pick<EvidenceLead, "kind" | "title" | "asset" | "url" | "port">) {
  return slug([input.kind, input.asset, input.url, input.port, input.title].filter(Boolean).join("-"), "lead")
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function resolveOperationFile(root: string, file: string) {
  const resolved = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file)
  const relative = path.relative(root, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`artifact is outside operation root: ${file}`)
  return resolved
}

async function collectFromCommandPlans(root: string, commandPlanPaths: string[]) {
  const artifacts = new Set<string>()
  for (const planPath of commandPlanPaths) {
    const plan = await readJson<CommandPlanRecord>(resolveOperationFile(root, planPath))
    if (!plan) continue
    for (const candidate of [plan.stdoutPath, plan.stderrPath, ...(plan.artifacts ?? [])]) {
      if (!candidate) continue
      const resolved = path.isAbsolute(candidate) ? candidate : path.join(plan.operationRoot ?? root, candidate)
      try {
        const stat = await fs.stat(resolved)
        if (stat.isFile() && stat.size > 0) artifacts.add(resolved)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
  }
  return [...artifacts]
}

async function discoverCommandPlans(root: string) {
  const commands = path.join(root, "commands")
  const result: string[] = []
  async function walk(dir: string) {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      if (entry.isFile() && entry.name === "command-plan.json") result.push(full)
    }
  }
  await walk(commands)
  return result
}

function parserFor(file: string, content: string, requested: EvidenceParser): Exclude<EvidenceParser, "auto"> {
  if (requested !== "auto") return requested
  const lower = file.toLowerCase()
  if (lower.endsWith(".jsonl") && content.includes('"status_code"')) return "httpx-jsonl"
  if (lower.endsWith(".jsonl") && (content.includes('"a"') || content.includes('"cname"'))) return "dnsx-jsonl"
  if (lower.endsWith(".json") && content.includes('"results"') && content.includes('"status"')) return "ffuf-json"
  if (lower.endsWith(".json") && content.includes('"alerts"')) return "zap-json"
  if (lower.endsWith(".xml") && content.includes("<nmaprun")) return "nmap-xml"
  if (lower.endsWith(".json") && content.includes('"screenshots"')) return "screenshot-json"
  if (lower.endsWith(".jsonl") && (content.includes('"subject_cn"') || content.includes('"not_after"'))) return "tls-jsonl"
  if (lower.endsWith(".json") && content.includes('"assets"') && (content.includes('"provider"') || content.includes('"auth_url"'))) {
    return "cloud-json"
  }
  return "text"
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
}

function parseJsonLines(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function parseHttpxJsonl(content: string): ParsedArtifact {
  const rows = parseJsonLines(content)
  const leads = rows.map((row) => {
    const url = String(row.url ?? row.input ?? "")
    const status = Number(row.status_code ?? row.status ?? 0)
    const title = row.title ? String(row.title) : "untitled"
    const tech = safeArray(row.tech).join(", ")
    return {
      id: leadID({ kind: "url", url, title }),
      kind: "url" as const,
      title: `${status || "HTTP"} ${url}`,
      asset: String(row.host ?? row.input ?? url),
      url,
      severity: "info" as const,
      confidence: 0.82,
      summary: `HTTP service responded${status ? ` with ${status}` : ""}; title=${title}${tech ? `; tech=${tech}` : ""}.`,
    }
  })
  return { parser: "httpx-jsonl", leads, summary: `${leads.length} HTTP surfaces parsed from httpx JSONL` }
}

function parseDnsxJsonl(content: string): ParsedArtifact {
  const rows = parseJsonLines(content)
  const leads = rows.flatMap((row) => {
    const host = String(row.host ?? row.input ?? "")
    const records = [...safeArray(row.a), ...safeArray(row.aaaa), ...safeArray(row.cname)].map(String)
    return records.map((record) => ({
      id: leadID({ kind: "dns_record", asset: host, title: record }),
      kind: "dns_record" as const,
      title: `${host} -> ${record}`,
      asset: host,
      host,
      severity: "info" as const,
      confidence: 0.78,
      summary: `DNS record for ${host}: ${record}.`,
    }))
  })
  return { parser: "dnsx-jsonl", leads, summary: `${leads.length} DNS records parsed from dnsx JSONL` }
}

function parseFfufJson(content: string): ParsedArtifact {
  const parsed = JSON.parse(content) as { results?: Array<Record<string, unknown>> }
  const rows = parsed.results ?? []
  const leads = rows.map((row) => {
    const url = String(row.url ?? row.input ?? "")
    const status = Number(row.status ?? 0)
    return {
      id: leadID({ kind: "web_path", url, title: String(status || "path") }),
      kind: "web_path" as const,
      title: `${status || "discovered"} ${url}`,
      url,
      severity: status >= 500 ? ("medium" as const) : "info" as const,
      confidence: 0.72,
      summary: `Content discovery match${status ? ` returned ${status}` : ""}; length=${row.length ?? "unknown"}.`,
    }
  })
  return { parser: "ffuf-json", leads, summary: `${leads.length} web paths parsed from ffuf JSON` }
}

function zapSeverity(risk: unknown): EvidenceLead["severity"] {
  const value = String(risk ?? "").toLowerCase()
  if (value.includes("critical")) return "critical"
  if (value.includes("high")) return "high"
  if (value.includes("medium")) return "medium"
  if (value.includes("low")) return "low"
  return "info"
}

function parseZapJson(content: string): ParsedArtifact {
  const parsed = JSON.parse(content) as { site?: Array<{ name?: string; alerts?: Array<Record<string, unknown>> }> }
  const leads = (parsed.site ?? []).flatMap((site) =>
    (site.alerts ?? []).map((alert) => {
      const title = String(alert.alert ?? alert.name ?? "ZAP alert")
      const asset = String(site.name ?? alert.url ?? "")
      return {
        id: leadID({ kind: "vulnerability", asset, title }),
        kind: "vulnerability" as const,
        title,
        asset,
        url: String(alert.url ?? asset),
        severity: zapSeverity(alert.riskdesc ?? alert.risk),
        confidence: String(alert.confidence ?? "").toLowerCase().includes("high") ? 0.82 : 0.62,
        summary: `ZAP passive baseline alert for ${asset}: ${String(alert.riskdesc ?? alert.risk ?? "unknown risk")}.`,
      }
    }),
  )
  return { parser: "zap-json", leads, summary: `${leads.length} ZAP alerts parsed from baseline JSON` }
}

function attrs(tag: string) {
  return Object.fromEntries(
    [...tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:]*)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!.replaceAll("&quot;", '"')]),
  )
}

function parseNmapXml(content: string): ParsedArtifact {
  const leads: ParsedArtifact["leads"] = []
  for (const hostMatch of content.matchAll(/<host\b[\s\S]*?<\/host>/g)) {
    const block = hostMatch[0]
    if (!/<status\b[^>]*state="up"/.test(block)) continue
    const addressTag = block.match(/<address\b[^>]*addr="[^"]*"[^>]*>/)?.[0]
    const address = addressTag ? attrs(addressTag).addr : undefined
    if (!address) continue
    leads.push({
      id: leadID({ kind: "host", asset: address, title: "up" }),
      kind: "host",
      title: `Host up: ${address}`,
      asset: address,
      host: address,
      severity: "info",
      confidence: 0.8,
      summary: `Nmap reported host ${address} as up.`,
    })
    for (const portMatch of block.matchAll(/<port\b[\s\S]*?<\/port>/g)) {
      const portBlock = portMatch[0]
      if (!/<state\b[^>]*state="open"/.test(portBlock)) continue
      const portTag = portBlock.match(/<port\b[^>]*>/)?.[0]
      const serviceTag = portBlock.match(/<service\b[^>]*>/)?.[0]
      const portAttrs = portTag ? attrs(portTag) : {}
      const serviceAttrs = serviceTag ? attrs(serviceTag) : {}
      const port = Number(portAttrs.portid ?? 0)
      const protocol = String(portAttrs.protocol ?? "tcp")
      const service = [serviceAttrs.name, serviceAttrs.product, serviceAttrs.version].filter(Boolean).join(" ")
      leads.push({
        id: leadID({ kind: "service", asset: address, port, title: protocol }),
        kind: "service",
        title: `${address}:${port}/${protocol}`,
        asset: address,
        host: address,
        port,
        protocol,
        severity: "info",
        confidence: 0.86,
        summary: `Open ${protocol} port ${port}${service ? ` running ${service}` : ""}.`,
      })
    }
  }
  return { parser: "nmap-xml", leads, summary: `${leads.length} hosts/services parsed from Nmap XML` }
}

function parseScreenshotJson(content: string): ParsedArtifact {
  const parsed = JSON.parse(content) as { screenshots?: Array<Record<string, unknown>> }
  const leads = (parsed.screenshots ?? []).flatMap((item) => {
    const url = String(item.url ?? "")
    const screenshotPath = String(item.path ?? item.screenshot ?? "")
    const title = String(item.title ?? "Screenshot")
    const screenshotLead = {
      id: leadID({ kind: "screenshot", url, title: screenshotPath || title }),
      kind: "screenshot" as const,
      title: `Screenshot: ${title}`,
      url,
      severity: "info" as const,
      confidence: 0.76,
      summary: `Screenshot captured for ${url || "unknown URL"}${screenshotPath ? ` at ${screenshotPath}` : ""}.`,
    }
    const authLead =
      /login|signin|sso|oauth|saml|auth/i.test(url) || /login|signin|sso|oauth|saml|auth/i.test(title)
        ? [
            {
              id: leadID({ kind: "auth_surface", url, title }),
              kind: "auth_surface" as const,
              title: `Authentication surface: ${title}`,
              url,
              severity: "info" as const,
              confidence: 0.7,
              summary: `Screenshot indicates an authentication surface at ${url || title}.`,
            },
          ]
        : []
    return [screenshotLead, ...authLead]
  })
  return { parser: "screenshot-json", leads, summary: `${leads.length} screenshot/auth leads parsed from screenshot manifest` }
}

function parseTlsJsonl(content: string): ParsedArtifact {
  const rows = parseJsonLines(content)
  const leads = rows.map((row) => {
    const host = String(row.host ?? row.ip ?? "")
    const port = Number(row.port ?? 443)
    const subject = String(row.subject_cn ?? row.subject ?? "unknown subject")
    const issuer = String(row.issuer_cn ?? row.issuer ?? "unknown issuer")
    const expires = String(row.not_after ?? row.expires ?? "unknown expiry")
    return {
      id: leadID({ kind: "tls_certificate", asset: host, port, title: subject }),
      kind: "tls_certificate" as const,
      title: `${host}:${port} TLS certificate`,
      asset: host,
      host,
      port,
      protocol: "tls",
      severity: "info" as const,
      confidence: 0.78,
      summary: `TLS certificate subject=${subject}; issuer=${issuer}; expires=${expires}.`,
    }
  })
  return { parser: "tls-jsonl", leads, summary: `${leads.length} TLS certificates parsed from JSONL` }
}

function parseCloudJson(content: string): ParsedArtifact {
  const parsed = JSON.parse(content) as { assets?: Array<Record<string, unknown>> }
  const leads = (parsed.assets ?? []).map((asset) => {
    const provider = String(asset.provider ?? "cloud")
    const type = String(asset.type ?? "asset")
    const name = String(asset.name ?? asset.id ?? "unnamed")
    const publicExposure = asset.public === true || asset.anonymous === true || String(asset.exposure ?? "").toLowerCase() === "public"
    const scopes = safeArray(asset.scopes).map(String)
    const authURL = asset.auth_url ? String(asset.auth_url) : undefined
    const kind: "auth_surface" | "cloud_asset" = authURL || type.includes("oauth") || scopes.length ? "auth_surface" : "cloud_asset"
    return {
      id: leadID({ kind, asset: `${provider}:${type}:${name}`, title: name }),
      kind,
      title: `${provider} ${type}: ${name}`,
      asset: `${provider}:${name}`,
      url: authURL,
      severity: publicExposure ? ("medium" as const) : "info" as const,
      confidence: 0.68,
      summary: `${provider} ${type} ${name}${publicExposure ? " appears public" : " recorded"}${scopes.length ? `; scopes=${scopes.join(", ")}` : ""}${authURL ? `; auth_url=${authURL}` : ""}.`,
    }
  })
  return { parser: "cloud-json", leads, summary: `${leads.length} cloud/SaaS/auth assets parsed from JSON` }
}

function parseText(content: string): ParsedArtifact {
  const lines = content.split(/\r?\n/).filter((line) => line.trim()).slice(0, 12)
  const summary = lines.length ? lines.join("\n").slice(0, 1200) : "Text artifact contained no non-empty lines."
  return {
    parser: "text",
    summary: "Recorded raw text artifact for manual review",
    leads: [
      {
        id: leadID({ kind: "note", title: summary.slice(0, 80) }),
        kind: "note",
        title: "Raw command output needs review",
        severity: "info",
        confidence: 0.25,
        summary,
      },
    ],
  }
}

function parseArtifact(file: string, content: string, requested: EvidenceParser): ParsedArtifact {
  const parser = parserFor(file, content, requested)
  if (parser === "httpx-jsonl") return parseHttpxJsonl(content)
  if (parser === "dnsx-jsonl") return parseDnsxJsonl(content)
  if (parser === "ffuf-json") return parseFfufJson(content)
  if (parser === "zap-json") return parseZapJson(content)
  if (parser === "nmap-xml") return parseNmapXml(content)
  if (parser === "screenshot-json") return parseScreenshotJson(content)
  if (parser === "tls-jsonl") return parseTlsJsonl(content)
  if (parser === "cloud-json") return parseCloudJson(content)
  return parseText(content)
}

function mergeLeads(leads: EvidenceLead[]) {
  const byID = new Map<string, EvidenceLead>()
  for (const lead of leads) {
    const current = byID.get(lead.id)
    if (!current) {
      byID.set(lead.id, lead)
      continue
    }
    current.evidence = [...current.evidence, ...lead.evidence]
    current.confidence = Math.max(current.confidence, lead.confidence)
  }
  return [...byID.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export async function normalizeEvidence(worktree: string, input: EvidenceNormalizeInput): Promise<EvidenceNormalizationResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const requested = input.parser ?? "auto"
  const commandPlanPaths = input.commandPlanPaths?.length ? input.commandPlanPaths : await discoverCommandPlans(root)
  const commandArtifacts = await collectFromCommandPlans(root, commandPlanPaths)
  const artifacts = [
    ...new Set([...(input.artifactPaths ?? []).map((file) => resolveOperationFile(root, file)), ...commandArtifacts]),
  ]
  const evidence: EvidenceRef[] = []
  const leads: EvidenceLead[] = []

  for (const artifact of artifacts) {
    const content = await fs.readFile(artifact, "utf8")
    const parsed = parseArtifact(artifact, content, requested)
    const relative = path.relative(root, artifact)
    let evidenceRef: EvidenceRef
    if (input.writeEvidenceRecords ?? true) {
      const written = await writeEvidence(worktree, {
        operationID,
        title: `Normalized ${parsed.parser}: ${path.basename(artifact)}`,
        kind: parsed.parser.includes("http") ? "http_response" : "command_output",
        summary: parsed.summary,
        source: parsed.parser,
        path: relative,
      })
      evidenceRef = {
        id: written.evidenceID,
        path: written.record.path,
        summary: written.record.summary,
        command: written.record.command,
        createdAt: written.record.time.created,
      }
    } else {
      evidenceRef = { id: slug(path.basename(artifact), "evidence"), path: relative, summary: parsed.summary }
    }
    evidence.push(evidenceRef)
    leads.push(
      ...parsed.leads.map((lead) => ({
        ...lead,
        evidence: [evidenceRef],
        source: { parser: parsed.parser, path: relative },
      })),
    )
  }

  const generatedAt = new Date().toISOString()
  const indexPath = path.join(root, "evidence-index.json")
  const leadsPath = path.join(root, "leads.json")
  const deduped = mergeLeads(leads)
  const result: EvidenceNormalizationResult = {
    operationID,
    root,
    generatedAt,
    parser: requested,
    artifacts: artifacts.map((artifact) => path.relative(root, artifact)),
    evidence,
    leads: deduped,
    indexPath,
    leadsPath,
  }
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(indexPath, JSON.stringify({ operationID, generatedAt, artifacts: result.artifacts, evidence }, null, 2) + "\n")
  await fs.writeFile(leadsPath, JSON.stringify({ operationID, generatedAt, leads: deduped }, null, 2) + "\n")
  return result
}

export function formatEvidenceNormalization(result: EvidenceNormalizationResult) {
  return [
    `# Evidence Normalization: ${result.operationID}`,
    "",
    `- artifacts: ${result.artifacts.length}`,
    `- evidence_records: ${result.evidence.length}`,
    `- leads: ${result.leads.length}`,
    `- evidence_index: ${result.indexPath}`,
    `- leads_file: ${result.leadsPath}`,
    "",
    "## Top Leads",
    "",
    ...result.leads.slice(0, 20).map((lead) => `- ${lead.severity} ${lead.kind}: ${lead.title} (${lead.confidence})`),
    ...(result.leads.length ? [] : ["- none"]),
    "",
    "<evidence_normalization_json>",
    JSON.stringify(result, null, 2),
    "</evidence_normalization_json>",
  ].join("\n")
}

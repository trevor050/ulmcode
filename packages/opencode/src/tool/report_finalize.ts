import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Tool } from "./tool"
import { ReportBundle } from "@/report/report"
import { Session } from "@/session"
import { CyberEnvironment } from "@/session/environment"
import { PentestRuntimeSummary } from "@/session/runtime-summary"

async function listSubagentResults(root: string) {
  const agentsDir = path.join(root, "agents")
  const entries = await fs.readdir(agentsDir, { withFileTypes: true }).catch(() => [])
  const results: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === "coordination") continue
    const candidate = path.join(agentsDir, entry.name, "results.md")
    const exists = await fs
      .stat(candidate)
      .then((stat) => stat.isFile())
      .catch(() => false)
    if (exists) results.push(candidate)
  }
  return results.sort()
}

async function writeBundleIndex(input: {
  finalDir: string
  engagementRoot?: string
  report: Awaited<ReturnType<typeof ReportBundle.generate>>
  finalReportPdfPath: string
}) {
  const subagentResults = input.engagementRoot ? await listSubagentResults(input.engagementRoot) : []
  const supportArtifacts = input.engagementRoot
    ? [
        path.join(input.engagementRoot, "engagement.md"),
        path.join(input.engagementRoot, "handoff.md"),
        path.join(input.engagementRoot, "finding.md"),
        path.join(input.engagementRoot, "deliverables", "runtime-summary.md"),
        path.join(input.engagementRoot, "deliverables", "runtime-summary.json"),
      ]
    : []
  const manifest = {
    generated_at: new Date().toISOString(),
    engagement_root: input.engagementRoot ?? null,
    final_dir: input.finalDir,
    findings: input.report.findingCount,
    sources: input.report.sourceCount,
    subagents: input.report.subagentCount,
    quality_status: input.report.quality.quality_status,
    pdf_generated: input.report.pdfGenerated,
    artifacts: {
      report_pdf: input.finalReportPdfPath,
      report_html: path.join(input.finalDir, path.basename(input.report.reportHtmlPath)),
      report_markdown: path.join(input.finalDir, path.basename(input.report.reportPath)),
      results_markdown: path.join(input.finalDir, path.basename(input.report.resultsPath)),
      remediation_plan: path.join(input.finalDir, path.basename(input.report.remediationPlanPath)),
      findings_json: path.join(input.finalDir, path.basename(input.report.findingsPath)),
      sources_json: path.join(input.finalDir, path.basename(input.report.sourcesPath)),
      timeline_json: path.join(input.finalDir, path.basename(input.report.timelinePath)),
      quality_checks_json: path.join(input.finalDir, path.basename(input.report.qualityChecksPath)),
      swarm_quality_json: path.join(input.finalDir, path.basename(input.report.swarmQualityPath)),
      run_metadata_json: path.join(input.finalDir, path.basename(input.report.metadataPath)),
      runtime_summary_markdown: path.join(input.finalDir, "runtime-summary.md"),
      runtime_summary_json: path.join(input.finalDir, "runtime-summary.json"),
      support_artifacts: supportArtifacts.map((file) => path.join(input.finalDir, path.basename(file))),
      subagent_summaries: subagentResults.map((file) => path.join(input.finalDir, "subagent-summaries", path.basename(path.dirname(file)) + ".md")),
    },
  }

  const readme = [
    "# Final Deliverables",
    "",
    `- Generated: ${manifest.generated_at}`,
    `- Quality status: ${manifest.quality_status}`,
    `- Findings: ${manifest.findings}`,
    `- Sources: ${manifest.sources}`,
    `- Subagents: ${manifest.subagents}`,
    `- PDF generated: ${manifest.pdf_generated}`,
    "",
    "## Start Here",
    `- Client report PDF: ${manifest.artifacts.report_pdf}`,
    `- Client report HTML: ${manifest.artifacts.report_html}`,
    `- Results summary: ${manifest.artifacts.results_markdown}`,
    `- Remediation plan: ${manifest.artifacts.remediation_plan}`,
    "",
    "## Team Support Files",
    `- Engagement notes: ${manifest.artifacts.support_artifacts[0] ?? "n/a"}`,
    `- Handoff log: ${manifest.artifacts.support_artifacts[1] ?? "n/a"}`,
    `- Canonical findings log: ${manifest.artifacts.support_artifacts[2] ?? "n/a"}`,
    `- Runtime summary (Markdown): ${manifest.artifacts.runtime_summary_markdown}`,
    `- Runtime summary (JSON): ${manifest.artifacts.runtime_summary_json}`,
    `- Subagent summaries dir: ${path.join(input.finalDir, "subagent-summaries")}`,
    "",
    "## Machine Manifest",
    `- ${path.join(input.finalDir, "manifest.json")}`,
    "",
  ].join("\n")

  await Promise.all([
    fs.writeFile(path.join(input.finalDir, "README.md"), readme + "\n", "utf8"),
    fs.writeFile(path.join(input.finalDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8"),
  ])
}

const parameters = z.object({
  session_id: z.string().optional().describe("Target session ID. Defaults to current session."),
  engagement_root: z.string().optional().describe("Optional engagement root override."),
  output_dir: z.string().optional().describe("Optional output directory. Defaults to engagement reports dir."),
  plan_mode: z.literal("full_client_report").default("full_client_report"),
  allow_no_pdf: z.boolean().default(false).describe("Allow success in degraded mode when authored report.pdf is absent."),
})

export const ReportFinalizeTool = Tool.define("report_finalize", {
  description:
    "Validate and bundle model-authored engagement reporting artifacts into final deliverables (JSON provenance/timeline + authored markdown/PDF).",
  parameters,
  async execute(params, ctx) {
    if (ctx.agent === "report_writer" && params.allow_no_pdf) {
      throw new Error(
        "report_writer cannot set allow_no_pdf=true. Generate the authored report.pdf in this run, or run report_finalize manually outside report_writer with explicit degraded-mode intent.",
      )
    }

    const session = await Session.get(params.session_id ?? ctx.sessionID)
    const reportsDir = CyberEnvironment.resolveReportsDir(session) ?? path.join(session.directory, "reports")
    const finalDir = params.output_dir ?? CyberEnvironment.resolveDeliverablesFinalDir(session) ?? reportsDir
    const archiveBase =
      CyberEnvironment.resolveDeliverablesArchiveDir(session) ?? path.join(path.dirname(finalDir), "archive")

    await ctx.ask({
      permission: "write",
      patterns: [path.join(reportsDir, "*"), reportsDir, path.join(finalDir, "*"), finalDir, path.join(archiveBase, "*")],
      always: [path.join(reportsDir, "*"), reportsDir, path.join(finalDir, "*"), finalDir, path.join(archiveBase, "*")],
      metadata: {
        mode: params.plan_mode,
      },
    })

    const result = await ReportBundle.generate({
      sessionID: session.id,
      outDir: reportsDir,
      engagementRootOverride: params.engagement_root,
      allowNoPdf: params.allow_no_pdf,
      requireAuthoredArtifacts: true,
    })

    await fs.mkdir(finalDir, { recursive: true })
    const published = [
      result.reportPath,
      result.reportPdfPath,
      result.resultsPath,
      result.remediationPlanPath,
      result.findingsPath,
      result.sourcesPath,
      result.timelinePath,
      result.qualityChecksPath,
      result.swarmQualityPath,
      result.metadataPath,
    ]
    for (const file of published) {
      const target = path.join(finalDir, path.basename(file))
      await fs.copyFile(file, target).catch(() => {})
    }

    const archiveDir = path.join(archiveBase, new Date().toISOString().replace(/[:.]/g, "-"))
    await fs.mkdir(path.dirname(archiveDir), { recursive: true })
    await fs.cp(reportsDir, archiveDir, { recursive: true, force: true }).catch(() => {})

    const engagementRoot = session.environment?.type === "cyber" ? session.environment.root : undefined
    if (engagementRoot) {
      await PentestRuntimeSummary.write({ sessionID: session.id }).catch(() => undefined)
      const supportArtifacts = ["engagement.md", "handoff.md", "finding.md"]
      for (const filename of supportArtifacts) {
        const source = path.join(engagementRoot, filename)
        const target = path.join(finalDir, filename)
        await fs.copyFile(source, target).catch(() => {})
      }
      for (const source of [
        CyberEnvironment.resolveRuntimeSummaryMarkdownPath(session),
        CyberEnvironment.resolveRuntimeSummaryJsonPath(session),
      ]) {
        if (!source) continue
        const target = path.join(finalDir, path.basename(source))
        await fs.copyFile(source, target).catch(() => {})
      }

      const subagentResults = await listSubagentResults(engagementRoot)
      const summaryDir = path.join(finalDir, "subagent-summaries")
      await fs.mkdir(summaryDir, { recursive: true })
      for (const source of subagentResults) {
        const sessionSlug = path.basename(path.dirname(source))
        await fs.copyFile(source, path.join(summaryDir, `${sessionSlug}.md`)).catch(() => {})
      }
    }

    if (session.environment?.type === "cyber") {
      await CyberEnvironment.updateEngagementIndex({
        session,
        status: "completed",
        mode: "long_running",
        finalReportPdfPath: path.join(finalDir, path.basename(result.reportPdfPath)),
      })
      await CyberEnvironment.cleanupNoiseArtifacts(session)
    }

    if (!params.allow_no_pdf && !result.pdfGenerated) {
      throw new Error(
        `PDF generation did not complete successfully for ${result.reportPdfPath}. ${result.pdfMessage ?? ""}`.trim(),
      )
    }

    const finalReportPdfPath = path.join(finalDir, path.basename(result.reportPdfPath))
    await writeBundleIndex({
      finalDir,
      engagementRoot,
      report: result,
      finalReportPdfPath,
    })

    return {
      title: "Finalized client report bundle",
      output: [
        `Session: ${result.sessionID}`,
        `Final deliverable directory: ${finalDir}`,
        `Final report PDF: ${finalReportPdfPath}`,
        `Bundle README: ${path.join(finalDir, "README.md")}`,
        `Bundle manifest: ${path.join(finalDir, "manifest.json")}`,
        `Archive directory: ${archiveDir}`,
        `Render plan: ${result.reportRenderPlanPath}`,
        `Report HTML: ${result.reportHtmlPath}`,
        `Report markdown: ${result.reportPath}`,
        `Report PDF: ${result.reportPdfPath}`,
        `Results: ${result.resultsPath}`,
        `Remediation plan: ${result.remediationPlanPath}`,
        `Findings JSON: ${result.findingsPath}`,
        `Sources JSON: ${result.sourcesPath}`,
        `Timeline JSON: ${result.timelinePath}`,
        `Quality checks JSON: ${result.qualityChecksPath}`,
        `Swarm quality JSON: ${result.swarmQualityPath}`,
        `Run metadata: ${result.metadataPath}`,
        `Findings: ${result.findingCount}`,
        `Sources: ${result.sourceCount}`,
        `Subagents: ${result.subagentCount}`,
        `PDF generated: ${result.pdfGenerated}`,
        `Quality status: ${result.quality.quality_status}`,
        `Quality warnings: ${result.quality.warning_count}`,
        ...(result.pdfMessage ? [`PDF message: ${result.pdfMessage}`] : []),
        ...result.quality.quality_warnings.map((warning) => {
          const level = warning.level === "error" ? "ERROR" : "WARN"
          return `Quality ${level}: ${warning.finding_id ? `${warning.finding_id}: ` : ""}${warning.message}`
        }),
      ].join("\n"),
      metadata: {
        ...result,
        finalDeliverableDir: finalDir,
        finalReportPdfPath,
        archiveDir,
        quality_status: result.quality.quality_status,
        quality_warnings: result.quality.quality_warnings,
      },
    }
  },
})

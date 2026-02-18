import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Tool } from "./tool"
import { ReportBundle } from "@/report/report"
import { Session } from "@/session"
import { CyberEnvironment } from "@/session/environment"

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
      result.metadataPath,
    ]
    for (const file of published) {
      const target = path.join(finalDir, path.basename(file))
      await fs.copyFile(file, target).catch(() => {})
    }

    const archiveDir = path.join(archiveBase, new Date().toISOString().replace(/[:.]/g, "-"))
    await fs.mkdir(path.dirname(archiveDir), { recursive: true })
    await fs.cp(reportsDir, archiveDir, { recursive: true, force: true }).catch(() => {})

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

    return {
      title: "Finalized client report bundle",
      output: [
        `Session: ${result.sessionID}`,
        `Final deliverable directory: ${finalDir}`,
        `Final report PDF: ${path.join(finalDir, path.basename(result.reportPdfPath))}`,
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
        finalReportPdfPath: path.join(finalDir, path.basename(result.reportPdfPath)),
        archiveDir,
        quality_status: result.quality.quality_status,
        quality_warnings: result.quality.quality_warnings,
      },
    }
  },
})

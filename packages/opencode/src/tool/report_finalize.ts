import path from "path"
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
    const outDir =
      params.output_dir ??
      CyberEnvironment.resolveReportsDir(session) ??
      path.join(session.directory, "reports")

    await ctx.ask({
      permission: "write",
      patterns: [path.join(outDir, "*"), outDir],
      always: [path.join(outDir, "*"), outDir],
      metadata: {
        mode: params.plan_mode,
      },
    })

    const result = await ReportBundle.generate({
      sessionID: session.id,
      outDir,
      engagementRootOverride: params.engagement_root,
      allowNoPdf: params.allow_no_pdf,
      requireAuthoredArtifacts: true,
    })

    if (!params.allow_no_pdf && !result.pdfGenerated) {
      throw new Error(
        `PDF generation did not complete successfully for ${result.reportPdfPath}. ${result.pdfMessage ?? ""}`.trim(),
      )
    }

    return {
      title: "Finalized client report bundle",
      output: [
        `Session: ${result.sessionID}`,
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
        quality_status: result.quality.quality_status,
        quality_warnings: result.quality.quality_warnings,
      },
    }
  },
})

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
  allow_no_pdf: z.boolean().default(false).describe("Allow success even if reportlab/pdf generation is unavailable."),
})

export const ReportFinalizeTool = Tool.define("report_finalize", {
  description:
    "Finalize engagement reporting into a full client-grade bundle with markdown artifacts, provenance JSON, timeline JSON, and PDF.",
  parameters,
  async execute(params, ctx) {
    if (ctx.agent === "report_writer" && params.allow_no_pdf) {
      throw new Error(
        "report_writer cannot set allow_no_pdf=true. Install reportlab and generate the PDF, or run report_finalize manually outside report_writer with explicit degraded-mode intent.",
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
        `Report markdown: ${result.reportPath}`,
        `Report PDF: ${result.reportPdfPath}`,
        `Results: ${result.resultsPath}`,
        `Remediation plan: ${result.remediationPlanPath}`,
        `Findings JSON: ${result.findingsPath}`,
        `Sources JSON: ${result.sourcesPath}`,
        `Timeline JSON: ${result.timelinePath}`,
        `Run metadata: ${result.metadataPath}`,
        `Findings: ${result.findingCount}`,
        `Sources: ${result.sourceCount}`,
        `Subagents: ${result.subagentCount}`,
        `PDF generated: ${result.pdfGenerated}`,
        ...(result.pdfMessage ? [`PDF message: ${result.pdfMessage}`] : []),
      ].join("\n"),
      metadata: result,
    }
  },
})

import path from "path"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { ReportBundle } from "@/report/report"
import { EOL } from "os"
import type { Argv } from "yargs"

export const ReportCommand = cmd({
  command: "report [sessionID]",
  describe: "generate engagement report bundle from finding log",
  builder: (yargs: Argv) =>
    yargs
      .positional("sessionID", {
        describe: "session id to export report bundle for (defaults to latest parent session)",
        type: "string",
      })
      .option("out", {
        type: "string",
        describe: "output directory for report bundle artifacts",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const result = await ReportBundle.generate({
        sessionID: args.sessionID,
        outDir: args.out ? path.resolve(process.cwd(), args.out) : undefined,
      })

      process.stdout.write(`Session: ${result.sessionID}` + EOL)
      process.stdout.write(`Findings: ${result.findingCount}` + EOL)
      process.stdout.write(`Report: ${result.reportPath}` + EOL)
      process.stdout.write(`PDF: ${result.reportPdfPath}` + EOL)
      process.stdout.write(`Results: ${result.resultsPath}` + EOL)
      process.stdout.write(`Remediation Plan: ${result.remediationPlanPath}` + EOL)
      process.stdout.write(`JSON: ${result.findingsPath}` + EOL)
      process.stdout.write(`Sources: ${result.sourcesPath}` + EOL)
      process.stdout.write(`Timeline: ${result.timelinePath}` + EOL)
      process.stdout.write(`Metadata: ${result.metadataPath}` + EOL)
    })
  },
})

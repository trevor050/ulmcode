import z from "zod"
import { Tool } from "./tool"
import { loadInputItems } from "./defensive_data_adapter"

const AlertRecord = z.object({
  id: z.string().min(1),
  source: z.string().default("unknown"),
  severity: z.enum(["critical", "high", "medium", "low", "info"]).default("medium"),
  status: z.enum(["new", "triaged", "closed", "false_positive"]).default("new"),
  title: z.string().min(1),
})

const parameters = z.object({
  alerts: z.array(AlertRecord).optional().describe("Inline alert records"),
  alerts_file: z.string().optional().describe("Path to JSON array alert records"),
})

export const AlertAnalyzerTool = Tool.define("alert_analyzer", {
  description:
    "Analyze SOC alert exports to summarize severity load, source concentration, and likely false-positive pressure.",
  parameters,
  async execute(params) {
    const alerts = await loadInputItems({
      items: params.alerts,
      file: params.alerts_file,
    }).then((list) => list.map((item) => AlertRecord.parse(item)))

    const severity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    const sourceCounts = new Map<string, number>()
    let falsePositive = 0

    for (const alert of alerts) {
      severity[alert.severity] += 1
      sourceCounts.set(alert.source, (sourceCounts.get(alert.source) ?? 0) + 1)
      if (alert.status === "false_positive") falsePositive += 1
    }

    const topSources = Array.from(sourceCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source, count]) => ({ source, count }))

    const fpRate = alerts.length === 0 ? 0 : falsePositive / alerts.length

    return {
      title: "Alert analysis complete",
      output: [
        `Alerts analyzed: ${alerts.length}`,
        `Severity: critical=${severity.critical}, high=${severity.high}, medium=${severity.medium}, low=${severity.low}, info=${severity.info}`,
        `False-positive rate: ${Math.round(fpRate * 1000) / 10}%`,
        "Top noisy sources:",
        ...topSources.map((entry) => `- ${entry.source}: ${entry.count}`),
      ].join("\n"),
      metadata: {
        alerts_analyzed: alerts.length,
        severity,
        false_positive_rate: fpRate,
        top_sources: topSources,
      },
    }
  },
})

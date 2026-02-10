import z from "zod"
import { Tool } from "./tool"
import { loadInputItems } from "./defensive_data_adapter"

const IncidentEvent = z.object({
  timestamp: z.string().min(1).describe("ISO timestamp or sortable event timestamp"),
  category: z.string().default("event"),
  system: z.string().optional(),
  actor: z.string().optional(),
  summary: z.string().min(1),
})

const parameters = z.object({
  incident_id: z.string().min(1),
  events: z.array(IncidentEvent).optional().describe("Inline incident events"),
  events_file: z.string().optional().describe("Path to JSON array incident events"),
})

export const IRTimelineBuilderTool = Tool.define("ir_timeline_builder", {
  description: "Build a normalized incident timeline from exported events and produce a concise response narrative.",
  parameters,
  async execute(params) {
    const events = await loadInputItems({
      items: params.events,
      file: params.events_file,
    }).then((list) => list.map((item) => IncidentEvent.parse(item)))

    const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    const systems = Array.from(new Set(sorted.map((event) => event.system).filter(Boolean)))
    const categories = new Map<string, number>()
    for (const event of sorted) {
      categories.set(event.category, (categories.get(event.category) ?? 0) + 1)
    }

    return {
      title: `IR timeline built: ${params.incident_id}`,
      output: [
        `Incident: ${params.incident_id}`,
        `Events normalized: ${sorted.length}`,
        `Systems involved: ${systems.length}`,
        "Event category mix:",
        ...Array.from(categories.entries()).map(([category, count]) => `- ${category}: ${count}`),
        "",
        "Timeline:",
        ...sorted.map((event) => `- ${event.timestamp} [${event.category}] ${event.summary}`),
      ].join("\n"),
      metadata: {
        incident_id: params.incident_id,
        event_count: sorted.length,
        systems,
        categories: Array.from(categories.entries()).map(([category, count]) => ({ category, count })),
        timeline: sorted,
      },
    }
  },
})

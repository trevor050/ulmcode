import { z } from "zod"

export const findingStateSchema = z.enum(["candidate", "validated", "report_ready", "rejected"])

export const operationFindingInputSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  title: z.string().trim().min(4).max(240),
  state: findingStateSchema,
  severity: z.enum(["informational", "low", "medium", "high", "critical"]),
  description: z.string().trim().min(20).max(8_000),
  impact: z.string().trim().max(8_000).optional(),
  remediation: z.string().trim().max(8_000).optional(),
  affectedAssets: z.array(z.string().trim().min(1).max(500)).max(100),
  evidenceIDs: z.array(z.string().trim().min(1).max(128)).max(100),
  validationRationale: z.string().trim().min(12).max(4_000).optional(),
}).strict()

export const recordFindingsInputSchema = z.object({
  findings: z.array(operationFindingInputSchema).max(500),
  reviewedBy: z.string().trim().min(2).max(120).optional(),
}).strict().superRefine((input, context) => {
  const ids = new Set<string>()
  for (const [index, finding] of input.findings.entries()) {
    if (ids.has(finding.id)) context.addIssue({ code: "custom", path: ["findings", index, "id"], message: `duplicate finding id: ${finding.id}` })
    ids.add(finding.id)
    if (finding.state === "validated" || finding.state === "report_ready" || finding.state === "rejected") {
      if (!input.reviewedBy) context.addIssue({ code: "custom", path: ["reviewedBy"], message: `${finding.state} findings require reviewedBy` })
      if (!finding.validationRationale) context.addIssue({ code: "custom", path: ["findings", index, "validationRationale"], message: `${finding.state} findings require a validation rationale` })
    }
    if (new Set(finding.evidenceIDs).size !== finding.evidenceIDs.length) {
      context.addIssue({ code: "custom", path: ["findings", index, "evidenceIDs"], message: "evidence references must be unique" })
    }
    if ((finding.state === "validated" || finding.state === "report_ready") && finding.evidenceIDs.length === 0) {
      context.addIssue({ code: "custom", path: ["findings", index, "evidenceIDs"], message: `${finding.state} findings require evidence references` })
    }
  }
})

export const operationFindingRecordSchema = operationFindingInputSchema.extend({
  reviewedBy: z.string().trim().min(2).max(120).optional(),
})

export const findingDocumentSchema = z.object({
  operationID: z.string().min(1).max(80),
  findings: z.array(operationFindingRecordSchema).max(500),
}).strict()

export type OperationFindingInput = z.infer<typeof operationFindingInputSchema>
export type RecordFindingsInput = z.infer<typeof recordFindingsInputSchema>
export type OperationFindingRecord = z.infer<typeof operationFindingRecordSchema>
export type FindingDocument = z.infer<typeof findingDocumentSchema>

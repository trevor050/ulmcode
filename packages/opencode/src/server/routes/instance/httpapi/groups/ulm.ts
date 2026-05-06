import { Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { EVIDENCE_KINDS, FINDING_STATES, OPERATION_STATUSES, RISK_LEVELS, SEVERITIES, STAGES } from "@/ulm/artifact"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/ulm/operation"

export const UlmPaths = {
  list: root,
  status: `${root}/:operationID/status`,
  resume: `${root}/:operationID/resume`,
  audit: `${root}/:operationID/audit`,
} as const

const QueryBoolean = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
  }),
)

export const UlmListQuery = Schema.Struct({
  eventLimit: Schema.optional(Schema.NumberFromString),
})

export const UlmOperationQuery = Schema.Struct({
  eventLimit: Schema.optional(Schema.NumberFromString),
})

export const UlmResumeQuery = Schema.Struct({
  eventLimit: Schema.optional(Schema.NumberFromString),
  staleAfterMinutes: Schema.optional(Schema.NumberFromString),
})

export const UlmAuditQuery = Schema.Struct({
  eventLimit: Schema.optional(Schema.NumberFromString),
  staleAfterMinutes: Schema.optional(Schema.NumberFromString),
  minWords: Schema.optional(Schema.NumberFromString),
  requireOutlineBudget: Schema.optional(QueryBoolean),
  minOutlineWordsPerPage: Schema.optional(Schema.NumberFromString),
  requireFindingSections: Schema.optional(QueryBoolean),
  minFindingWords: Schema.optional(Schema.NumberFromString),
  finalHandoff: Schema.optional(QueryBoolean),
})

const JsonObject = Schema.Record(Schema.String, Schema.Any)
const EvidenceRef = Schema.Struct({
  id: Schema.String,
  path: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
}).annotate({ identifier: "UlmEvidenceRef" })
const OperationTime = Schema.Struct({
  created: Schema.String,
  updated: Schema.String,
}).annotate({ identifier: "UlmOperationTime" })
const OperationRecord = Schema.Struct({
  operationID: Schema.String,
  objective: Schema.String,
  stage: Schema.Literals(STAGES),
  status: Schema.Literals(OPERATION_STATUSES),
  summary: Schema.String,
  nextActions: Schema.Array(Schema.String),
  blockers: Schema.Array(Schema.String),
  riskLevel: Schema.Literals(RISK_LEVELS),
  activeTasks: Schema.Array(Schema.String),
  evidence: Schema.Array(EvidenceRef),
  notes: Schema.optional(Schema.String),
  time: OperationTime,
}).annotate({ identifier: "UlmOperationRecord" })
const FindingCounts = Schema.Struct({
  total: Schema.Finite,
  byState: Schema.Record(Schema.Literals(FINDING_STATES), Schema.Finite),
  bySeverity: Schema.Record(Schema.Literals(SEVERITIES), Schema.Finite),
}).annotate({ identifier: "UlmFindingCounts" })
const EvidenceCounts = Schema.Struct({
  total: Schema.Finite,
  byKind: Schema.Record(Schema.Literals(EVIDENCE_KINDS), Schema.Finite),
}).annotate({ identifier: "UlmEvidenceCounts" })
const ReportArtifacts = Schema.Struct({
  outline: Schema.Boolean,
  markdown: Schema.Boolean,
  html: Schema.Boolean,
  pdf: Schema.Boolean,
  readme: Schema.Boolean,
  manifest: Schema.Boolean,
}).annotate({ identifier: "UlmReportArtifacts" })
const RuntimeSnapshot = JsonObject.annotate({ identifier: "UlmRuntimeSnapshot" })
const OperationGoalStatus = Schema.Struct({
  status: Schema.String,
  objective: Schema.String,
  targetDurationHours: Schema.optional(Schema.Finite),
  updatedAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
}).annotate({ identifier: "UlmOperationGoalStatus" })
const SupervisorStatus = Schema.Struct({
  generatedAt: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  requiredNextTool: Schema.optional(Schema.String),
  blockers: Schema.Array(Schema.String),
  nextTools: Schema.Array(Schema.String),
}).annotate({ identifier: "UlmSupervisorStatus" })
const ToolInventoryStatus = Schema.Struct({
  generatedAt: Schema.optional(Schema.String),
  total: Schema.Finite,
  installed: Schema.Finite,
  missing: Schema.Finite,
  highValueMissing: Schema.Finite,
  installedHighValue: Schema.Array(Schema.String),
  missingHighValue: Schema.Array(Schema.String),
}).annotate({ identifier: "UlmToolInventoryStatus" })
const OperationStatusSummary = Schema.Struct({
  operationID: Schema.String,
  root: Schema.String,
  operation: Schema.optional(OperationRecord),
  goal: Schema.optional(OperationGoalStatus),
  supervisor: Schema.optional(SupervisorStatus),
  toolInventory: Schema.optional(ToolInventoryStatus),
  policies: Schema.Struct({
    foregroundCommand: Schema.String,
  }).annotate({ identifier: "UlmOperationPolicies" }),
  plans: Schema.Struct({ operation: Schema.Boolean }).annotate({ identifier: "UlmPlanArtifacts" }),
  findings: FindingCounts,
  evidence: EvidenceCounts,
  reports: ReportArtifacts,
  runtimeSummary: Schema.Boolean,
  runtime: Schema.optional(RuntimeSnapshot),
  lastEvents: Schema.Array(Schema.Any),
}).annotate({ identifier: "UlmOperationStatusSummary" })
const OperationResumeBrief = Schema.Struct({
  operationID: Schema.String,
  root: Schema.String,
  generatedAt: Schema.String,
  checkpoint: Schema.optional(
    Schema.Struct({
      objective: Schema.String,
      stage: Schema.Literals(STAGES),
      status: Schema.Literals(OPERATION_STATUSES),
      summary: Schema.String,
      riskLevel: Schema.Literals(RISK_LEVELS),
      nextActions: Schema.Array(Schema.String),
      blockers: Schema.Array(Schema.String),
      activeTasks: Schema.Array(Schema.String),
      time: OperationTime,
    }).annotate({ identifier: "UlmOperationCheckpointBrief" }),
  ),
  health: Schema.Struct({
    ready: Schema.Boolean,
    status: Schema.Literals(["ready", "attention_required"]),
    gaps: Schema.Array(Schema.String),
  }).annotate({ identifier: "UlmResumeHealth" }),
  artifacts: Schema.Struct({
    operation: Schema.Boolean,
    reports: ReportArtifacts,
    runtimeSummary: Schema.Boolean,
    findings: Schema.Finite,
    evidence: Schema.Finite,
  }).annotate({ identifier: "UlmResumeArtifacts" }),
  runtime: Schema.optional(RuntimeSnapshot),
  recommendedTools: Schema.Array(Schema.String),
  continuationPrompt: Schema.String,
  lastEvents: Schema.Array(Schema.Any),
}).annotate({ identifier: "UlmOperationResumeBrief" })
const OperationAuditResult = Schema.Struct({
  operationID: Schema.String,
  root: Schema.String,
  generatedAt: Schema.String,
  ok: Schema.Boolean,
  checks: Schema.Struct({
    resume: Schema.Struct({
      ok: Schema.Boolean,
      status: Schema.Literals(["ready", "attention_required"]),
      gaps: Schema.Array(Schema.String),
    }),
    finalHandoff: Schema.Struct({
      ok: Schema.Boolean,
      status: Schema.Literals(["ready", "attention_required"]),
      gaps: Schema.Array(Schema.String),
      counts: Schema.Struct({
        findings: Schema.Finite,
        reportReady: Schema.Finite,
        validated: Schema.Finite,
        candidates: Schema.Finite,
        rejected: Schema.Finite,
      }),
    }),
  }).annotate({ identifier: "UlmAuditChecks" }),
  blockers: Schema.Array(Schema.String),
  recommendedTools: Schema.Array(Schema.String),
  files: Schema.Struct({
    json: Schema.String,
    markdown: Schema.String,
  }).annotate({ identifier: "UlmAuditFiles" }),
}).annotate({ identifier: "UlmOperationAuditResult" })

export const UlmApi = HttpApi.make("ulm")
  .add(
    HttpApiGroup.make("ulm")
      .add(
        HttpApiEndpoint.get("list", UlmPaths.list, {
          query: UlmListQuery,
          success: described(Schema.Array(OperationStatusSummary), "ULMCode operation status list"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.list",
            summary: "List ULM operations",
            description: "List ULMCode operations with compact dashboard state.",
          }),
        ),
        HttpApiEndpoint.get("status", UlmPaths.status, {
          params: { operationID: Schema.String },
          query: UlmOperationQuery,
          success: described(OperationStatusSummary, "ULMCode operation status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.status",
            summary: "Get ULM operation status",
            description: "Read one ULMCode operation dashboard payload.",
          }),
        ),
        HttpApiEndpoint.get("resume", UlmPaths.resume, {
          params: { operationID: Schema.String },
          query: UlmResumeQuery,
          success: described(OperationResumeBrief, "ULMCode operation resume brief"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.resume",
            summary: "Get ULM operation resume brief",
            description: "Build a restart/compaction resume brief for one ULMCode operation.",
          }),
        ),
        HttpApiEndpoint.get("audit", UlmPaths.audit, {
          params: { operationID: Schema.String },
          query: UlmAuditQuery,
          success: described(OperationAuditResult, "ULMCode operation audit"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "ulm.operation.audit",
            summary: "Audit ULM operation handoff",
            description: "Run ULMCode final readiness checks for one operation.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "ulm", description: "Experimental ULMCode operation routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

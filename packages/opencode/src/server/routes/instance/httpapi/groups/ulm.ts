import { Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
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

export const UlmApi = HttpApi.make("ulm")
  .add(
    HttpApiGroup.make("ulm")
      .add(
        HttpApiEndpoint.get("list", UlmPaths.list, {
          query: UlmListQuery,
          success: described(Schema.Array(Schema.Any), "ULMCode operation status list"),
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
          success: described(Schema.Any, "ULMCode operation status"),
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
          success: described(Schema.Any, "ULMCode operation resume brief"),
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
          success: described(Schema.Any, "ULMCode operation audit"),
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

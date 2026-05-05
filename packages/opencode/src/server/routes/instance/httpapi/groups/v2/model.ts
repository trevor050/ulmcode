import { Modelv2 } from "@/v2/model"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../../middleware/workspace-routing"

export const ModelGroup = HttpApiGroup.make("v2.model")
  .add(
    HttpApiEndpoint.get("models", "/api/model", {
      success: Schema.Array(Modelv2.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.model.list",
        summary: "List v2 models",
        description: "Retrieve available provider models with cost, capability, provider, and variant details.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 models",
      description: "Experimental v2 model routes.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)

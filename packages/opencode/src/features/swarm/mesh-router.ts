import { SwarmIdentity } from "./identity"
import { SwarmInbox } from "./inbox"
import { SwarmTelemetry } from "./telemetry"

export namespace SwarmMeshRouter {
  export async function delegation(input: {
    teamID: string
    fromSessionID: string
    toSessionID: string
    fromAgent: string
    callerID?: string
    callerChain?: SwarmIdentity.ChainItem[]
    metadata?: Record<string, unknown>
    dualWriteSessionID?: string
  }) {
    const callerChain = SwarmIdentity.build({
      sessionID: input.fromSessionID,
      agent: input.fromAgent,
      callerID: input.callerID,
      existing: input.callerChain,
    })
    const delegationDepth = SwarmIdentity.depth(callerChain)

    const messageID = await SwarmInbox.send({
      teamID: input.teamID,
      type: SwarmInbox.MessageType.TaskOffer,
      fromSessionID: input.fromSessionID,
      toSessionID: input.toSessionID,
      payload: {
        caller_chain: callerChain,
        delegation_depth: delegationDepth,
        ...(input.metadata ?? {}),
      },
      dualWriteSessionID: input.dualWriteSessionID,
    })

    await SwarmTelemetry.event({
      teamID: input.teamID,
      sessionID: input.fromSessionID,
      type: "mesh_delegation",
      payload: {
        message_id: messageID,
        to_session_id: input.toSessionID,
        delegation_depth: delegationDepth,
      },
    })

    return {
      messageID,
      callerChain,
      delegationDepth,
    }
  }
}

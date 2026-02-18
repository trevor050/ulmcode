import { $ } from "bun"
import { SwarmTeamManager } from "./team-manager"

export namespace SwarmTmux {
  export async function available() {
    const out = await $`tmux -V`.quiet().nothrow().text()
    return out.toLowerCase().includes("tmux")
  }

  export function sessionName(teamID: string) {
    return `ulm-swarm-${teamID.slice(-8)}`
  }

  export async function ensureSession(input: { teamID: string }) {
    const cfg = await SwarmTeamManager.flags()
    if (!cfg.tmuxDefaultEnabled) {
      return {
        enabled: false,
        reason: "tmux disabled by config",
      }
    }
    if (!(await available())) {
      return {
        enabled: false,
        reason: "tmux unavailable",
      }
    }

    const name = sessionName(input.teamID)
    const has = await $`tmux has-session -t ${name}`.quiet().nothrow().text()
    if (!has) {
      await $`tmux new-session -d -s ${name}`.quiet().nothrow()
    }

    return {
      enabled: true,
      sessionName: name,
    }
  }
}

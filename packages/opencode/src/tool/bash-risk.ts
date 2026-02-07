export namespace BashRisk {
  export type Assessment =
    | {
        level: "low"
      }
    | {
        level: "sensitive"
        reason: string
        matched: string
      }

  const RULES: { reason: string; matched: string; pattern: RegExp }[] = [
    {
      reason: "potential filesystem destruction",
      matched: "rm-recursive-force",
      pattern: /\brm\b[^\n]*\s-rf?\s+\/|(^|\s)rm\s+-rf?\s+(\.|~|\/|\*)/i,
    },
    {
      reason: "potential raw disk overwrite",
      matched: "dd-disk-write",
      pattern: /\bdd\b[^\n]*\bof=\/dev\//i,
    },
    {
      reason: "potential filesystem formatting",
      matched: "filesystem-format",
      pattern: /\bmkfs(\.[a-z0-9]+)?\b|\bnewfs\b/i,
    },
    {
      reason: "service or host shutdown/restart",
      matched: "service-disruption",
      pattern: /\b(shutdown|reboot|poweroff|halt|init 0|init 6)\b/i,
    },
    {
      reason: "firewall or packet filtering disruption",
      matched: "firewall-modification",
      pattern: /\b(iptables|nft|ufw|pfctl|netsh advfirewall)\b/i,
    },
    {
      reason: "exploit-framework execution",
      matched: "exploit-framework",
      pattern: /\b(msfconsole|metasploit|exploitdb|sqlmap|beef-xss|empire)\b/i,
    },
  ]

  export function classify(command: string): Assessment {
    for (const rule of RULES) {
      if (rule.pattern.test(command)) {
        return {
          level: "sensitive",
          reason: rule.reason,
          matched: rule.matched,
        }
      }
    }
    return {
      level: "low",
    }
  }
}

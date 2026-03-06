export namespace BashRisk {
  export type RuleMatch = {
    reason: string
    matched_rule: string
    description: string
  }

  export type Assessment =
    | {
        level: "low"
      }
    | {
        level: "sensitive"
        match: RuleMatch
      }

  const RULES: (RuleMatch & { pattern: RegExp })[] = [
    {
      reason: "potential filesystem destruction",
      matched_rule: "rm-recursive-force",
      description: "recursive forced delete targeting high-risk paths",
      pattern: /\brm\b[^\n]*\s-rf?\s+\/|(^|\s)rm\s+-rf?\s+(\.|~|\/|\*)/i,
    },
    {
      reason: "potential raw disk overwrite",
      matched_rule: "dd-block-device-overwrite",
      description: "dd command writing directly to block devices",
      pattern: /\bdd\b[^\n]*\bof=\/dev\/(sd[a-z]\d*|nvme\d+n\d+(p\d+)?|vd[a-z]\d*|disk\d+|rdisk\d+)/i,
    },
    {
      reason: "potential filesystem formatting",
      matched_rule: "filesystem-format",
      description: "filesystem creation/format commands",
      pattern: /\bmkfs(\.[a-z0-9]+)?\b|\bnewfs\b/i,
    },
    {
      reason: "service or host shutdown/restart",
      matched_rule: "host-power-control",
      description: "host power or reboot control commands",
      pattern: /\b(shutdown|reboot|poweroff|halt|init 0|init 6)\b/i,
    },
    {
      reason: "packet-filter reset or firewall disable",
      matched_rule: "firewall-disruption",
      description: "commands that flush/reset rulesets or disable host firewall",
      pattern:
        /\biptables\b[^\n]*(\s-F\b|\s-X\b)|\bnft\b[^\n]*\bflush ruleset\b|\bufw\s+disable\b|\bpfctl\b[^\n]*\s-d\b|\bnetsh advfirewall set allprofiles state off\b/i,
    },
    {
      reason: "exploit-framework execution",
      matched_rule: "exploit-framework",
      description: "known intrusive exploit tooling or automated exploit execution",
      pattern: /\b(msfconsole|metasploit|exploitdb|sqlmap|beef-xss|empire)\b/i,
    },
  ]

  export function classify(command: string): Assessment {
    for (const rule of RULES) {
      if (rule.pattern.test(command)) {
        return {
          level: "sensitive",
          match: {
            reason: rule.reason,
            matched_rule: rule.matched_rule,
            description: rule.description,
          },
        }
      }
    }
    return {
      level: "low",
    }
  }
}

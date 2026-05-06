import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { buildCommandPlan, writeCommandPlan } from "@/ulm/tool-manifest"
import { tmpdir } from "../fixture/fixture"

describe("ULM tool manifest command plans", () => {
  test("renders and persists a supervised non-destructive command profile", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = path.join(dir.path, "manifest.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        lastReviewed: "2026-05-05",
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
          notes: [],
        },
        tools: [
          {
            id: "nmap",
            purpose: "service inventory",
            safety: "non_destructive",
            install: [{ platform: "darwin", command: "brew install nmap" }],
            validate: "nmap --version",
            safeExamples: ["nmap -sV <target>"],
            outputParsers: ["xml"],
            fallbacks: ["httpx"],
          },
        ],
        commandProfiles: [
          {
            id: "service-inventory",
            tool: "nmap",
            safety: "non_destructive",
            template: "nmap -sV -oA {outputPrefix} {target}",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/nmap.xml"],
          },
        ],
      }),
    )

    const plan = await buildCommandPlan({
      worktree: dir.path,
      operationID: "School",
      profileID: "service-inventory",
      variables: { target: "10.0.0.10" },
      outputPrefix: "evidence/raw/school-services",
      manifestPath,
    })
    await writeCommandPlan(plan)

    expect(plan.command).toBe("nmap -sV -oA evidence/raw/school-services 10.0.0.10")
    expect(plan.supervision.hardTimeoutSeconds).toBe(1200)
    expect(plan.artifacts).toContain("evidence/raw/school-services.xml")
    expect(plan.artifacts).toContain("evidence/raw/school-services.nmap")
    const persisted = JSON.parse(await fs.readFile(plan.planPath, "utf8")) as {
      command?: string
      supervision?: unknown
      variables?: Record<string, string>
      outputPrefix?: string
      manifestPath?: string
    }
    expect(persisted.command).toBe(plan.command)
    expect(persisted.supervision).toEqual(plan.supervision)
    expect(persisted.variables?.target).toBe("10.0.0.10")
    expect(persisted.outputPrefix).toBe("evidence/raw/school-services")
    expect(persisted.manifestPath).toBe(manifestPath)
  })

  test("rejects destructive command profiles for unattended supervision", async () => {
    await using dir = await tmpdir({ git: true })
    const manifestPath = path.join(dir.path, "manifest.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        lastReviewed: "2026-05-05",
        policy: {
          defaultSafetyMode: "non_destructive",
          destructiveSafetyMode: "interactive_destructive",
          installFailureBehavior: "record_blocker_with_fallback",
          notes: [],
        },
        tools: [
          {
            id: "ffuf",
            purpose: "content brute force",
            safety: "interactive_destructive",
            install: [{ platform: "go", command: "go install github.com/ffuf/ffuf/v2@latest" }],
            validate: "ffuf -V",
            safeExamples: ["ffuf -u https://host/FUZZ -w words"],
            outputParsers: ["json"],
            fallbacks: ["manual"],
          },
        ],
        commandProfiles: [
          {
            id: "aggressive-fuzz",
            tool: "ffuf",
            safety: "interactive_destructive",
            template: "ffuf -u {url}/FUZZ -w {wordlist}",
            heartbeatSeconds: 60,
            idleTimeoutSeconds: 600,
            hardTimeoutSeconds: 1200,
            restartable: true,
            artifacts: ["evidence/raw/ffuf.json"],
          },
        ],
      }),
    )

    await expect(
      buildCommandPlan({
        worktree: dir.path,
        operationID: "School",
        profileID: "aggressive-fuzz",
        variables: { url: "https://school.example", wordlist: "big.txt" },
        manifestPath,
      }),
    ).rejects.toThrow("unattended command_supervise only allows non_destructive")
  })
})

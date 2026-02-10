import path from "path"
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { CyberEnvironment } from "../../src/session/environment"
import { ReportBundle } from "../../src/report/report"

async function createReplayFixture(input: {
  root: string
  engagementID: string
  findingJson: string
  evidenceFiles: Record<string, string>
  reportMarkdown?: string
}) {
  const session = await Session.create({ title: `Replay ${input.engagementID}` })
  const env = {
    ...CyberEnvironment.create(session),
    root: path.join(input.root, "engagements", input.engagementID),
    engagementID: input.engagementID,
  }
  await Session.update(session.id, (draft) => {
    draft.environment = env
  })
  await CyberEnvironment.ensureSharedScaffold({ environment: env, session })

  await Bun.write(
    path.join(env.root, "finding.md"),
    [
      "# Engagement Findings",
      "",
      "## Findings",
      "",
      `<!-- finding_json:${input.findingJson} -->`,
      "",
    ].join("\n"),
  )

  for (const [relativePath, content] of Object.entries(input.evidenceFiles)) {
    const absolutePath = path.join(env.root, relativePath)
    await Bun.write(absolutePath, content)
  }

  if (input.reportMarkdown) {
    await Bun.write(path.join(env.root, "reports", "report.md"), input.reportMarkdown)
  }

  return { session, env }
}

describe("report quality replay fixtures", () => {
  test("replay ses_3c7f emits warn-mode quality warnings for weak claim/evidence links", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const finding = JSON.stringify({
          id: "FND-SES8G4F0Z4",
          title: "Redis 8.0.0 Running on Localhost Without Authentication Required",
          severity: "high",
          confidence: 0.95,
          asset: "Trevors-MacBook-Air.local",
          evidence:
            "Direct validation: redis-cli returned version 8.0.0. Also references evidence/raw/does-not-exist.txt and port 6379 open.",
          impact: "Potential local compromise.",
          recommendation: "Enable Redis auth.",
          evidence_refs: [
            { path: "evidence/raw/08-nmap-all-ports.txt", line_hint: "#L1" },
            { path: "evidence/raw/does-not-exist.txt" },
          ],
          safe_reproduction_steps: ["Run redis-cli INFO server"],
          non_destructive: true,
        })

        const { session, env } = await createReplayFixture({
          root: tmp.path,
          engagementID: "2026-02-07-ses_3c7f",
          findingJson: finding,
          evidenceFiles: {
            "evidence/raw/08-nmap-all-ports.txt": "PORT 6379/tcp open redis\n",
          },
        })

        const result = await ReportBundle.generate({
          sessionID: session.id,
          outDir: path.join(env.root, "reports"),
          allowNoPdf: true,
        })

        expect(result.quality.quality_status).toBe("warn")
        expect(result.quality.warning_count).toBeGreaterThan(0)
        const qualityChecks = (await Bun.file(path.join(env.root, "reports", "quality-checks.json")).json()) as {
          quality: { quality_status: string; quality_warnings: Array<{ code: string; finding_id?: string }> }
        }
        expect(qualityChecks.quality.quality_status).toBe("warn")
        expect(qualityChecks.quality.quality_warnings.some((w) => w.finding_id === "FND-SES8G4F0Z4")).toBe(true)
      },
    })
  })

  test("replay ses_3c82 surfaces contradiction warning for completion overclaim", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const finding = JSON.stringify({
          id: "FND-BWRDYG95XT",
          title: "Tool permission policy blocks editing engagement artifacts (results/handoff)",
          severity: "medium",
          confidence: 0.9,
          asset: "opencode cyber session tool permissions",
          evidence:
            "Error: prevents you from using this specific tool call. See evidence/raw/permission-deny.txt",
          impact: "Subagent artifact updates may be incomplete.",
          recommendation: "Adjust scoped edit policy for engagement artifacts.",
          evidence_refs: [{ path: "evidence/raw/permission-deny.txt", line_hint: ":1" }],
          safe_reproduction_steps: ["Attempt to edit agents/*/results.md"],
          non_destructive: true,
        })

        const { session, env } = await createReplayFixture({
          root: tmp.path,
          engagementID: "2026-02-07-ses_3c82",
          findingJson: finding,
          evidenceFiles: {
            "evidence/raw/permission-deny.txt": "permission: edit pattern * action deny\n",
          },
          reportMarkdown: "# Client Pentest Report\n\nStatus: complete and closed. no remaining next steps.\n",
        })

        const result = await ReportBundle.generate({
          sessionID: session.id,
          outDir: path.join(env.root, "reports"),
          allowNoPdf: true,
        })

        expect(result.quality.quality_status).toBe("warn")
        expect(result.quality.quality_warnings.some((w) => w.code === "contradiction_next_steps")).toBe(true)
      },
    })
  })

  test("replay ses_3c84 meets smoke acceptance metrics with clean evidence links", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const finding = JSON.stringify({
          id: "FND-5MCGPV43ST",
          title: "Test finding appended successfully",
          severity: "info",
          confidence: 0.8,
          asset: "127.0.0.1",
          evidence: "Validated via evidence/raw/scan.txt",
          impact: "No direct impact.",
          recommendation: "No action required.",
          evidence_refs: [{ path: "evidence/raw/scan.txt", line_hint: ":1" }],
          safe_reproduction_steps: ["nmap localhost"],
          non_destructive: true,
        })

        const { session, env } = await createReplayFixture({
          root: tmp.path,
          engagementID: "2026-02-07-ses_3c84",
          findingJson: finding,
          evidenceFiles: {
            "evidence/raw/scan.txt": "localhost scan completed\n",
          },
        })

        const result = await ReportBundle.generate({
          sessionID: session.id,
          outDir: path.join(env.root, "reports"),
          allowNoPdf: true,
        })

        expect(result.quality.evidence_link_score).toBeGreaterThanOrEqual(0.85)
        expect(result.quality.warning_count).toBeLessThanOrEqual(1)
        if (process.env.REPORT_QUALITY_CI_MODE === "strict") {
          expect(result.quality.quality_status).toBe("pass")
          expect(result.quality.warning_count).toBe(0)
        }
      },
    })
  })

  test("strict mode fails finalize when quality gates fail", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        cyber: {
          report_quality_mode: "strict",
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const finding = JSON.stringify({
          id: "FND-STRICT-FAIL",
          title: "Port 55992 exposed without linked evidence",
          severity: "high",
          confidence: 0.9,
          asset: "host",
          evidence: "port 55992 open",
          impact: "Exposure",
          recommendation: "Restrict service",
          evidence_refs: [{ path: "evidence/raw/missing.txt" }],
          safe_reproduction_steps: [],
          non_destructive: true,
        })

        const { session, env } = await createReplayFixture({
          root: tmp.path,
          engagementID: "2026-02-07-ses_3c7f-strict",
          findingJson: finding,
          evidenceFiles: {},
        })

        await expect(
          ReportBundle.generate({
            sessionID: session.id,
            outDir: path.join(env.root, "reports"),
            allowNoPdf: true,
          }),
        ).rejects.toThrow("Report quality checks failed in strict mode")
      },
    })
  })
})

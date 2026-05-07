import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { normalizeEvidence } from "@/ulm/evidence-normalizer"
import { operationPath } from "@/ulm/artifact"
import { tmpdir } from "../fixture/fixture"

describe("ULM evidence normalizer", () => {
  test("turns httpx JSONL into citable evidence and unverified URL leads", async () => {
    await using dir = await tmpdir({ git: true })
    const root = operationPath(dir.path, "School")
    const artifact = path.join(root, "evidence", "raw", "httpx.jsonl")
    await fs.mkdir(path.dirname(artifact), { recursive: true })
    await fs.writeFile(
      artifact,
      [
        JSON.stringify({
          url: "https://portal.school.example",
          host: "portal.school.example",
          status_code: 200,
          title: "Student Portal",
          tech: ["nginx", "React"],
        }),
        JSON.stringify({
          url: "https://admin.school.example",
          host: "admin.school.example",
          status_code: 403,
          title: "Forbidden",
        }),
      ].join("\n") + "\n",
    )

    const result = await normalizeEvidence(dir.path, {
      operationID: "School",
      artifactPaths: ["evidence/raw/httpx.jsonl"],
    })

    expect(result.evidence).toHaveLength(1)
    expect(result.leads).toHaveLength(2)
    expect(result.leads[0]?.evidence[0]?.id).toBe(result.evidence[0]?.id)
    expect(result.leads.some((lead) => lead.url === "https://portal.school.example")).toBe(true)
    expect(JSON.parse(await fs.readFile(result.indexPath, "utf8")).evidence).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(result.leadsPath, "utf8")).leads).toHaveLength(2)
  })

  test("discovers command plans and parses Nmap XML into host and service leads", async () => {
    await using dir = await tmpdir({ git: true })
    const root = operationPath(dir.path, "School")
    const commandRoot = path.join(root, "commands", "service-inventory")
    const artifact = path.join(root, "evidence", "raw", "nmap.xml")
    await fs.mkdir(commandRoot, { recursive: true })
    await fs.mkdir(path.dirname(artifact), { recursive: true })
    await fs.writeFile(
      artifact,
      `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="10.0.0.5" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="443">
        <state state="open"/>
        <service name="https" product="nginx" version="1.24"/>
      </port>
    </ports>
  </host>
</nmaprun>
`,
    )
    await fs.writeFile(
      path.join(commandRoot, "command-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          command: "nmap -sV -oX evidence/raw/nmap.xml 10.0.0.5",
          operationRoot: root,
          artifacts: ["evidence/raw/nmap.xml"],
        },
        null,
        2,
      ) + "\n",
    )

    const result = await normalizeEvidence(dir.path, { operationID: "School" })

    expect(result.artifacts).toEqual(["evidence/raw/nmap.xml"])
    expect(result.leads.map((lead) => lead.kind).sort()).toEqual(["host", "service"])
    expect(result.leads.find((lead) => lead.kind === "service")?.summary).toContain("nginx 1.24")
  })

  test("normalizes screenshots TLS cloud assets and auth surfaces into structured leads", async () => {
    await using dir = await tmpdir({ git: true })
    const root = operationPath(dir.path, "School")
    const screenshotManifest = path.join(root, "evidence", "screenshots", "manifest.json")
    const tlsJsonl = path.join(root, "evidence", "raw", "tlsx.jsonl")
    const cloudJson = path.join(root, "evidence", "raw", "cloud-assets.json")
    await fs.mkdir(path.dirname(screenshotManifest), { recursive: true })
    await fs.mkdir(path.dirname(tlsJsonl), { recursive: true })
    await fs.writeFile(
      screenshotManifest,
      JSON.stringify({
        screenshots: [
          {
            url: "https://portal.school.example/login",
            path: "evidence/screenshots/portal-login.png",
            title: "Student Portal Login",
            status: 200,
          },
        ],
      }),
    )
    await fs.writeFile(
      tlsJsonl,
      JSON.stringify({
        host: "portal.school.example",
        port: 443,
        subject_cn: "portal.school.example",
        issuer_cn: "Example CA",
        not_after: "2026-06-01T00:00:00Z",
      }) + "\n",
    )
    await fs.writeFile(
      cloudJson,
      JSON.stringify({
        assets: [
          {
            provider: "aws",
            type: "s3_bucket",
            name: "school-public-export",
            public: true,
            region: "us-east-1",
          },
          {
            provider: "google",
            type: "oauth_app",
            name: "Roster Sync",
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
            scopes: ["openid", "email", "admin.directory.user.readonly"],
          },
        ],
      }),
    )

    const result = await normalizeEvidence(dir.path, {
      operationID: "School",
      artifactPaths: [
        "evidence/screenshots/manifest.json",
        "evidence/raw/tlsx.jsonl",
        "evidence/raw/cloud-assets.json",
      ],
    })

    expect(result.leads.map((lead) => lead.kind).sort()).toEqual([
      "auth_surface",
      "auth_surface",
      "cloud_asset",
      "screenshot",
      "tls_certificate",
    ])
    expect(result.leads.find((lead) => lead.kind === "screenshot")?.summary).toContain("portal-login.png")
    expect(result.leads.find((lead) => lead.kind === "tls_certificate")?.summary).toContain("Example CA")
    expect(result.leads.find((lead) => lead.kind === "cloud_asset")?.severity).toBe("medium")
    expect(result.leads.find((lead) => lead.kind === "auth_surface")?.summary).toContain("admin.directory.user.readonly")
  })

  test("rejects artifact traversal outside the operation root", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      normalizeEvidence(dir.path, {
        operationID: "School",
        artifactPaths: ["../../outside.txt"],
      }),
    ).rejects.toThrow("artifact is outside operation root")
  })
})

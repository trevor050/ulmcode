import { appendFile, writeFile } from "node:fs/promises"

const mode = process.argv[2]
const marker = process.argv[3]!
const target = process.argv[4]!
await appendFile(marker, "x")
if (mode === "observe") {
  const response = await fetch(new URL("/api/lab", target), { redirect: "error", signal: AbortSignal.timeout(3000) })
  process.stdout.write(await response.text())
  if (!response.ok) process.exitCode = 1
} else if (mode === "failure") {
  process.stdout.write("Independent partial local evidence before exit 7\n")
  process.exitCode = 7
} else if (mode === "secrets") {
  const values = Object.entries(process.env)
    .filter(([key]) => key.startsWith("ULMCODE_CREDENTIAL_"))
    .flatMap((entry) => (entry[1] ? [entry[1]] : []))
  for (const value of values) {
    process.stdout.write(value.slice(0, 7))
    await Bun.sleep(15)
    process.stdout.write(value.slice(7) + "\n")
    process.stderr.write(value + "\n")
  }
  await Bun.sleep(100)
} else if (mode === "orphan") {
  const child = Bun.spawn([process.execPath, "-e", 'process.on("SIGTERM",()=>{});setTimeout(()=>{},30000)'], {
    stdio: ["ignore", "inherit", "inherit"],
  })
  await writeFile(`${marker}.pid`, String(child.pid))
  child.unref()
  process.exit(0)
} else if (mode === "long") {
  process.stdout.write("Independent long local command started\n")
  await Bun.sleep(Number(process.argv[5] ?? 2000))
  process.stdout.write("Independent long local command completed\n")
} else if (mode === "watchdog") {
  process.on("SIGTERM", () => {})
  const child = Bun.spawn([process.execPath, "-e", 'process.on("SIGTERM",()=>{});setTimeout(()=>{},30000)'], {
    stdio: ["ignore", "inherit", "inherit"],
  })
  await writeFile(`${marker}.pids.json`, JSON.stringify([process.pid, child.pid]))
  await Bun.sleep(30000)
} else throw new Error("Unknown independent fixture mode")

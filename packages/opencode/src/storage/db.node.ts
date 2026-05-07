import { createRequire } from "node:module"
import { drizzle } from "drizzle-orm/node-sqlite"

const require = createRequire(import.meta.url)
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => unknown
}

export function init(path: string) {
  const sqlite = new DatabaseSync(path)
  const db = drizzle({ client: sqlite as never })
  return db
}

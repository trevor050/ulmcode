import fs from "fs/promises"
import path from "path"

export type SupportedInput<T> = {
  items?: T[]
  file?: string
}

export async function loadInputItems<T>(input: SupportedInput<T>): Promise<T[]> {
  if (Array.isArray(input.items) && input.items.length > 0) return input.items
  if (!input.file) return []
  const content = await fs.readFile(input.file, "utf8")
  const parsed = JSON.parse(content)
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array in ${input.file}`)
  }
  return parsed as T[]
}

export function resolveFromEnvironmentRoot(environmentRoot: string | undefined, relativePath: string) {
  if (path.isAbsolute(relativePath)) return relativePath
  if (!environmentRoot) return relativePath
  return path.join(environmentRoot, relativePath)
}

import { chmodSync, copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// pnpm keeps optional platform packages beside their parent package.
const from_extension = createRequire(import.meta.resolve("neutralinojs-ext-sqlite3"))
const platform = `neutralinojs-ext-sqlite3-${process.platform}-${process.arch}`
const package_dir = dirname(from_extension.resolve(`${platform}/package.json`))
const name = process.platform === "win32" ? "neutralinojs-ext-sqlite3.exe" : "neutralinojs-ext-sqlite3"
const source = join(package_dir, "bin", name)
const target = fileURLToPath(new URL(`../bin/sqlite3/${name}`, import.meta.url))

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
if (process.platform !== "win32") chmodSync(target, 0o755)

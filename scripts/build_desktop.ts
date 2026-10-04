import "./copy_sqlite_extension.ts"
import { spawnSync } from "node:child_process"
import { chmodSync, readFileSync } from "node:fs"
import { join } from "node:path"

const { cli } = JSON.parse(readFileSync(new URL("../neutralino.config.json", import.meta.url), "utf8"))

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("pnpm", ["build"])
run("neu", ["build"])

// Use Neutralino's output directly instead of duplicating the package.
const output = join(".", cli.distributionPath, cli.binaryName)
if (process.platform !== "win32") {
  const platform = process.platform === "darwin" ? "mac" : "linux"
  const launcher = `${cli.binaryName}-${platform}_${process.arch}`
  chmodSync(join(output, launcher), 0o755)
  chmodSync(join(output, "bin/sqlite3/neutralinojs-ext-sqlite3"), 0o755)
}

console.log(`Desktop app: ${output}`)

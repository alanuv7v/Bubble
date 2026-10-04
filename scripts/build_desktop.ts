import "./copy_sqlite_extension.ts"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const { cli } = JSON.parse(readFileSync(new URL("../neutralino.config.json", import.meta.url), "utf8"))

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("pnpm", ["build"])
run("neu", ["build"])

// Keep only the launcher and SQLite extension for the machine doing the build.
const platform = { win32: "win", linux: "linux", darwin: "mac" }[process.platform]
const suffix = process.platform === "win32" ? ".exe" : ""
const launcher = `${cli.binaryName}-${platform}_${process.arch}${suffix}`
const sqlite = `bin/sqlite3/neutralinojs-ext-sqlite3${suffix}`
const bundle = join(".", cli.distributionPath, cli.binaryName)
const output = join(".", cli.distributionPath, `${process.platform}-${process.arch}`)

mkdirSync(join(output, "bin/sqlite3"), { recursive: true })
for (const file of [launcher, "resources.neu", sqlite]) {
  copyFileSync(join(bundle, file), join(output, file))
}
if (process.platform !== "win32") {
  chmodSync(join(output, launcher), 0o755)
  chmodSync(join(output, sqlite), 0o755)
}

console.log(`Desktop app: ${output}`)

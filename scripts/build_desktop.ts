/// <reference types="node" />

import "./copy_sqlite_extension.ts"
import { spawnSync } from "node:child_process"
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NtExecutable, NtExecutableResource } from "pe-library"

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
// The Windows entry owns the job; tuck the Neutralino runtime away in bin.
const windows = join(output, `${cli.binaryName}-win_x64.exe`)
const runtime = join(output, "bin/bubble-runtime.exe")
renameSync(windows, runtime)

// Reuse the icon Neutralino already applied, including its Windows icon group.
const launcher = NtExecutable.from(readFileSync(new URL("../bin/bubble-launcher.exe", import.meta.url)))
const resources = NtExecutableResource.from(launcher)
const runtime_resources = NtExecutableResource.from(NtExecutable.from(readFileSync(runtime)))
for (const entry of runtime_resources.entries) {
  // Windows resource types: 3 = icon image, 14 = icon group.
  if (entry.type === 3 || entry.type === 14) resources.replaceResourceEntry(entry)
}
resources.outputResource(launcher)
writeFileSync(windows, Buffer.from(launcher.generate()))
// Remove the previous layout's runtime from the bundle root.
rmSync(join(output, "bubble-runtime.exe"), { force: true })

if (process.platform !== "win32") {
  const platform = process.platform === "darwin" ? "mac" : "linux"
  const launcher = `${cli.binaryName}-${platform}_${process.arch}`
  chmodSync(join(output, launcher), 0o755)
  chmodSync(join(output, "bin/sqlite3/neutralinojs-ext-sqlite3"), 0o755)
}

console.log(`Desktop app: ${output}`)

import Neutralino from "@neutralinojs/lib"
import { open, shutdown, type Database } from "neutralinojs-ext-sqlite3"
import { report } from "./log"

let db: Database | null = null
let dir = ""

export function data_path() {
  return dir
}

export async function ensure_dir(path: string) {
  try { await Neutralino.filesystem.createDirectory(path) }
  catch (error) {
    // Neutralino also rejects existing directories; only that case is harmless.
    const stats = await Neutralino.filesystem.getStats(path).catch(() => null)
    if (!stats?.isDirectory) throw error
  }
}

export async function start_native_db(before_close: () => Promise<unknown>) {
  // The extension's client uses the global Neutralino instance.
  (window as any).Neutralino = Neutralino
  Neutralino.init()
  let closing = false
  await Neutralino.events.on("windowClose", async () => {
    if (closing) return
    closing = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async () => {
          await before_close()
          await db?.close()
          db = null
          await shutdown()
          // This extension version can hang even after acknowledging shutdown.
          // SQLite is our only configured extension. These handles belong to this app,
          // not other Bubble instances or unrelated processes on the user's computer.
          for (const helper of await Neutralino.os.getSpawnedProcesses()) {
            try {
              if (window.NL_OS === "Windows") {
                // Neutralino launches through cmd.exe; stop its SQLite child too.
                await Neutralino.os.execCommand(`taskkill /PID ${helper.pid} /T /F`, { background: true })
              } else {
                await Neutralino.os.updateSpawnedProcess(helper.id, "exit")
              }
            } catch (error) {
              // A helper that already exited has no process handle left.
              if ((error as { code?: string }).code !== "NE_OS_UNLTOUP") report(error, "Stop SQLite helper")
            }
          }
        })(),
        new Promise<never>((_, reject) => {
          // Bound the entire cleanup, including native helper calls.
          timer = setTimeout(() => reject(new Error("App shutdown timed out")), 5000)
        })
      ])
    } catch (error) {
      report(error, "Close app")
    } finally {
      clearTimeout(timer)
      await Neutralino.app.exit().catch((error) => {
        closing = false
        report(error, "Exit app")
      })
    }
  })
  // Desktop data stays in an ordinary folder, separate from the app bundle.
  dir = await Neutralino.os.getPath("documents") + "/Bubble"
  await ensure_dir(dir)
  db = await open({ path: `${dir}/bubble.sqlite` })
}

export async function native_sql(sql: string, bind: unknown[], rowMode: string) {
  if (!db) throw new Error("SQLite is not open")
  const rows = await db.all(sql, bind)
  return rowMode === "array" ? rows.map((row) => Object.values(row)) : rows
}

export async function native_batch(sql: string) {
  if (!db) throw new Error("SQLite is not open")
  await db.exec(sql)
}

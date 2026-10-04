import Neutralino from "@neutralinojs/lib"
import { open, type Database } from "neutralinojs-ext-sqlite3"

let db: Database | null = null
let dir = ""

export function data_path() {
  return dir
}

export async function start_native_db() {
  // The extension's client uses the global Neutralino instance.
  (window as any).Neutralino = Neutralino
  Neutralino.init()
  // Desktop data stays in an ordinary folder, separate from the app bundle.
  dir = await Neutralino.os.getPath("documents") + "/Bubble"
  await Neutralino.filesystem.createDirectory(dir)
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

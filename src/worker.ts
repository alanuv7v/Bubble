import sqlite3InitModule, { Database, OpfsDatabase } from '@sqlite.org/sqlite-wasm'

let db: Database | OpfsDatabase

let init_err: Error | null = null

const init_promise = (async () => {
  try {
    const sq = await sqlite3InitModule()
    if (!sq.oo1?.OpfsDb) {
      throw new Error('OPFS databses is not available.')
    }
    db = new sq.oo1.OpfsDb('bubble_db')
  } catch (err: any) {
    init_err = err
  }
})()

self.onmessage = async (e: MessageEvent) => {
  const { id, sql, bind, rowMode, returnValue } = e.data
  try {
    await init_promise
    if (init_err) throw init_err
    const res = db.exec({ 
      sql, 
      bind, 
      rowMode: rowMode ?? 'object', 
      returnValue: returnValue ?? 'resultRows' 
    })
    self.postMessage({ id, res })
  } catch (err: any) {
    self.postMessage({ id, err: err.message ?? String(err) })
  }
}
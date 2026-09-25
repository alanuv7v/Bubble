import Neutralino from "@neutralinojs/lib"
import yaml from "yaml"
import { type ClientRequests } from "../fs.ts"

const fs = Neutralino.filesystem

const jobs: ClientRequests = {
  get: {
    dir: async (path: string) => {
      let entries = await fs.readDirectory(path)
      return entries.map(e => ({
        name: e.entry,
        is_dir: e.type === "DIRECTORY",
      }))
    },
    file: (path: string) => fs.readBinaryFile(path),
    text: (path: string) => fs.readFile(path),
    obj: async (path: string) => {
      let text = await fs.readFile(path)
      if (!text) return {}
      return yaml.parse(text)
    },
  },
  set: {
    text: async (path: string, val: string) => {
      await fs.writeFile(path, val)
      return true
    },
    obj: (path: string, obj: object) => jobs.set.text(path, yaml.stringify(obj)),
  },
  del: {
    file: async (path: string) => {
      await fs.remove(path)
      return true
    },
    dir: (path: string) => jobs.del.file(path),
  },
  append: {
    text: async (path: string, val: string) => {
      await fs.appendFile(path, val)
      return true
    },
  },
  mkdir: async (path: string) => {
    await fs.createDirectory(path)
  },
  rename: async (path: string, into: string) => {
    let spl = path.split('/')
    spl[spl.length - 1] = into
    let dst = into.includes('/') ? into : spl.join('/')
    await fs.move(path, dst)
    return true
  },
  copy: {
    file: async (src: string, dst: string) => {
      await fs.copy(src, dst)
      return true
    },
    dir: (src: string, dst: string) => jobs.copy.file(src, dst),
  },
  move: {
    file: async (src: string, dst: string) => {
      await fs.move(src, dst)
      return true
    },
    dir: (src: string, dst: string) => jobs.move.file(src, dst),
  },
}

export default jobs
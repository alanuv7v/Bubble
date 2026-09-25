import fs from "node:fs"
import PATH from "node:path"
//import trash from 'trash'
import * as yaml from "yaml"

const all = {
  get: { 
    dir (path: string): {name: string, is_dir: boolean}[] {
      return fs.readdirSync(path).map(name => {
        return {
          name,
          is_dir: fs.statSync(PATH.join(path, name)).isDirectory()
        }
      })
    },
    file: fs.readFileSync,
    text: (path: string, opts = { make: false }) => {
      if (!fs.existsSync(path) && opts.make ) {
        all.set.text(path, "")
        return ""
      }
      return fs.readFileSync(path).toString("utf-8")
    },
    yaml (path: string) {
      const read_res = fs.readFileSync(path).toString()
      if (read_res === undefined || typeof read_res !== "string") throw Error(`The content of "${path}" is not text`)
      if (read_res.length < 1) return {}
      return yaml.parse(read_res) as Record<string, any>
    }
  },
  set: {
    text: fs.writeFileSync,
    yaml: (path: string, obj: Object) => fs.writeFileSync(path, yaml.stringify(obj)),
  },
  // del: {
  //   file: trash,
  //   dir: trash,
  // },
  ls: fs.readdirSync,
  append_text: fs.appendFileSync,
  rename: fs.renameSync,
  mkdir: fs.mkdirSync,
  copy: fs.cpSync,
  stat: fs.statSync
}

export default all
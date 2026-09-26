import { FieldDef, instantiate, TYPES } from "../definitions"
import t from "../tags"

function run_fixer (def: Record<string, any>, raw_val: any): { ok: boolean, val?: any } {
  if (!def) return { ok: true, val: raw_val }

  let typedef = TYPES[def.__type]
  let merged = { ...typedef?.field, ...def }
  //@ts-ignore
  let fixer = typedef?.fixer

  if (!fixer) return { ok: true, val: raw_val }

  let val = fixer(merged, raw_val)
  if (val === undefined) return { ok: false }
  return { ok: true, val }
}


export function val_c (
  key: string | number, 
  obj: Record<string, any>, 
  def?: Record<string, any>, 
  is_listed: boolean = false
): HTMLElement {

  let raw = obj[key]
  let type_name = def?.__type

  const key_ = (dom: HTMLElement) => {
    return !is_listed ? key : Number(dom.getAttribute("_index"))
  }

  if (type_name && def) {
    if (type_name === "number" || type_name === "int") {
      let is_int = type_name === "int"
      let fdef = { ...TYPES[type_name]?.field ?? {}, ...def }
      let dom = t.input({
        type: "number",
        value: raw ?? fdef.default ?? 0,
        min: fdef.min,
        max: fdef.max,
        step: is_int ? 1 : 0.1,
        onblur: () => {
          let fixed = run_fixer(def, dom.value)
          if (!fixed.ok) {
            dom.classList.add("error")
            return
          }
          dom.classList.remove("error")
          dom.value = fixed.val
          obj[key_(dom)] = fixed.val
        }
      }) as HTMLInputElement
      return dom
    }

    if (type_name === "boolean") {
      let dom = t.input({
        type: "checkbox",
        checked: Boolean(raw ?? def?.default ?? false),
        onchange: () => {
          obj[key_(dom)] = dom.checked
        }
      }) as HTMLInputElement
      return dom
    }

    if (type_name === "str_in") {
      if (!def || !def.among || def.among.length < 1) throw new Error("Missing 'among' in str_in def")
      let val = raw ?? def.default
      let idx = (def.among as string[]).findIndex(s => s === val)
      if (idx <= 0) {
        val = def.among[0]
        idx = 0
      }
      const option_doms = def.among.map(s => t.option(s))
      const select_dom = t.select({
        selectedIndex: idx,
        onblur: () => {
          const selected = select_dom.selectedOptions[0]
          obj[key_(dom)] = selected.value
        }
      }, ...option_doms) as HTMLSelectElement

      const dom = select_dom //tags.select_c(select_dom) as HTMLInputElement
      return dom
    }
    

    if (type_name === "str_in_dynamic") {
      if (!def || !def.among) throw new Error("Missing 'among' in str_in_dynamic def")

      let all_allowed: string[] = []
      let val = raw ?? def.default ?? ""

      let can_update_options: boolean = true

      const update_options = () => select_dom.replaceChildren(
        ...all_allowed
        .filter(s => s.toLowerCase().startsWith(input_dom.value.toLowerCase()))
        .slice(0, 10)
        .map(s => {
          return t.option(s)
        })
      )

      const check_if_included = () => {
        const found = all_allowed
        .find(s => s === input_dom.value)
        if (found === undefined) {
          input_dom.classList.add("error")
          return false
        }
        input_dom.classList.remove("error")
        val = found
        return true
      }

      def.among().then((ls: string[]) => {
        all_allowed = ls
        update_options()
      })

      const input_dom = t.input({
        type: "text",
        value: val,
        onchange: () => {
          if (can_update_options) update_options()
        },
        onblur: () => {
          if (!check_if_included()) {
            return
          }
          select_dom.selectedIndex = Array.from(select_dom.children).findIndex(c => (c as HTMLOptionElement).innerText === val)
          obj[key_(dom)] = val
        }
      }) as HTMLInputElement
      
      const select_dom = t.select({
        onblur: () => {
          val = select_dom.selectedOptions[0].innerText
          obj[key_(dom)] = val
        },
        onchange: () => {
          can_update_options = false
          input_dom.value = select_dom.selectedOptions[0].innerText
          can_update_options = true
          input_dom.classList.remove("error")
        }
      }, t.option("...loading...")) as HTMLSelectElement

      const dom = t.val_c(
        input_dom, select_dom
      ) //tags.select_c(select_dom) as HTMLInputElement
      return dom
    }

    if (type_name === "datetime") {
      const here = Temporal.Now.timeZoneId()
      const dom = t.input({ 
        type: "datetime-local",
        value: Temporal.Instant
          .fromEpochMilliseconds(raw)
          .toZonedDateTimeISO(here)
          .toPlainDateTime()
          .toString({ smallestUnit: "minute" }),
        onchange: () => {
          const ms = Temporal.PlainDateTime.from(dom.value).toZonedDateTime(here).epochMilliseconds
          obj[key_(dom)] = ms
        }
       }) as HTMLInputElement
      return dom
    }

    if (type_name === "string") {
      let is_nullable = def?.nullable ?? false
      let dom = t.val_c({
        contentEditable: "true",
        innerText: raw ?? def?.default ?? "",
        onblur: () => {
          let v = dom.innerText.trim()
          if (is_nullable && v.length === 0) {
            obj[key_(dom)] = null
            return
          }
          let fixed = run_fixer(def, v)
          if (!fixed.ok) {
            dom.classList.add("error")
            return
          }
          dom.classList.remove("error")
          dom.value = fixed.val
          obj[key_(dom)] = fixed.val
        }
      }) as HTMLInputElement
      return dom
    }

    if (type_name === "array") {
      let allow = def?.allows ?? { __type: "string" }
      return arr_c(obj[key] ?? [], allow)
    }

    if (type_name === "object") {
      if (!obj[key]) obj[key] = def?.default ? { ...def?.default } : {}
      return obj_c(obj[key], def?.def)
    }
  }

  if (Array.isArray(raw)) {
    return arr_c(raw, { __type: "string" })
  }

  let val_type = typeof raw
  if (val_type === "object" && raw !== null) {
    return obj_c(raw)
  }

  if (val_type === "number") {
    let dom = t.input({
      type: "number",
      value: raw,
      step: Number.isInteger(raw) ? 1 : 0.1,
      onblur: () => {
        let n = Number(dom.value)
        if (Number.isNaN(n)) {
          dom.classList.add("error")
          return
        }
        dom.classList.remove("error")
        obj[key_(dom)] = n
      }
    }) as HTMLInputElement
    return dom
  }

  if (val_type === "boolean") {
    let dom = t.input({
      type: "checkbox",
      checked: raw,
      onchange: () => {
        obj[key_(dom)] = dom.checked
      }
    }) as HTMLInputElement
    return dom
  }

  if (val_type === "string") {

    let dom = t.val_c({
      contentEditable: "true",
      innerText: raw,
      onblur: () => {
        obj[key_(dom)] = dom.innerText.trim()
      }
    }) as HTMLInputElement
    return dom
  }

  return t.val_c({ innerText: "?" })
}

export function arr_c (
  arr: any[], 
  allow_def: Record<string, any>, 
) {
  debugger
  let dom: HTMLElement
  
  dom = t.arr_c() as HTMLElement

  const vals: HTMLElement[] = []

  function item_c (idx: number, new_: boolean = false) {
    let val_node = val_c(idx, arr, allow_def, true)
    vals.push(val_node)
    let rm_btn = t.button({
      innerText: "x",
      onclick () {
        arr.splice(idx, 1)
        vals.splice(idx, 1)
        res.remove()
        update()
      }
    })
    let res = t.item_c(val_node, rm_btn)
    if (new_) val_node.focus()
    return res
  }

  dom.append(
    ...arr.map((item, idx) => item_c(idx))
  )

  function update () {
    vals.forEach((v, i) => v.setAttribute("_index", i.toString()))
  }

  const add_btn = t.button({
    innerText: "+",
    onclick () {
      let to_add = instantiate(allow_def)
      arr.push(to_add)
      add_btn.before(item_c(arr.length -1, true))
      update()
    }
  })
  dom.append(
    add_btn
  )
  update()
  return dom
}

export function obj_c (obj: Record<string, any>, def?: Record<string, any>) {
  return t.obj_c(
    ...Object.keys(obj).map(key => {
      let field_def = def && typeof def === "object" ? (def as any)[key] : undefined
      return t.pair_c(t.key_c(key), val_c(key, obj, field_def))
    })
  ) as HTMLDivElement
}

const stat_c = t.stat_c()

export function obj_editor (
  def: Record<string, any> | undefined,
  obj: any[] | Record<string, any>,
  handlers: {
    save?: (old_id?: string) => string | Promise<string> 
  } = {},
  title?: string,
) {
  const old_id = obj["id"]

  const handler_trigger_btns = Object.keys(handlers)
  .map(k => {
    let h = handlers[k]
    if (!h) return
    return t.button({
      innerText: k,
      async onclick () {
        stat_c.innerText = await h(old_id)
        setTimeout(() => {
          stat_c.innerText = ""
        }, 5000);
      }
    })
  }).filter(Boolean)

  return t.obj_editor(
    title ? t.h2(title) : {},
    Array.isArray(obj) ? arr_c(obj, def?.allows) : obj_c(obj, def),
    ...handler_trigger_btns,
    stat_c
  )
}

export default obj_editor
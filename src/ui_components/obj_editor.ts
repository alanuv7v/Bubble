import { instantiate, TYPES } from "../definitions"
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


type FieldContext = {
  key: string | number
  obj: Record<string, any>
  raw: any
  def?: Record<string, any>
  get_key: (dom?: HTMLElement) => string | number
  set_null?: (is_null: boolean) => void
  is_duplicate?: (value: any) => boolean
}
type FieldRenderer = (field: FieldContext) => HTMLElement
type FieldKey = string | number | (() => string | number)

export function val_c (
  key: FieldKey,
  obj: Record<string, any>,
  def?: Record<string, any>,
  is_duplicate?: (value: any) => boolean
): HTMLElement[] {
  const get_key = typeof key === "function" ? key : () => key
  const resolved_key = get_key()
  const raw = obj[resolved_key]
  const field: FieldContext = {
    key: resolved_key,
    obj,
    raw,
    def,
    get_key: () => get_key(),
    is_duplicate
  }
  const control = def?.__type
    ? typed_renderers[def.__type]?.(field) ?? t.val_c()
    : def && raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? obj_c(raw, def)
      : inferred_control(field)
  control.classList.add("obj-editor-control")
  if (is_duplicate?.(raw)) mark_duplicate(control)

  if (!def?.nullable) return [control]

  let previous_value = raw ?? def.default ?? TYPES[def.__type]?.field.default
  const set_disabled = (disabled: boolean) => {
    control.classList.toggle("disabled", disabled)
    if (control instanceof HTMLInputElement
      || control instanceof HTMLSelectElement
      || control instanceof HTMLTextAreaElement) {
      control.disabled = disabled
    }
  }
  const nullable = t.input({
    type: "checkbox",
    checked: raw == null,
    onchange: (event: Event) => {
      const checkbox = event.currentTarget as HTMLInputElement
      set_disabled(checkbox.checked)
    },
    onblur: (event: Event) => {
      const checkbox = event.currentTarget as HTMLInputElement
      field.set_null?.(checkbox.checked)
    }
  }) as HTMLInputElement
  field.set_null = (is_null) => {
    const value_key = field.get_key(control)
    if (is_null) {
      previous_value = obj[value_key] ?? previous_value
      obj[value_key] = null
    } else {
      obj[value_key] = previous_value
      if (control.isContentEditable) {
        control.innerText = String(previous_value ?? "")
      }
    }
    nullable.checked = is_null
    set_disabled(is_null)
  }
  set_disabled(raw == null)
  const nullable_label = t.label(
    { className: "nullable-toggle" },
    nullable,
    t.span("Null")
  )
  return [nullable_label, control]
}

function mark_duplicate (control: HTMLElement) {
  control.classList.add("error")
  control.title = "This value is already in the set"
}

function save_field_value (
  field: FieldContext,
  control: HTMLElement,
  value: any
) {
  if (field.is_duplicate?.(value)) {
    mark_duplicate(control)
    return false
  }
  control.classList.remove("error")
  control.removeAttribute("title")
  field.obj[field.get_key(control)] = value
  return true
}

const typed_renderers: Record<string, FieldRenderer> = {
  number: (field) => number_control(field, false),
  int: (field) => number_control(field, true),
  boolean: boolean_control,
  str_in: choice_control,
  str_in_dynamic: dynamic_choice_control,
  datetime: datetime_control,
  string: string_control,
  array: (field) => array_control(field, false),
  set: (field) => array_control(field, true),
  object: object_control
}

function array_control (field: FieldContext, unique: boolean): HTMLElement {
  const key = field.get_key()
  const arr = field.obj[key] ?? []
  field.obj[key] = arr
  if (unique) remove_duplicate_items(arr)
  return arr_c(arr, field.def?.allows ?? { __type: "string" }, unique)
}

function remove_duplicate_items (items: any[]) {
  const seen = new Set<any>()
  for (let i = 0; i < items.length;) {
    if (seen.has(items[i])) items.splice(i, 1)
    else {
      seen.add(items[i])
      i++
    }
  }
}

function number_control (field: FieldContext, integer: boolean): HTMLElement {
  const def = field.def!
  const field_def = { ...TYPES[def.__type]?.field, ...def }
  let input: HTMLInputElement
  input = t.input({
    type: "number",
    value: field.raw ?? field_def.default ?? 0,
    min: field_def.min,
    max: field_def.max,
    step: integer ? 1 : 0.1,
    onblur: () => {
      const fixed = run_fixer(def, input.value)
      if (!fixed.ok) {
        input.classList.add("error")
        return
      }
      input.classList.remove("error")
      input.value = String(fixed.val)
      save_field_value(field, input, fixed.val)
    }
  }) as HTMLInputElement
  return input
}

function boolean_control (field: FieldContext): HTMLElement {
  const input = t.input({
    type: "checkbox",
    checked: Boolean(field.raw ?? field.def?.default ?? false),
    onblur: () => {
      save_field_value(field, input, input.checked)
    }
  }) as HTMLInputElement
  return input
}

function choice_control (field: FieldContext): HTMLElement {
  const choices = field.def?.among as string[] | undefined
  if (!choices?.length) throw new Error("Missing 'among' in str_in def")
  const requested = field.raw ?? field.def?.default ?? choices[0]
  const select = t.select({
    onblur: () => {
      save_field_value(field, select, select.value)
    }
  }, ...choices.map((choice) => t.option(choice))) as HTMLSelectElement
  select.value = choices.includes(requested) ? requested : choices[0]
  return select
}

function dynamic_choice_control (field: FieldContext): HTMLElement {
  const load_choices = field.def?.among as (() => Promise<string[]>) | undefined
  if (!load_choices) throw new Error("Missing 'among' in str_in_dynamic def")

  let choices: string[] = []
  let update_from_input = true
  let control: HTMLElement
  const input = t.input({
    type: "text",
    value: field.raw ?? field.def?.default ?? "",
    onchange: () => {
      if (update_from_input) update_options()
    },
    onblur: () => {
      const value = input.value
      if (!choices.includes(value)) {
        input.classList.add("error")
        return
      }
      input.classList.remove("error")
      save_field_value(field, input, value)
    }
  }) as HTMLInputElement
  const select = t.select({
    onchange: () => {
      update_from_input = false
      input.value = select.value
      update_from_input = true
      input.classList.remove("error")
    },
    onblur: () => {
      if (select.value) save_field_value(field, control, select.value)
    }
  }, t.option("...loading...")) as HTMLSelectElement
  control = t.val_c(input, select)

  function update_options () {
    select.replaceChildren(...choices
      .filter((choice) => choice.toLowerCase().startsWith(input.value.toLowerCase()))
      .slice(0, 10)
      .map((choice) => t.option(choice)))
  }

  void load_choices().then((loaded) => {
    choices = loaded
    update_options()
  }).catch(() => {
    input.classList.add("error")
    select.replaceChildren(t.option("Could not load choices"))
  })
  return control
}

function datetime_control (field: FieldContext): HTMLElement {
  const timezone = Temporal.Now.timeZoneId()
  return t.input({
    type: "datetime-local",
    value: Temporal.Instant.fromEpochMilliseconds(field.raw)
      .toZonedDateTimeISO(timezone)
      .toPlainDateTime()
      .toString({ smallestUnit: "minute" }),
    onblur: (event: Event) => {
      const input = event.currentTarget as HTMLInputElement
      const value = Temporal.PlainDateTime.from(input.value)
        .toZonedDateTime(timezone).epochMilliseconds
      save_field_value(field, input, value)
    }
  })
}

function string_control (field: FieldContext): HTMLElement {
  const control = t.val_c({
    contentEditable: "true",
    innerText: field.raw ?? field.def?.default ?? "",
    onblur: () => {
      const value = control.innerText.trim()
      if (field.def?.nullable && value.length === 0) {
        field.set_null?.(true)
        return
      }
      const fixed = run_fixer(field.def!, value)
      if (!fixed.ok) {
        control.classList.add("error")
        return
      }
      control.classList.remove("error")
      control.innerText = String(fixed.val ?? "")
      save_field_value(field, control, fixed.val)
    }
  })
  return control
}

function object_control (field: FieldContext): HTMLElement {
  if (!field.obj[field.key]) {
    field.obj[field.key] = field.def?.default ? { ...field.def.default } : {}
  }
  return obj_c(field.obj[field.key], field.def?.def)
}

function inferred_control (field: FieldContext): HTMLElement {
  const type = field.raw === null
    ? "null"
    : Array.isArray(field.raw) ? "array" : typeof field.raw
  return inferred_renderers[type]?.(field) ?? t.val_c({ innerText: "?" })
}

const inferred_renderers: Record<string, FieldRenderer> = {
  array: (field) => arr_c(field.raw, { __type: "string" }),
  object: (field) => obj_c(field.raw),
  number: (field) => {
    const input = t.input({
      type: "number",
      value: field.raw,
      step: Number.isInteger(field.raw) ? 1 : 0.1,
      onblur: () => {
        const value = Number(input.value)
        if (!Number.isFinite(value)) {
          input.classList.add("error")
          return
        }
        input.classList.remove("error")
        save_field_value(field, input, value)
      }
    }) as HTMLInputElement
    return input
  },
  boolean: boolean_control,
  string: (field) => t.val_c({
    contentEditable: "true",
    innerText: field.raw,
    onblur: (event: Event) => {
      const target = event.currentTarget as HTMLElement
      save_field_value(field, target, target.innerText.trim())
    }
  })
}

export function arr_c (
  arr: any[],
  allow_def: Record<string, any>,
  unique = false
) {
  const dom = t.arr_c() as HTMLElement
  if (unique) remove_duplicate_items(arr)
  const row_keys = arr.map(() => ({}))

  function item_c (row_key: object, focus = false) {
    const index = () => row_keys.indexOf(row_key)
    const is_duplicate = unique
      ? (value: any) => arr.some((item, i) => i !== index() && Object.is(item, value))
      : undefined
    const controls = val_c(index, arr, allow_def, is_duplicate)
    let row: HTMLElement
    const remove_button = t.button({
      innerText: "x",
      onclick: () => {
        const current_index = index()
        if (current_index < 0) return
        arr.splice(current_index, 1)
        row_keys.splice(current_index, 1)
        row.remove()
      }
    })
    row = t.item_c()
    row.append(...controls, remove_button)
    if (focus) controls[0]?.focus()
    return row
  }

  dom.append(...row_keys.map((row_key) => item_c(row_key)))

  const notice = t.span({ className: "set-notice", role: "status" })
  const add_btn = t.button({
    innerText: "+",
    onclick () {
      const item = instantiate_array_item(allow_def)
      if (unique && arr.some((existing) => Object.is(existing, item))) {
        notice.innerText = "This value is already in the set"
        return
      }
      notice.innerText = ""
      arr.push(item)
      const row_key = {}
      row_keys.push(row_key)
      add_btn.before(item_c(row_key, true))
    }
  })
  dom.append(add_btn, notice)
  return dom
}

function instantiate_array_item (allow_def: Record<string, any>) {
  return allow_def.__type
    ? instantiate({ value: allow_def }).value
    : instantiate(allow_def)
}

export function obj_c (obj: Record<string, any>, def?: Record<string, any>) {
  const keys = new Set([...Object.keys(obj), ...Object.keys(def ?? {})])
  return t.obj_c(
    ...[...keys].map((key) => {
      const field_def = def?.[key]
      if (!Object.prototype.hasOwnProperty.call(obj, key) && field_def) {
        const value = instantiate({ [key]: field_def })[key]
        obj[key] = Array.isArray(value) ? [...value] : value
      }
      return t.pair_c(t.key_c(key), ...val_c(key, obj, field_def))
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
        stat_c.classList.add("pending")
        stat_c.innerText = await h(old_id)
        stat_c.classList.remove("pending")
        setTimeout(() => {
          stat_c.innerText = ""
        }, 5000);
      }
    })
  }).filter(Boolean)

  return t.obj_editor(
    title ? t.h2(title) : {},
    Array.isArray(obj)
      ? arr_c(obj, def?.allows ?? { __type: "string" }, def?.__type === "set")
      : obj_c(obj, def),
    ...handler_trigger_btns,
    stat_c
  )
}

export default obj_editor

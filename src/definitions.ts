import { exec_sql } from "./database"

export type TypeDef = {
  field: { default?: any } & Record<string, any>
  fixer?: (self: any, val: any) => any
}

const number_fixer = (self: Record<string, any>, v: any) => {
  let n = Number(v)
  if (!Number.isFinite(n)) return
  if (self.min !== undefined && n < self.min) {
    if (self.cap) n = self.min
    else return
  }
  if (self.max !== undefined && n > self.max) {
    if (self.cap) n = self.max
    else return
  }
  return n
}

export const TYPES = {
  file: {
    field: { 
      default: "" as string, 
    }
  },
  string: {
    field: { 
      default: "" as string, 
      nullable: false as boolean
     },
    fixer: (_, v) => String(v ?? "")
  },
  number: {
    field: { 
      default: 0 as number, 
      min: -10 as number, 
      max: 10 as number, 
      cap: true as boolean, 
      nullable: false as boolean
    },
    fixer (self, v) {
      number_fixer(self, v)
    }
  },
  int: {
    field: { 
      default: 0 as number, 
      min: -10 as number, 
      max: 10 as number, 
      cap: true as boolean, 
      nullable: false as boolean
    },
    fixer (self, v) {
      let n = number_fixer(self, v)
      if (n === undefined) return
      if (!Number.isInteger(n)) {
        if (!self.round) return
        n = Math.round(n)
      }
      return n
    }
  },
  boolean: {
    field: { 
      default: true as boolean,
      nullable: false as boolean
    },
    fixer: (_, v) => Boolean(v)
  },
  str_in: {
    field: { 
      default: "" as string, 
      among: [] as string[] 
    },
    fixer (self, v) {
      if (!self.among?.includes(v)) return
      return v
    }
  },
  str_in_dynamic: {
    field: { 
      default: "" as string, 
      among: (async () => ([] as string[]))
    },
    /*
    I will just let the UI handle the checking. 
    async fixer (self, v) {
      let ls = await self.among(v)
      if (!ls.includes(v)) return
      return v
    } */
  },
  datetime: {
    field: { 
      default: 0 as number 
    },
  },
  array: {
    field: { 
      default: [] as any[],
      allows: {} as Object
    }
  },
  object: {
    field: { 
      default: {} as Record<string|symbol, any>, 
      def: {} as Record<string|symbol, any>
    }
  }
} as const satisfies Record<string, TypeDef>


export type KnownCustomTypeName = keyof (typeof TYPES)
export type CustomType<K extends KnownCustomTypeName> = (typeof TYPES)[K]


export type FieldDef = {
  __type: KnownCustomTypeName
} & CustomType<KnownCustomTypeName>["field"]


export function instantiate (def: Record<string, any>) {
  if (!def || typeof def !== "object") return def
  //@ts-ignore
  if (Array.isArray(def)) return def.map(instantiate)

  const res: Record<string, any> = {}
  for (const k in def) {
    const item = def[k]
    if (!item || typeof item !== "object") {
      res[k] = item
      continue
    }
    if (item.__type && item.__type in TYPES) {
      if (item.__type === "object" && item.def) {
        res[k] = instantiate(item.def)
        continue
      }
      const type_def = TYPES[item.__type]
      res[k] = item.default ?? type_def.field.default
      continue
    }
    res[k] = instantiate(item)
  }
  return res
}


// ------------


export type Id = string

export type Role = 'user' | 'assistant' | 'system'

export type CoreMessage = {
  role: Role
  content: string
}

export type Message = Omit<CoreMessage, "content"> & {
  id: Id
  content: string|null // null if role === "assistant"
  chat_id: Id
  speaker_id: Id
  listener_id: Id
  created_at: number // UNIX timestamp
  picked: number
}

export type TextGen = {
  msg_id: Id
  content: string
  model: string
  tokens: number
  cost: number
  created_at: number // UNIX timestamp
}

export const LlmParamsSimple = {
  model: {
    __type: "string",
    default: "~google/gemini-flash-latest"
  },
  messages: {
    __type: "array",
    default: [
      { 
        role: "system", 
        content: (
          "You are {{char.name}}. Roleplay as {{char.name}}.\n"
          + "# About {{char.name}}\n"
          + "{{char.desc}}"
          + "# About {{user.name}}\n"
          + "{{user.desc}}"
        )
      }
    ] as CoreMessage[],
    allows: {
      role: {
        __type: "str_in",
        among: ["system", "user", "assistant"] as Role[],
        default: "system"
      },
      content: {
        __type: "string",
        default: ""
      }
    }
  },
  stream: {
    __type: "boolean",
    default: true,
  },
  reasoning_effort: {
    __type: "str_in",
    among: ["xhigh", "high", "medium", "low", "minimal", "none"],
    default: "low",
  },
  temperature: {
    __type: "number",
    min: 0,
    max: 2,
    default: 1,
  },
  max_tokens: {
    __type: "int",
    min: 1,
    max: Infinity,
    default: 50000,
  },
} satisfies Record<string, Partial<FieldDef>> 

export const LlmParams = {
  ...LlmParamsSimple,
  top_p: {
    __type: "number",
    min: 0,
    max: 1,
    default: 1,
  },
  top_k: {
    __type: "number",
    min: 0,
    max: 1,
    default: 0,
  },
  frequency_penalty: {
    __type: "number",
    min: -2,
    max: 2,
    default: 0,
  },
  presence_penalty: {
    __type: "number",
    min: 0,
    max: 1,
    default: 0,
  },
  repetition_penalty: {
    __type: "number",
    min: 0,
    max: 2,
    default: 1
  },
  min_p: {
    __type: "number",
    min: 0,
    max: 1,
    default: 0,
  },
  top_a: {
    __type: "number",
    min: 0,
    max: 1,
    default: 0,
  },
  seed: {
    __type: "int",
    default: 0,
    min: 0,
    max: Infinity
  },
  max_completion_tokens: {
    __type: "int",
    min: 1,
    max: Infinity,
    default: 50000,
  },
} satisfies Record<string, Partial<FieldDef>> 

export const LlmConfig = {
  id: {
    __type: "string"
  },
  name: {
    __type: "string"
  },
  api_key: {
    __type: "string"
  },
  api_url: {
    __type: "string"
  },
  params: {
    __type: "object",
    def: LlmParams
  }
}

export type LlmConfig = {
  id: Id,
  name: string,
  api_key: string,
  api_url: string,
  params: LlmParams
}

export type LlmParams = {
  model: string,
  messages: CoreMessage[]

  stream?: boolean
  temperature?: number // float, 0.0 to 2.0
  top_p?: number // float, 0-1
  top_k?: number // float, 0-1
  presence_penalty?: number // float
  frequency_penalty?: number // float
  repetition_penalty?: number // float
  seed?: number // integer

  max_tokens?: number // integer
  logit_bias?: {[token_id: number]: number}
  logprobs?: boolean
  stop?: string|string[]
}

export type GeneralRequestTemplate = {
  api_key: string, 
  api_url: string,
  body: LlmParams
}

export type LlmResponse = {
  model: string
  content: string
}

export type ImportedCharacter = {
  desc: string
  first_message: string
}

export type Bubby = ImportedCharacter & {
  id: Id
  name: string
  desc: string
  first_message: string
  /* 
  memory_ids: Id[] 
    챗이랑은 구분된다.
    여러 챗이 하나의 메모리를 참조할 수 있다.
  */
  //chat_ids: Id[]
  llm_config_id: string | null
}

export const Bubby = {
  id: {
    __type: "string"
  },
  name: {
    __type: "string"
  },
  desc: {
    __type: "string"
  },
  first_message: {
    __type: "string"
  },
  /* memory_ids: {
    __type: "array",
    allows: "string"
  }, */
  /* chat_ids: {
    __type: "array",
    allows: "string"
  }, */
  llm_config_id: {
    __type: "string",
    nullable: true
  },
}

export type Prompt = {
  id: Id,
  content: string,
  trigger: string[],
}

export type History = Message[]

export const Chat = {
  id: {
    __type: "string"
  },
  name: {
    __type: "string"
  },
  /* bubby_ids: {
    __type: "array",
    allows: "string"
  }, */
  /* library_ids: {
    __type: "array",
    allows: "string"
  }, */
  speaker_id: {
    __type: "str_in_dynamic",
    async among () {
      const all = (await exec_sql("SELECT id FROM bubbies", [], "array")).flat()
      return all as unknown as string[]
    },
    nullable: true
  },
  listener_id: {
    __type: "str_in_dynamic",
    async among () {
      const all = (await exec_sql("SELECT id FROM bubbies", [], "array")).flat()
      return all as unknown as string[]
    },
    nullable: true
  },
  last_use_at: {
    __type: "datetime",
  }, // UNIX ms timestamps
  created_at: {
    __type: "datetime",
  }, // UNIX ms timestamps
  llm_config_id: {
    __type: "string",
    nullable: true
  },
} satisfies Record<string, Partial<FieldDef>> 


export type Chat = {
  id: Id
  name: string
  llm_config_id: Id | null
  //bubby_ids: Id[]
  //library_ids: Id[]
  speaker_id: string | null
  listener_id: string | null
  last_use_at: number | null // UNIX ms timestamps
  created_at: number
}

export type Profile = {
  bubbies: Bubby[]
  chats: Chat[]
  libraries: Id[]
  prompts: Prompt[]
  llm_configs: LlmParams[]
}

//export const text_joiner = "[;;;]"
/* 
export type AsEntry<T> = {
  // any[] is also object
  [K in keyof T]: T[K] extends object ? string : T[K]
}; */
export default {
  visual: {
    theme: ["dark", "cozy", "cool", "glassy"],
    stylesheet: "",
    background: "",
  },
  chat: {
    visual: {
      render_message_as_markdown: true,
      messages_in_view: 20,
    },
    safety: {
      sanitize_message: true,
    },
    max_input_messages: 50,
  }
}

export const user_config_def = {
  chat: {
    visual: {
      messages_in_view: { __type: "int", min: 1, default: 20 }
    },
    max_input_messages: {
      __type: "int"
    },
  }
}

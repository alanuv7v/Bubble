export default {
  chat: {
    visual: {
      render_message_as_markdown: true,
    },
    safety: {
      sanitize_message: true,
    },
    max_input_messages: 50,
  }
}

export const user_config_def = {
  chat: {
    max_input_messages: {
      __type: "int"
    },
  }
}

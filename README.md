# Bubble

LLM chat interface.
Lightweight, locally stored user data.

- Desktop: powered by Neutralinojs.
- Browser: OPFS SQLite database.
- LLM API access: based on OpenRouter.

To install dependencies:
```bash
npm install
```

To run the browser version:
```bash
vite
```

To build the web app:
```bash
pnpm build
```
Upload the resulting `dist` folder using Cloudflare Pages' Direct Upload. It includes `_headers`, which enables SQLite's browser storage.

The Neutralino desktop build stores `bubble.sqlite`, `user_config.yaml`, and assets in the user's application data directory. Run `pnpm desktop:prepare` before packaging to copy the SQLite extension's prebuilt binary.

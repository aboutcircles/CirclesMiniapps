Scaffold a new Circles MiniApp directory. Usage: `/scaffold <slug> "<Display Name>"`

The argument is a slug and display name, e.g. `/scaffold crc-leaderboard "CRC Leaderboard"`

---

Create the miniapp directory and all required files using the templates from AGENT.md.

## Steps

1. **Create directory and copy SDK**
   ```bash
   mkdir -p examples/<slug>
   cp examples/miniapp-sdk.js examples/<slug>/miniapp-sdk.js
   ```

2. **Create `examples/<slug>/index.html`** — use Pattern H (UI shell) from AGENT.md, replacing the title and heading with the display name.

3. **Create `examples/<slug>/main.js`** — use Pattern A (wallet connection) from AGENT.md as the base. Include the helpers (`$`, `showView`, `showToast`) and the `onWalletChange` handler. Leave a `// TODO: load initial data here` placeholder.

4. **Create `examples/<slug>/style.css`** — use the full CSS from Pattern I (design system) in AGENT.md. Include all tokens, reset, layout, header, card, button, badge, field, result, toast, and responsive styles.

5. **Create `examples/<slug>/package.json`** — use Pattern J from AGENT.md with `"name"` set to the slug.

6. **Create `examples/<slug>/vite.config.js`** — use Pattern K from AGENT.md.

7. **Create `examples/<slug>/vercel.json`**:
   ```json
   {
     "buildCommand": "npm run build",
     "outputDirectory": "dist",
     "framework": null,
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```

8. **Create `examples/<slug>/.gitignore`**:
   ```
   node_modules/
   dist/
   .env
   .env.local
   .vercel
   ```

9. **Install dependencies**:
   ```bash
   cd examples/<slug> && npm install
   ```

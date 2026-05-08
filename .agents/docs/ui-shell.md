# UI shell patterns

The boilerplate that every miniapp needs: HTML shell, dependencies, build configuration.

**Load this when:** scaffolding a new miniapp or troubleshooting build/dependency issues.

## Pattern H: `index.html`

Minimal shell with two views (connected / disconnected) and a wallet status indicator.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App Name</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app">
    <header class="app-header">
      <h1>App Name</h1>
      <div id="wallet-status" class="wallet-status">Not connected</div>
    </header>
    <main id="main-content">
      <div id="disconnected-view" class="view">
        <p>Connect your wallet to use this app.</p>
      </div>
      <div id="connected-view" class="view hidden">
        <!-- Main UI here -->
      </div>
    </main>
  </div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

**Notes:**
- `type="module"` is required - the SDK and viem are ES modules.
- The two-view pattern (`disconnected-view` / `connected-view`) makes wallet state handling trivial - toggle the `hidden` class in `onWalletChange`.

## Pattern J: `package.json`

```json
{
  "name": "<slug>",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@aboutcircles/sdk": "^0.1.24",
    "@aboutcircles/sdk-utils": "^0.1.24",
    "@aboutcircles/miniapp-sdk": "latest",
    "@safe-global/safe-deployments": "^1.37.22",
    "viem": "^2.46.3"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "vite-plugin-node-polyfills": "^0.25.0"
  }
}
```

**Notes:**
- `"type": "module"` enables ES module imports throughout.
- `@safe-global/safe-deployments` is only needed if the app interacts with Safe contracts directly. Skip it for simple miniapps.
- Pin versions when shipping a stable app. `^` is fine during initial development.

## Pattern K: `vite.config.js`

The node polyfills are required because some Circles SDK dependencies expect Node.js globals (`Buffer`, `process`).

```javascript
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  optimizeDeps: {
    esbuildOptions: { define: { global: 'globalThis' } },
  },
});
```

**Notes:**
- Without these polyfills, the build will succeed but the app will throw `Buffer is not defined` at runtime.
- `optimizeDeps.esbuildOptions.define` handles the `global` reference that some web3 libs assume exists.

## `vercel.json` (static deploy config)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

The rewrite rule lets the app handle its own routing (if any) without 404s on direct URL hits.

## `.gitignore`

```
node_modules/
dist/
.env
.env.local
.vercel
```

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Buffer is not defined` at runtime | Missing node polyfills | Apply Pattern K verbatim |
| Build succeeds but app blank | SDK constructed at module scope | Use lazy `getSdk()` pattern - see AGENTS.md Conventions |
| Vercel build fails on `npm install` | Missing or outdated lockfile | Run `npm install` locally first, commit `package-lock.json` |
| 404s on direct route hits | No SPA rewrite | Add the `vercel.json` rewrite rule above |

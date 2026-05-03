Build and deploy a miniapp to Vercel. Usage: `/deploy <slug>`

The argument is the miniapp slug (directory name under `examples/`).

---

## Steps

1. **Build the miniapp**:
   ```bash
   cd examples/<slug>
   npm run build
   ```

2. **Deploy to Vercel** (from repo root):
   ```bash
   cd /path/to/repo/root
   vercel examples/<slug> --name circles-miniapp-<slug> --yes --prod
   ```

   The CLI prints the deployment URL. Save it for the next steps.

3. **Disable Deployment Protection** (required — the miniapp will 401 inside the Gnosis wallet iframe without this):
   ```bash
   vercel project update circles-miniapp-<slug> --protection none
   ```

## Troubleshooting

- `vercel whoami` fails → run `vercel login`
- Build fails → check `npm run build` output for errors
- No URL returned → check vercel login status
- If protection disable fails → do it manually: Vercel dashboard → Project Settings → Deployment Protection → Disabled

## After deploy

1. Add the deployment URL to `static/miniapps.json`
2. Run `/open-pr` to commit and create a draft PR

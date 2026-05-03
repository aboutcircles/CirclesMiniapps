Commit, push, and open a draft PR for a miniapp. Usage: `/open-pr <slug> "<Display Name>" "<description>" "<vercel-url>"`

Arguments: slug, display name, one-line description, and the Vercel deployment URL.

---

## Steps

1. **Create branch**:
   ```bash
   git checkout -B feature/miniapp-<slug>
   ```

2. **Stage and commit**:
   ```bash
   git add examples/<slug>/ static/miniapps.json
   git add -A
   git commit -m "feat: add <Display Name> miniapp

   - Miniapp: examples/<slug>/
   - <description>
   - Deployed: <vercel-url>"
   ```

3. **Push**:
   ```bash
   git push origin feature/miniapp-<slug> --force-with-lease
   ```

4. **Open draft PR**:
   ```bash
   gh pr create \
     --base master \
     --head feature/miniapp-<slug> \
     --draft \
     --title "feat: add <Display Name>" \
     --body "$(cat <<'EOF'
   ## <Display Name>

   <description>

   **Live preview:** <vercel-url>

   ---

   ### Checklist

   - [x] Entry added to `static/miniapps.json`
   - [x] App loads over HTTPS and works inside an iframe
   - [x] Logo URL resolves to a valid image
   - [x] `<slug>` is unique
   - [x] PR title: `feat: add <Display Name>`

   ---

   > See `AGENT.md` for the workflow used.
   EOF
   )"
   ```

## Troubleshooting

- `gh auth status` fails → run `gh auth login`
- Push fails → check branch name and remote
- PR creation fails → confirm repo is `aboutcircles/CirclesMiniapps`

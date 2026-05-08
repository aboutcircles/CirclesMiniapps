# Design system

Gnosis wallet visual language. MiniApps render inside the wallet iframe and must feel native to it.

**Load this when:** writing or modifying any CSS, styling new components, or rebranding an app.

## Visual rules

- **Background**: warm beige-to-sage gradient with subtle brand tints. Never flat grey.
- **Text**: deep navy (`--ink: #05061a`) for primary, muted navy (`--muted: #51526e`) for secondary.
- **Borders**: warm beige tones (`--line: #eee7e2`), not cold greys.
- **Buttons**: pill-shaped (`border-radius: 999px`) with a brand blue gradient (`#0e00a8 → #4335df`).
- **Cards**: frosted glass (`backdrop-filter: blur(6px)`) with rounded corners (22px).
- **Accent**: Gnosis brand blue `#0e00a8`. Never indigo, never Tailwind blue.
- **Fonts**: Space Grotesk for UI, JetBrains Mono for addresses and code.

## Colour palette

| Role | Token | Hex | Palette |
|---|---|---|---|
| Warm bg | `--bg-a` | `#faf5f1` | beige-10 |
| Cool bg | `--bg-b` | `#f6f7f9` | sage-10 |
| Primary text | `--ink` | `#05061a` | navy-970 |
| Secondary text | `--muted` | `#51526e` | navy-700 |
| Card surface | `--card` | `#ffffff` | white |
| Border | `--line` | `#eee7e2` | beige-100 |
| Border subtle | `--line-soft` | `#f4eee9` | beige-50 |
| Brand accent | `--accent` | `#0e00a8` | blue-700 |
| Interactive | `--accent-mid` | `#4335df` | blue-500 |
| Accent bg | `--accent-soft` | `#eae8ff` | blue-50 |
| Success bg / ink | `--success-bg` / `--success-ink` | `#dcfce7` / `#145324` | green-100 / 900 |
| Warning bg / ink | `--warn-bg` / `--warn-ink` | `#feebc7` / `#8a482c` | amber-100 / 900 |
| Error bg / ink | `--error-bg` / `--error-ink` | `#fee2e2` / `#7f1d1d` | red-100 / 900 |

## Key CSS patterns

### Background gradient

Warm gradient with subtle brand tints. Never flat.

```css
body {
  font-family: "Space Grotesk", -apple-system, ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1200px 500px at 0% 0%, rgba(14,0,168,0.03) 0%, transparent 65%),
    radial-gradient(900px 500px at 100% 20%, rgba(255,125,62,0.05) 0%, transparent 70%),
    linear-gradient(145deg, var(--bg-a), var(--bg-b));
}
```

### Cards

Frosted glass with subtle inset highlight.

```css
.card {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line);
  border-radius: 22px;
  padding: 22px;
  box-shadow: 0 8px 30px rgba(5, 6, 26, 0.08), inset 0 1px 0 #fff;
}
```

### Primary button (pill, brand gradient)

```css
button {
  border-radius: 999px;
  background: linear-gradient(130deg, var(--accent), var(--accent-mid));
  color: #fff;
  font-weight: 600;
  border: 0;
  padding: 10px 22px;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.2s ease;
}

button:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(14, 0, 168, 0.25);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
```

### Secondary button (white with beige border)

```css
.btn-secondary {
  background: #fff;
  border: 1px solid var(--line);
  color: var(--ink);
}
```

### Status pills (success / warning / error)

```css
.pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.pill-success { background: var(--success-bg); color: var(--success-ink); }
.pill-warn    { background: var(--warn-bg);    color: var(--warn-ink);    }
.pill-error   { background: var(--error-bg);   color: var(--error-ink);   }
```

### Address / code display (mono)

```css
.address, code, .mono {
  font-family: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
  letter-spacing: -0.01em;
}
```

### Toast notification

```css
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 20px;
  border-radius: 14px;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: 0 10px 30px rgba(5, 6, 26, 0.15);
  font-size: 14px;
  z-index: 9999;
}

.toast.success { background: var(--success-bg); color: var(--success-ink); border-color: transparent; }
.toast.error   { background: var(--error-bg);   color: var(--error-ink);   border-color: transparent; }
```

## Loading the fonts

Add to `index.html` `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

## Don'ts

- **No flat grey backgrounds** like `#f8f9fa` or `#f4f4f5`.
- **No indigo or Tailwind blue** for buttons or accents. Always use `--accent` / `--accent-mid`.
- **No fonts outside Space Grotesk and JetBrains Mono**, even for headings or display text.
- **No sharp corners on interactive elements**. Buttons are pills, cards have 22px radius.
- **No hard shadows**. Use the soft, layered shadows shown above.
- **Don't override the design tokens.** Extend by adding new CSS rules using existing tokens.

# ALiX Inspector UI Redesign

> **For agentic workers:** Use superpowers:subagent-driven-development or execute inline with superpowers:executing-plans.

**Goal:** Polish the ALiX inspector UI — button states, hover effects, typography refinements, accessibility, and visual hierarchy improvements.

**Architecture:** Single CSS file changes (`src/ui/styles.css`). No framework migration. Small, targeted improvements over big rewrites.

**Tech Stack:** Vanilla CSS (no Tailwind), IBM Plex Mono font already in use

---

## Task 1: Button States (Hover, Active, Focus)

**Files:**
- Modify: `src/ui/styles.css`

### P1 Issues to Fix

1. **Current button hover only changes opacity** — Add transition + shadow + slight scale
2. **No active/pressed state** — Add `scale(0.98)` on `:active`
3. **No visible focus ring** — Add proper focus-visible styles for keyboard nav

### Changes

Add after existing button styles (around line 165):

```css
.connect-panel button:hover {
  background: #d8ff88;  /* Lighter lime on hover */
  box-shadow: 0 4px 12px rgba(208, 255, 115, 0.25);
  transform: translateY(-1px);
  transition: all 0.15s ease;
}

.connect-panel button:active {
  transform: scale(0.98) translateY(0);
  box-shadow: 0 2px 6px rgba(208, 255, 115, 0.15);
}

.connect-panel button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Add to existing tab/replay button styles (around line 316):

```css
.tab:hover,
.replay-bar button:hover,
.compare-form button:hover {
  border-color: rgba(208, 255, 115, 0.4);
  background: rgba(21, 26, 27, 1);
  transform: translateY(-1px);
  transition: all 0.15s ease;
}

.tab:active,
.replay-bar button:active,
.compare-form button:active {
  transform: scale(0.98) translateY(0);
}

.tab:focus-visible,
.replay-bar button:focus-visible,
.compare-form button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

---

## Task 2: Desaturate Accent Colors

**Files:**
- Modify: `src/ui/styles.css`

### Current Accent

```css
--accent: #d0ff73;  /* Too bright/saturated */
--accent-2: #ff7448; /* Coral, good but slightly loud */
```

### Fix

Replace with more muted versions:

```css
--accent: #b8e060;    /* Desaturated lime */
--accent-2: #e06840;   /* Desaturated coral */
```

Also update the grid pattern to be more subtle:

```css
background:
  linear-gradient(90deg, rgba(184, 224, 96, 0.03) 1px, transparent 1px),
  linear-gradient(180deg, rgba(184, 224, 96, 0.03) 1px, transparent 1px),
  var(--bg);
```

---

## Task 3: Typography Refinements

**Files:**
- Modify: `src/ui/styles.css`

### Changes

1. **Reduce all-caps on non-labels** — `h1` should be sentence case

Change h2 from:
```css
h2 {
  font-size: 15px;
  letter-spacing: 0;
  margin: 0;
  text-transform: uppercase;  /* Remove this */
}
```

2. **Add medium weight (500) for subheadings**

Add:
```css
h2 {
  font-weight: 500;  /* Add medium weight */
}
```

3. **Improve body line-height**

```css
body {
  line-height: 1.55;  /* Increased from default */
}
```

---

## Task 4: Accessibility Improvements

**Files:**
- Modify: `src/ui/index.html` (if exists) or `src/ui/app.js`
- Modify: `src/ui/styles.css`

### Changes

1. **Add skip-to-content link**

Add to `index.html` inside `<body>`:
```html
<a href="#main-content" class="skip-link">Skip to main content</a>
```

Add to `styles.css`:
```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--accent);
  color: #0b0e0f;
  padding: 8px 16px;
  z-index: 1000;
  text-decoration: none;
  font-weight: 600;
}

.skip-link:focus {
  top: 0;
}
```

2. **Add ARIA labels where missing**

In `app.js`, add to connect button:
```javascript
connectBtn.setAttribute("aria-label", "Connect to session");
```

3. **Improve scrollbar styling**

```css
#events::-webkit-scrollbar {
  width: 8px;
}
#events::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.2);
}
#events::-webkit-scrollbar-thumb {
  background: var(--panel-line);
  border-radius: 4px;
}
#events::-webkit-scrollbar-thumb:hover {
  background: rgba(208, 255, 115, 0.3);
}
```

---

## Task 5: Visual Polish

**Files:**
- Modify: `src/ui/styles.css`

### Changes

1. **Add transition to collapsible payloads**

```css
.event-payload-wrap summary::before {
  transition: transform 0.2s ease;
}
```

2. **Smooth scroll behavior**

```css
html {
  scroll-behavior: smooth;
}
```

3. **Improve empty state styling**

```css
.empty {
  color: var(--muted);
  font-style: italic;
  padding: 16px;
  text-align: center;
}
```

4. **Add subtle noise texture to panels**

```css
.panel {
  background: rgba(21, 26, 27, 0.94);
  /* Add subtle noise */
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
  background-blend-mode: overlay;
}
```

---

## Verification

Build and test in browser:

```bash
npm run build
# Then start server and view http://localhost:3000
```

Manual checks:
- [ ] Connect button has hover lift + shadow
- [ ] Buttons scale down on click
- [ ] Tab navigation shows focus ring
- [ ] Colors are muted (not screaming)
- [ ] Scrollbars match theme
- [ ] Skip link works

---

## Summary

| Task | Focus | Risk |
|------|-------|------|
| 1 | Button states | Low |
| 2 | Color desaturation | Low |
| 3 | Typography | Low |
| 4 | Accessibility | Low |
| 5 | Visual polish | Medium |

All changes are CSS-only, reversible, and won't break functionality.
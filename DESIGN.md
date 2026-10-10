---
version: alpha
colors:
  background: "#080A12"
  surface: "#111725"
  surface-raised: "#171F30"
  border: "#303A4E"
  text: "#F1F5FB"
  muted: "#9AA7BA"
  primary: "#C9F36B"
  accent: "#8D9BFF"
  info: "#7CD9F5"
  danger: "#FF929D"
typography:
  display:
    fontFamily: "Space Grotesk, Manrope, system-ui, sans-serif"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
  mono:
    fontFamily: "DM Mono, ui-monospace, monospace"
rounded:
  control: "0.75rem"
  panel: "1.125rem"
  hero: "1.5rem"
spacing:
  compact: "0.5rem"
  standard: "1rem"
  roomy: "1.5rem"
  section: "2rem"
components:
  glass-panel:
    border: "1px solid rgba(166, 184, 218, 0.16)"
    radius: "1.125rem"
  primary-action:
    background: "#C9F36B"
    foreground: "#11150A"
    radius: "0.75rem"
---
# Eidren UI design system

## Overview

Eidren is a tactical identity-resolution tool and developer console for MLBB players and API integrators. Its visual register is **product-first, atmospheric, and instrument-like**: the world of the Land of Dawn is suggested through signal-green status lights, precise mono metadata, and an indigo night-sky depth—not through game screenshots, character art, or noisy neon decoration.

The signature is **translucent instrument glass floating over a restrained aurora field**. Blur and glow create depth; content hierarchy, consistent placement, and legible contrast remain in charge. The current runtime CSS in `src/app/globals.css` is canonical; this file records the accepted visual decisions and mirrors the semantic CSS variables.

Anti-references: generic white SaaS templates, full-screen neon gradients, glowing every component, overly rounded pill controls, and glass surfaces so transparent that text loses contrast.

## Colors

- Background `--bg: #080A12`: deep ink base.
- Primary `--lime: #C9F36B`: the single signature signal color for primary actions, active navigation, and positive states.
- Surface `--panel: #111725`: opaque enough to keep data legible under blur.
- Border `--line: #303A4E`: quiet separation with a cool blue cast.
- Text `--text: #F1F5FB`; secondary copy uses `--muted: #9AA7BA`.
- `#8D9BFF` and `#7CD9F5` are restrained atmosphere/secondary accents, never replacements for semantic status colors.
- Error and warning states retain distinct text and border treatments; never use lime as the only status cue.

## Typography

- Display: Space Grotesk, used for large page titles and short headlines.
- Body: Manrope, used for forms, explanatory copy, and controls.
- Utility/data: DM Mono for IDs, API metadata, section eyebrows, status labels, and timestamps.
- Display tracking is tight; body line height is generous enough for mobile. Do not set all text in mono or use uppercase as the only hierarchy signal.

## Layout

- Desktop console: stable left navigation rail plus a flexible content column. Keep the content column min-width-safe and align page headings, section panels, and action rows to the same grid.
- Mobile console: hide the desktop rail and expose a horizontally scrollable section navigator; do not hide destinations or require hover.
- Public lookup: one two-column hero and one aligned lookup/instructions grid; stack both cleanly on narrow screens.
- Use a shared 8/12/16/24/32px rhythm, with larger breathing room between sections than within forms. Avoid arbitrary offsets that make headings and controls misalign.
- Keep natural document scrolling. Tables own their horizontal scrolling; forms and adjacent panels must not be clipped by viewport-fixed ancestors.

## Elevation & Depth

- The page atmosphere uses low-opacity indigo and green radial light, not opaque gradient panels.
- Panels use a translucent navy surface, subtle cool border, inset top highlight, and broad low-opacity shadow. Use `backdrop-filter` only as progressive enhancement; surfaces remain legible without it.
- Reserve stronger glow for the hero signature and focused/active controls. Avoid stacked shadows on every child inside a panel.

## Shapes

- Standard controls: 12px radius.
- Main panels: 18px radius.
- Hero/auth feature surfaces: 24px radius.
- Pills are reserved for status labels, not every button or container.

## Components

- Runtime token path: this document mirrors semantic values in `:root` within `src/app/globals.css`; CSS variables feed shared selectors used by public lookup, authentication, and every console route. The runtime CSS remains the source of truth; do not duplicate tokens in page-local styles.
- Glass panel family: `.form-panel`, `.side-panel`, `.auth-card`, `.console-sidebar`, `.console-panel`, `.stat-card`, `.console-stat`, `.plan-card`, `.workspace-detail`, and related data rows share the same surface/border/elevation grammar.
- Actions: `.submit` is the solid primary action; `.quiet-button`, `.icon-button`, and `.copy-button` are secondary controls. Destructive actions remain explicitly red.
- Navigation: `.console-nav-link.active` and `.console-mobile-links a.active` share the same active treatment.
- Focus: every interactive control has a visible high-contrast `:focus-visible` ring. Reduced-motion preferences override decorative movement.

## Do's and Don'ts

- Do align content to a shared grid, keep action labels stable while busy, and make status visible in both text and color.
- Do use the glass treatment consistently, with enough surface opacity for readable text and forms.
- Do preserve route behavior, session semantics, API behavior, and billing behavior during visual changes.
- Don't introduce fake live metrics, sample activity that looks real, decorative controls, or new dependencies for visual polish.
- Don't make the page or a shared shell viewport-locked to force panels into place.
- Don't remove visible scrollbars, keyboard focus, labels, or error states for aesthetic reasons.

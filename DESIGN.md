---
name: Conversation Quality Analytics
description: A calm, precise workspace for conversation quality and evidence review.
colors:
  primary: "#2A8640"
  primary-hover: "#055532"
  primary-bright: "#4FB84E"
  primary-soft: "#DDF6CE"
  primary-tint: "#EEF8E9"
  on-primary: "#FFFFFF"
  link: "#22703A"
  canvas: "#f6f7f8"
  surface: "#fff"
  surface-muted: "#f0f2f3"
  text: "#202728"
  text-secondary: "#414b4d"
  text-muted: "#626d70"
  border: "#dfe5e5"
  border-strong: "#879294"
  success-text: "#1C6B3A"
  success-bg: "#E3F3E6"
  success-chart: "#2E9D57"
  warning-text: "#7A5300"
  warning-bg: "#FDF1CF"
  warning-chart: "#E0A800"
  danger-text: "#A3262E"
  danger-bg: "#FBE7E8"
  danger-chart: "#CD464B"
  evidence-bg: "#FFF4D2"
  evidence-line: "#E0A800"
  dark-canvas: "#111718"
  dark-surface: "#192122"
  dark-surface-muted: "#222c2d"
  dark-text: "#eaf0ee"
  dark-text-secondary: "#c4ceca"
  dark-text-muted: "#a1b0ad"
  dark-border: "#344241"
  dark-border-strong: "#7c918c"
  dark-primary-hover: "#72BF44"
  dark-on-primary: "#0E1A10"
  dark-link: "#7CCB7B"
  dark-success-text: "#8EDC9F"
  dark-warning-text: "#FBD655"
  dark-danger-text: "#FF9A9A"
typography:
  headline:
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.035em"
  title:
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-.015em"
  body:
    fontFamily: '"CoFoSans", "Segoe UI", Roboto, "Noto Sans", "PT Sans", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
  label:
    fontSize: "13px"
    fontWeight: 500
  caption:
    fontSize: "12px"
    lineHeight: 1.6
  metric:
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.035em"
rounded:
  xs: "4px"
  badge: "5px"
  control: "6px"
  message: "8px"
  list: "10px"
  panel: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  panel-gap: "20px"
  panel-padding: "24px"
  page-padding: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  navigation-active:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.link}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "40px"
  badge-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-text}"
    rounded: "{rounded.badge}"
    padding: "4px 7px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: Conversation Quality Analytics

## Overview

**Creative North Star: "The Evidence Workspace"**

A calm professional tool whose hierarchy moves from quality signals to individual conversations and their evidence. Its character is precise, restrained and useful over long work sessions. Familiar controls, compact typography and consistent states carry the identity; visual effects stay subordinate to the task.

This documents the implemented cascade in `frontend/css/app.css` followed by `frontend/css/studio.css`. The latter owns the current workspace surfaces, layout and density. Frontmatter records reusable primitives; component definitions live in the scoped stylesheets.

**Key Characteristics:**

- Clear analytical hierarchy and visible investigation paths.
- One green action accent with separate semantic status colors.
- Flat surfaces, compact controls and readable evidence.
- Consistent light, dark and responsive treatments.

## Colors

### Primary

Freedom-inspired action green marks primary actions, current navigation and meaningful links. Bright green supports the dark theme. Soft green communicates selection; it is not a decorative page background. This is an established product identity, not a claim of official affiliation.

### Neutral

Cool canvas, white panels, secondary surfaces and quiet dividers organize dense information. Main, secondary and muted text have distinct roles. The dark theme maps these same roles to deep green-gray surfaces and light text; apply the whole theme through the scoped application root.

Success, warning and danger colors describe outcomes. Evidence uses a separate warm highlight. Dark semantic backgrounds and bars continue to use the theme definitions in the foundation stylesheet.

**The Meaning Rule.** Pair status color with a number, label or icon. A gross-violation flag remains independent of the total score.

## Typography

CoFo Sans, the font used by [Freedom Bank](https://bankffin.kz/ru), serves the entire product. Light, regular, medium, bold and regular italic WOFF2 faces are served locally from `frontend/fonts/`; the regular face is preloaded. System fonts provide fallback coverage. Fixed headline, title, body and caption roles keep analytical screens predictable. Page headlines reduce to 24px on mobile. Metric numerals reduce at compact widths, while body text remains readable.

Use tabular numerals for scores, timestamps and comparable counts. Keep explanatory prose around 72 characters per line where practical. Short section labels support hierarchy; page titles do not need decorative eyebrows.

**The Precision Rule.** Preserve meaningful score precision and distinguish missing values from zero.

## Layout

The desktop workspace reserves a fixed 224px sidebar and a main region capped at 1664px. Default page insets are 32px. At 1200px the sidebar becomes 200px; at 1000px it becomes 184px and analytical/split layouts collapse. At 700px navigation becomes a sticky horizontal header with 16px page gutters. Wide screens from 1500px use 40px vertical and 48px horizontal page insets.

Use the observed 4px spacing foundation, 20px panel gaps and 24px panel padding. Panels use 20px padding on mobile. Adapt dense data deliberately: explorer rows retain score alignment, tables scroll inside their own container, and the transcript keeps a bounded scroll region. Do not create page-wide horizontal overflow.

## Elevation & Depth

Panels and rows are flat, separated by surface tone and thin dividers. Hover changes tone without lifting content. Dialogs and transient feedback use the existing overlay shadows; the criterion editor is a right-hand drawer. Overlay shadow values live in the stylesheets.

## Shapes

Use compact corners for controls and status badges, intermediate corners for messages and list containers, and larger corners for panels/dialogs. Avoid oversized radii and decorative pills. The criterion drawer has rounded leading corners on desktop and square viewport edges on mobile.

## Components

Buttons are compact and explicit: one primary green action, neutral secondary actions and transparent ghost actions. Controls have a 36px minimum height; navigation rows use 40px. Hover, pressed, disabled and busy states must remain visible. The shared focus treatment is a 2px green outline with separation from the control; inputs retain their foundation focus border and soft ring.

Fields use visible labels or accessible labels where space is constrained. Validation uses semantic danger text and `aria-invalid`; it must explain recovery. Keep native checkbox, radio, date and audio behavior.

Criterion rows align the title, inline weight input and action buttons to the same 36px control line. Supporting explanations sit below the title. On narrow screens, the weight/action group moves together to the next row; action buttons retain accessible names when text is hidden.

Conversation rows group identity, transcript preview, metadata, state and a right-aligned score. Selection remains visible across filtering and pagination. Active filter chips describe removable conditions, and metric drill-down preserves investigation context.

Failed evaluations use an explicit error label and retry guidance, never a zero score or a green success state. Changed transcripts use “Нужна переоценка”; failed and stale results are excluded from quality metrics. Historical evidence uses the input and criterion snapshots saved with its evaluation. Submission export is secondary to investigation and lives in a labeled disclosure on the conversations page.

Charts use labeled scales, semantic thresholds and an accessible data alternative. Latest-score trends must describe their actual time coverage. Transcripts differentiate participants, retain replica numbers and connect evidence to highlighted messages and audio offsets. Reviewer decisions show original, proposed and final results distinctly.

Dialogs use native focus containment and Escape. The command palette supports keyboard navigation. Short state transitions use the shared CSS motion tokens; reduced-motion disables animations and transitions. Do not replay page entrances or number animations during routine work.

## Do's and Don'ts

### Do:

- **Do** use the scoped semantic CSS variables and shared component patterns.
- **Do** keep score, evidence, checklist version and reviewer decisions traceable.
- **Do** preserve keyboard focus, native controls and reduced-motion behavior.
- **Do** show honest loading, empty, unavailable and error states with useful recovery.

### Don't:

- **Don't** invent historical trends, agent/team comparisons or unsupported data.
- **Don't** use decorative gradients, glass effects, hover lifts or oversized cards.
- **Don't** communicate status only through color or hide essential actions for a cleaner screenshot.
- **Don't** introduce a second accent palette, component language or framework for visual polish alone.

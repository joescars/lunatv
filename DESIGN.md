---
name: LunaTV Material Broadcast
description: A shared Material Design 3 system for viewer and device administration.
colors:
  primary: "#4f378b"
  on-primary: "#ffffff"
  primary-container: "#eaddff"
  on-primary-container: "#32195e"
  secondary-container: "#e8def8"
  on-secondary-container: "#1d192b"
  surface: "#faf8ff"
  surface-low: "#f4f1f9"
  surface-container: "#efedf4"
  surface-high: "#e9e7ef"
  on-surface: "#1d1b20"
  on-surface-variant: "#49454f"
  outline: "#79747e"
  outline-variant: "#cac4d0"
  error: "#b3261e"
  error-container: "#f9dedc"
  success: "#25613a"
  success-container: "#d9efde"
  warning: "#705300"
  warning-container: "#fff0c2"
  dark-primary: "#d0bcff"
  dark-on-primary: "#381e72"
  dark-primary-container: "#4f378b"
  dark-on-primary-container: "#eaddff"
  dark-secondary-container: "#4a4458"
  dark-surface: "#141218"
  dark-surface-low: "#1d1b20"
  dark-surface-container: "#211f26"
  dark-surface-high: "#2b2930"
  dark-on-surface: "#e6e0e9"
  dark-on-surface-variant: "#cac4d0"
  dark-outline: "#938f99"
  dark-outline-variant: "#49454f"
typography:
  headline:
    fontFamily: "Roboto, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(1.6rem, 3vw, 2rem)"
    fontWeight: 500
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Roboto, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Roboto, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Roboto, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 500
rounded:
  chip: "8px"
  compact-surface: "12px"
  surface: "16px"
  pill: "100px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
  page: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    height: "44px"
    typography: "{typography.label}"
  button-secondary:
    textColor: "{colors.on-surface-variant}"
    rounded: "{rounded.pill}"
    padding: "0.6rem 1.25rem"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    rounded: "{rounded.chip}"
    padding: "0.5rem 0.85rem"
  card:
    backgroundColor: "{colors.surface-low}"
    rounded: "{rounded.surface}"
    padding: "1.5rem"
  navigation-selected:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    rounded: "{rounded.pill}"
    height: "44px"
---

# Design System: LunaTV

## Overview

**Creative North Star: "Material Broadcast"**

This is an operating interface, not a streaming-service marketing page. Material Design 3 provides the consistent component language: readable workhorse typography, tonal surfaces, explicit selection states, and familiar touch-friendly controls. The viewer and administration share the same visual system.

The implementation uses Google's official Material Web filled/outlined buttons and icon buttons alongside native controls and Bootstrap layout/collapse utilities. `public/css/style.css` owns the shared tokens; `public/css/client.css` owns viewer-specific patterns. `frontend/material.js` selects the vendored component bundle. These files, rather than historical screenshots, are implementation authority.

**Key Characteristics:**
- Violet actions and lavender selection containers.
- Shared light/dark tonal surfaces.
- Compact, readable schedules and generous touch targets.
- Flat surfaces at rest; depth comes from tonal hierarchy.

## Colors

The palette is restrained but purposeful: violet identifies actions and selection, while success, warning, and error remain semantic.

### Primary
- **Broadcast Violet:** filled actions, focus outlines, channel numbers, and time progress. In dark mode, use the corresponding light lavender foreground with the dark on-primary color.
- **Selected Lavender:** current-airing and selected navigation containers, always paired with their on-container text color.

### Secondary
- **Quiet Lavender:** selected filter chips and main navigation. It distinguishes current context without competing with the primary action.

### Neutral
- **Tinted Surface:** the page background.
- **Low Tonal Surface:** the app bar, cards, and quiet supporting regions.
- **Raised Tonal Surface:** hover and grouped-control backgrounds, without decorative shadows.
- **Surface Ink / Supporting Ink:** primary and secondary text; secondary text is not reduced by opacity.
- **Outline / Quiet Outline:** input strokes and schedule dividers.

### Named Rules
**The Shared Theme Rule.** Viewer and admin use one `theme` preference and the same semantic tokens; neither owns a separate palette. An unset preference follows the device.

**The State Color Rule.** Red means error or a destructive action. It is not a decorative accent.

## Typography

**Display Font:** No separate display face; this application uses the title hierarchy.
**Body Font:** Self-hosted variable Roboto, falling back to system-ui, -apple-system, Segoe UI, and sans-serif.

Roboto is intentionally conventional because the user selected Google's Material Design 3 for an operating interface. The detector's generic overused-font warning does not override that choice. The Latin subset is served locally; other scripts can fall back to the system stack.

### Hierarchy
- **Headline:** medium-weight page titles using the responsive headline token.
- **Title:** medium-weight section headings using the title token.
- **Body:** regular-weight content using the body token; explanatory prose is limited to about 70 characters per line.
- **Label:** medium-weight controls using the label token. Supporting schedule labels use a compact 0.8–0.85rem scale.
- **Numerals:** channel numbers, schedule times, and counts use tabular figures where alignment matters.

## Layout

Standard pages have a centered outer maximum width of 1152px and desktop page padding of 32px. Wide schedule pages use 1440px. Phone pages reduce padding to 16px.

The main navigation stays horizontal on larger screens and moves into its own full-width row below the wordmark on phones. The four admin destinations remain visible on narrow phones by dropping their redundant icons. Device overview and tuner status use two columns when space allows and stack below 768px.

The schedule owns its horizontal and vertical scroll region; it must not create document-level horizontal overflow. Channel labels and time labels remain sticky inside it. Viewer rows and forms reflow rather than shrinking the touch target.

## Elevation & Depth

Application surfaces have no decorative shadow at rest. Background tone distinguishes the page, supporting containers, and selection. Dividers separate schedules and list rows. Official Material Web controls retain their own state layers; native controls use matching tonal hover and focus treatments.

**The Tonal Depth Rule.** Prefer a surface role over a new shadow or independent hardcoded background.

Motion uses a short 180ms Material-style ease-out for state changes. Reduced-motion preferences minimize transitions; no entrance animation hides content.

## Shapes

Pills are reserved for navigation, buttons, search, and small status controls. Chips and schedule program blocks have compact rounded corners. Content containers have softly rounded surface corners. Borders are functional outlines or row dividers, not stacked card ornament.

## Components

### Buttons
- Official Material Web filled/outlined buttons power viewer actions; native form buttons use the same token language.
- Standard buttons and icon controls have a minimum target height of 44px; player close/record controls use 48px.
- Primary uses primary/on-primary, secondary uses an outline, destructive uses the semantic error colors.
- Focus is visible, and request-bound native form controls disable during htmx submission.

### Chips
- Filters remain native keyboard-operable checkbox controls with chip-shaped labels.
- Unselected chips use an outline; selected chips use the secondary container pair.
- A checkbox's focus ring is transferred to its visible label.

### Cards / Containers
- Quiet supporting containers use the low tonal surface and surface corner token.
- Desktop internal padding is 24px, reduced to 20px on phones.
- Schedules use dividers and open rows, not nested cards.

### Inputs / Fields
- Native fields have a 48px minimum height, visible labels, and an outline stroke.
- Search is a full-width pill on phones; its focus treatment belongs to the container.
- Text, placeholder, and caret colors come from semantic tokens.

### Navigation
- Current destinations use a tonal container and `aria-current`.
- Viewer navigation, admin navigation, and theme controls share one shell.
- A skip link and explicit keyboard focus styles are part of the shell.

### Time Progress and Playback

A slim time-progress track belongs to the current program's metadata. The grid uses the same primary color for its current-time marker and current-airing container. Playback uses a native dialog with inert background content; dismissal restores guide position and control focus. Video itself stays black-backed in both themes.

## Do's and Don'ts

### Do:
- **Do** pair every surface/container color with its corresponding foreground token.
- **Do** keep viewer and admin theme behavior identical.
- **Do** preserve readable text and at least 44px interactive targets on phones.
- **Do** keep schedule overflow inside the schedule region.
- **Do** preserve semantic states, keyboard operation, reduced motion, and visible focus.

### Don't:
- **Don't** restore a separate dark-only viewer palette.
- **Don't** replace task controls with decorative streaming-service shelves.
- **Don't** use color alone to communicate an error, selection, or destructive action.
- **Don't** add decorative shadows to flat tonal containers.

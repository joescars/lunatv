# LunaTV

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People browsing their HDHomeRun channels and watching live television through a desktop browser or mobile phone. The primary audience's household composition and technical proficiency are not specified.

## Product Purpose

Make browsing channels and starting live TV playback convenient in the browser. Success means a great experience on both desktop and mobile, with clear paths from the guide to playback.

## Positioning

LunaTV is a self-hosted browser client for HDHomeRun tuners, with device administration in the same application. An existing separate Roku client shares its server APIs.

## Operating Context

- The server connects to an HDHomeRun device over its local HTTP API.
- Program information comes from Silicondust's cloud Guide API using device authentication.
- The browser client has a mobile-first guide, a desktop channel-by-time grid, and live playback.
- Administration includes device information, channel lineup and favorite/hidden controls, channel scanning, and tuner status.
- The application runs with Node.js or in Docker. Live transcoding requires an appropriate ffmpeg installation and Intel Quick Sync hardware.

## Capabilities and Constraints

- Channel browsing and browser TV playback are the primary priorities.
- Recordings management is a much lower priority and is deferred for this refresh. Preserve its existing functionality; do not expand it or make it a primary navigation focus.
- The refresh covers the browser site as a whole, including administration. Viewer and admin pages should use a consistent design system.
- Both desktop-browser and mobile-phone experiences are required; mobile friendliness is a firm requirement, not a later adaptation.
- Viewer and admin pages share a light/dark preference, initially following the device's preferred color scheme.
- Phones prioritize a scannable channel list; desktop offers a wider channel-by-time grid. Watch controls stay prominent, and closing playback restores the guide context.
- Google Material Design 3 is the confirmed design-system foundation. Use its responsive navigation, component conventions, interaction guidance, and accessibility principles consistently across browser pages. The implementation uses Google's official Material Web buttons/icon buttons, native forms and checkbox filters, and Bootstrap layout/collapse utilities with shared Material tokens.
- Preserve existing application functions and shared API contracts. The current refresh does not request Roku interface changes.
- The existing implementation uses Node.js, Express, EJS, htmx, Bootstrap 5, and hls.js, with no SPA build step. Any dependency or rendering changes should be deliberate rather than incidental to styling.
- Browser live playback uses H.264 HLS with a start/readiness/playlist handshake. Guide playback opens an overlay and returns users to their preserved guide context.
- DVR functionality depends on an optional external HDHomeRun RECORD engine; do not imply that LunaTV provides a recording engine itself.

## Brand Commitments

The current product name is LunaTV. The repository contains an existing logo and app icons, but the user has not made preservation of their current visual appearance a binding requirement.

## Evidence on Hand

- `README.md` documents current capabilities, configuration, and deployment.
- `views/` contains the browser pages and interactive EJS fragments.
- `public/images/logo.png`, `public/images/favicon-*.png`, and `public/apple-touch-icon.png` provide existing identity assets.
- `docs/screen-*.jpeg` provides historical browser screenshots; their freshness must be checked before treating them as current visual evidence.
- `roku/` contains the separate Roku client and its integration requirements.
- No user testimonials, audience metrics, or performance guarantees have been supplied; do not fabricate them.

## Product Principles

1. Prioritize browsing channels and getting to live playback over secondary tools.
2. Make the experience effective on a phone as well as a desktop browser.
3. Keep viewer and administrative interfaces coherent while respecting their different tasks.
4. Preserve working playback and device integrations during the redesign.
5. Build on Google Material Design 3 rather than inventing an unrelated component language.

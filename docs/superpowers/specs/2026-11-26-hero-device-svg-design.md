# Hero device SVG — short design

## Intent

Give the responsive hero a clean device-only image. Keep the existing desktop hero scene exactly as it is.

## Goals

- Add a new SVG containing only the sensor device: no workbench, glow, cable, shadow, or full-scene background.
- Size and crop the SVG tightly to the device.
- Use that SVG only at `max-width: 1200px`, where the hero becomes responsive.
- Center the whole device in that responsive hero, without cropping or fading its edges.
- Keep the desktop source, crop, glyph effect, and layout unchanged.

## Non-goals

- No changes to other pages or other SVG assets.
- No redesign of the hero copy, buttons, or section rhythm.
- No removal of the glyph rendering effect.

## Constraints

- The existing `<img>` is transparent; `GlyphScene` draws the visible hero art from the same source image.
- `GlyphScene` currently uses cover sampling, a fixed workbench boundary at source `y=596`, and a horizontal fade.
- The responsive scene has a bottom mask and a bottom gradient overlay that would cut a centered device.

## Approaches

1. **Tight device SVG + contain mode** — chosen. The asset is truly just the device. `GlyphScene` centers it and shows it whole on small screens. Desktop stays untouched.
2. Wide transparent SVG with centered padding — rejected because the asset would contain large empty padding and would not be sized to the device.
3. Two `GlyphScene` canvases toggled by CSS — rejected because both would render and one would be hidden work.

## Implementation

- Add `src/assets/hero-sensor-device.svg` with a tight `480×320` viewBox.
- Copy only the device group and its body, top-edge, and LED gradients from `hero-sensor-scene.svg`.
- Add a `matchMedia('(max-width: 1200px)')` hook in `LandingPage.tsx`; select the device SVG in responsive mode and the original scene otherwise.
- Pass the selected source to both the `<img>` and `GlyphScene`.
- Add CSS-driven fit and fade flags to `GlyphScene`:
  - contain fit for the device source, with the full device centered;
  - no workbench fade for the device source;
  - no horizontal fade for the device source.
- Override the responsive CSS so the scene has no bottom mask and no bottom gradient.
- Leave all desktop CSS variables and behavior unchanged.

## Builder calls already made

- New asset name: `hero-sensor-device.svg`.
- Tight viewBox: `480×320`.
- Responsive breakpoint: `max-width: 1200px`, matching the existing hero breakpoint.
- The subtle device shadow from the original scene is omitted; it belongs to the workbench presentation.

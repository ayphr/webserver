# Hero Device SVG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use a tight device-only SVG in the responsive hero while leaving the desktop hero scene unchanged.

**Architecture:** Add a device-only SVG asset and select it with a `matchMedia` hook in `LandingPage.tsx`. Extract `GlyphScene` image placement into a pure helper so the responsive asset can be letterboxed and centered, then drive fit and fade behavior from CSS variables. Keep the existing cover crop and workbench fade for the desktop asset.

**Tech Stack:** React 19, TypeScript, Vite SVG imports, CSS custom properties, Bun tests.

**Spec:** `docs/superpowers/specs/2026-11-26-hero-device-svg-design.md`

## Global Constraints

- Responsive breakpoint is `max-width: 1200px`.
- Device asset viewBox is `480×320`.
- Device asset contains no workbench, glow, cable, full-scene background, or shadow.
- Desktop hero must keep `hero-sensor-scene.svg`, its crop values, its mask, and its gradient overlay exactly as before.
- Tests avoid DOM dependencies.

## Review Focus

- Desktop viewport must keep the original scene source and crop. Task 4 checks `img.currentSrc` and CSS variables at a width above `1200px`.
- Responsive viewport must switch to the device asset. Task 4 checks `img.currentSrc` at `846px`.
- Device must stay whole and centered. Task 2 tests contain placement at `846×260` and `390×200`; Task 4 checks the glyph canvas has ink away from its edges.
- Workbench fade must be disabled for the device asset. Task 4 checks `--glyph-has-bench: 0` and no mask/gradient overlay at `846px`.
- Desktop glyph rendering must not regress. Task 3 runs the full typecheck, lint, test, and build suite after integration.

---

### Task 1: Add device-only SVG asset

**Files:**
- Create: `src/assets/hero-sensor-device.svg`

**Interfaces:**
- Produces: URL import used by `LandingPage.tsx`.

- [ ] **Step 1: Create the SVG**

Create `src/assets/hero-sensor-device.svg` with `viewBox="0 0 480 320"`, `width="480"`, `height="320"`. Copy only the device group from `src/assets/hero-sensor-scene.svg`: keep `body`, `topEdge`, and `led` gradients; keep the body rectangle, top edge, two small internal bars, two port rectangles, both port lines, the LED, and the two tiny screw dots. Omit the background rectangle, bench rectangle, glow ellipse and masks, cable paths, and the device shadow rectangle. Use `transform="translate(20 36) rotate(-6 220 130)"` so the rotated device fits inside the viewBox.

- [ ] **Step 2: Verify the asset contents**

Run:

```bash
grep -n 'bench\|glow\|glowMask\|glowFalloff\|M1414\|opacity="0.85"' src/assets/hero-sensor-device.svg
```

Expected: no matches.

Run:

```bash
head -n 1 src/assets/hero-sensor-device.svg
```

Expected: `viewBox="0 0 480 320"`.

---

### Task 2: Extract image placement helper

**Files:**
- Create: `src/pages/landing/glyphCrop.ts`
- Test: `src/pages/landing/glyphCrop.test.ts`

**Interfaces:**
- Produces: `getImagePlacement(options: ImagePlacementOptions): ImagePlacement`.
- Consumed by: `GlyphScene.tsx`.

- [ ] **Step 1: Write failing tests**

Create `src/pages/landing/glyphCrop.test.ts` with these assertions:

```ts
import { describe, expect, test } from 'bun:test';
import { getImagePlacement } from './glyphCrop';

describe('getImagePlacement', () => {
  test('cover keeps the existing scene crop and fills the target', () => {
    const p = getImagePlacement({
      imageWidth: 1600,
      imageHeight: 900,
      targetWidth: 100,
      targetHeight: 50,
      focusX: 0.62,
      zoom: 1.45,
      fit: 'cover',
    });
    expect(p.sh).toBeCloseTo(900 / 1.45);
    expect(p.sw / p.sh).toBeCloseTo(2);
    expect(p.sy).toBeCloseTo((900 - p.sh) * 0.54);
    expect(p.sx).toBeCloseTo(1600 * 0.62 - p.sw / 2);
    expect([p.dx, p.dy, p.dw, p.dh]).toEqual([0, 0, 100, 50]);
  });

  test('contain centers the full wide image', () => {
    const p = getImagePlacement({
      imageWidth: 480,
      imageHeight: 320,
      targetWidth: 846,
      targetHeight: 260,
      zoom: 1,
      fit: 'contain',
    });
    expect([p.sx, p.sy, p.sw, p.sh]).toEqual([0, 0, 480, 320]);
    expect([p.dw, p.dh]).toEqual([390, 260]);
    expect(p.dx).toBeCloseTo(228);
    expect(p.dy).toBeCloseTo(0);
  });

  test('contain centers the full image on a narrow viewport', () => {
    const p = getImagePlacement({
      imageWidth: 480,
      imageHeight: 320,
      targetWidth: 390,
      targetHeight: 200,
      zoom: 1,
      fit: 'contain',
    });
    expect([p.dw, p.dh]).toEqual([300, 200]);
    expect(p.dx).toBeCloseTo(45);
    expect(p.dy).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/pages/landing/glyphCrop.test.ts`

Expected: FAIL because `./glyphCrop` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/pages/landing/glyphCrop.ts` exporting:

```ts
export type CropFit = 'cover' | 'contain';

export type ImagePlacementOptions = {
  imageWidth: number;
  imageHeight: number;
  targetWidth: number;
  targetHeight: number;
  focusX?: number;
  zoom?: number;
  fit?: CropFit;
};

export type ImagePlacement = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

export function getImagePlacement(options: ImagePlacementOptions): ImagePlacement;
```

Cover behavior must match the current `drawCover` math exactly. Contain behavior must set the source rect to the whole image, scale by `Math.min(targetWidth / imageWidth, targetHeight / imageHeight) / zoom`, and center the destination rect. Default `focusX` is `0.62`, default `zoom` is `1.45`, default `fit` is `'cover'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/pages/landing/glyphCrop.test.ts`

Expected: 3 pass, 0 fail.

---

### Task 3: Integrate placement and fade flags into GlyphScene

**Files:**
- Modify: `src/pages/landing/GlyphScene.tsx`

**Interfaces:**
- Consumes: `getImagePlacement` and `ImagePlacement` from `glyphCrop.ts`.
- Produces: same `GlyphScene({ src, cell })` component API.

- [ ] **Step 1: Replace `drawCover` with placement drawing**

Replace `drawCover` with `drawPlacement(ctx, img, placement)` that fills `#121212`, then calls `ctx.drawImage(img, placement.sx, placement.sy, placement.sw, placement.sh, placement.dx, placement.dy, placement.dw, placement.dh)`.

- [ ] **Step 2: Read fit and fade flags from CSS**

In `prepare`, read `--glyph-fit` as `'contain'` only when its trimmed value equals `contain`; otherwise use `'cover'`. Read `--glyph-has-bench` as a number defaulting to `1`. Keep existing reads for `--glyph-focus-x`, `--glyph-zoom`, `--glyph-fade-start`, and `--glyph-fade-end`.

- [ ] **Step 3: Use the helper and skip workbench fade when disabled**

Call `getImagePlacement` with the image and sample dimensions, then pass its result to `drawPlacement`. Compute `benchStart` only when `fit === 'cover'` and `hasBench > 0.5`. When workbench fade is disabled, set the effective fade to `1` for every sampled cell instead of applying `upperMask`. Keep all other glyph sampling, tone, threshold, and shimmer logic unchanged.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npx tsc -b && npx eslint src/pages/landing/GlyphScene.tsx src/pages/landing/glyphCrop.ts src/pages/landing/glyphCrop.test.ts
```

Expected: no output.

---

### Task 4: Select the asset and style responsive centering

**Files:**
- Modify: `src/pages/landing/LandingPage.tsx`
- Modify: `src/pages/landing/LandingPage.css`

**Interfaces:**
- Consumes: `src/assets/hero-sensor-device.svg` URL and the unchanged `GlyphScene` API.
- Produces: responsive asset selection driven by `matchMedia('(max-width: 1200px)')`.

- [ ] **Step 1: Add the media query hook**

In `LandingPage.tsx`, import `useEffect`, `useState`, and `heroDeviceSvg`. Add a local hook `useResponsiveHeroScene(): boolean` that initializes from `window.matchMedia('(max-width: 1200px)').matches`, subscribes to `change`, and cleans up. Use `const isResponsive = useResponsiveHeroScene()` and `const sceneSrc = isResponsive ? heroDeviceSvg : heroSceneSvg`.

- [ ] **Step 2: Use the selected asset**

Set the hero `<img>` `src` to `sceneSrc`. Set its `alt` to `A matte graphite Ayphr Geo sensor` in responsive mode and keep the existing alt text in desktop mode. Pass `sceneSrc` to `<GlyphScene>`.

- [ ] **Step 3: Override responsive scene CSS**

Inside the existing `@media (max-width: 1200px)` `.landing-hero__scene` rule, replace the scene variables with:

```css
--glyph-focus-x: 0.5;
--glyph-zoom: 1;
--glyph-fit: contain;
--glyph-has-bench: 0;
--glyph-fade-start: 0;
--glyph-fade-end: 0.01;
```

In the same media query, add `.landing-hero__scene::after { display: none; }` and set `mask-image: none` on `.landing-hero__scene`. Do not change the desktop `.landing-hero__scene` rule.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run lint && npm run build && bun test
```

Expected: lint clean, build succeeds, 425 tests pass, 0 fail.

- [ ] **Step 5: Verify in browser at both breakpoints**

At a viewport wider than `1200px`, confirm the hero `<img>` source ends with `hero-sensor-scene.svg` and `.landing-hero__scene` has no `--glyph-fit: contain`. At `846px`, confirm the source ends with `hero-sensor-device.svg`, `--glyph-fit` is `contain`, `--glyph-has-bench` is `0`, computed `mask-image` is `none`, and the glyph canvas contains non-background pixels near its horizontal center. Confirm no console errors.

import { useEffect, useRef } from 'react';
import { getImagePlacement, type CropFit, type ImagePlacement } from './glyphCrop';

/* The sensor scene is the source image; this renderer turns its luminance into
   a quiet glyph portrait. A few cells change slowly so the scene feels alive
   without a cursor effect or a decoration that competes with the headline. */
const GLYPHS = [' ', '.', '·', ':', '|', '+', '▪'] as const;
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;
const IDLE_INTERVAL = 240;

type ShimmerCell = {
  x: number;
  y: number;
  level: number;
  tone: number;
  alpha: number;
  phase: number;
};

type Frame = {
  ctx: CanvasRenderingContext2D;
  step: number;
  atlases: HTMLCanvasElement[];
  base: HTMLCanvasElement;
  shimmer: ShimmerCell[];
};

const luminance = (data: Uint8ClampedArray, index: number) =>
  (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const smootherstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const drawPlacement = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  placement: ImagePlacement,
) => {
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(
    img,
    placement.sx,
    placement.sy,
    placement.sw,
    placement.sh,
    placement.dx,
    placement.dy,
    placement.dw,
    placement.dh,
  );
};

const buildAtlas = (step: number, color: string) => {
  const atlas = document.createElement('canvas');
  atlas.width = step * GLYPHS.length;
  atlas.height = step;
  const pen = atlas.getContext('2d');
  if (!pen) return null;
  pen.font = `600 ${Math.round(step * 1.06)}px "JetBrains Mono", ui-monospace, monospace`;
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  pen.fillStyle = color;
  GLYPHS.forEach((glyph, index) => {
    pen.fillText(glyph, index * step + step / 2, step / 2 + step * 0.03);
  });
  return atlas;
};

const drawGlyph = (
  ctx: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  level: number,
  alpha: number,
  x: number,
  y: number,
  step: number,
) => {
  ctx.globalAlpha = alpha;
  ctx.drawImage(atlas, level * step, 0, step, step, x, y, step, step);
};

export const GlyphScene = ({ src, cell = 10 }: { src: string; cell?: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let disposed = false;
    let frame: Frame | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let visibilityObserver: IntersectionObserver | undefined;
    let visible = true;
    let timer = 0;

    const render = (now = 0) => {
      if (disposed || !frame || !visible) return;

      const { ctx, step, atlases, base, shimmer } = frame;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      if (reduceMotion) return;

      for (let i = 0; i < shimmer.length; i += 1) {
        const cellState = shimmer[i];
        const wave = (Math.sin(now * 0.0008 + cellState.phase) + 1) / 2;
        if (wave < 0.66) continue;

        const px = cellState.x * step;
        const py = cellState.y * step;
        const alpha = cellState.alpha * (0.88 + wave * 0.1);
        ctx.clearRect(px, py, step, step);
        drawGlyph(ctx, atlases[cellState.tone], cellState.level, alpha, px, py, step);
      }
      ctx.globalAlpha = 1;
    };

    const stop = () => {
      if (!timer) return;
      window.clearInterval(timer);
      timer = 0;
    };

    const start = () => {
      if (reduceMotion || disposed || !visible || timer) return;
      timer = window.setInterval(() => render(performance.now()), IDLE_INTERVAL);
    };

    const image = new Image();

    const prepare = () => {
      if (disposed || !image.complete || !image.naturalWidth) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const step = Math.max(6, Math.round(cell * dpr));
      const width = Math.max(step, Math.round(rect.width * dpr));
      const height = Math.max(step, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const columns = Math.max(1, Math.floor(width / step));
      const rows = Math.max(1, Math.floor(height / step));
      const sample = document.createElement('canvas');
      sample.width = columns;
      sample.height = rows;
      const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
      if (!sampleCtx) return;
      const style = getComputedStyle(canvas);
      const setting = (name: string, fallback: number) => {
        const value = Number.parseFloat(style.getPropertyValue(name));
        return Number.isFinite(value) ? value : fallback;
      };
      const focusX = setting('--glyph-focus-x', 0.62);
      const zoom = setting('--glyph-zoom', 1.45);
      const fadeStart = setting('--glyph-fade-start', 0.12);
      const fadeEnd = setting('--glyph-fade-end', 0.62);
      const fit: CropFit =
        style.getPropertyValue('--glyph-fit').trim() === 'contain' ? 'contain' : 'cover';
      const hasBench = setting('--glyph-has-bench', 1) > 0.5;
      const placement = getImagePlacement({
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        targetWidth: columns,
        targetHeight: rows,
        focusX,
        zoom,
        fit,
      });
      drawPlacement(sampleCtx, image, placement);
      const data = sampleCtx.getImageData(0, 0, columns, rows).data;

      // The workbench starts at y=596 in the 900px source scene. Keep it out of
      // the left fade so it can run the full width of the hero.
      const applyBenchFade = fit === 'cover' && hasBench;
      const benchStart = applyBenchFade
        ? clamp((596 - placement.sy) / placement.sh, 0, 1)
        : 1;

      const background = luminance(data, 0);
      const values: number[] = [];
      const raws = new Float32Array(columns * rows);
      raws.fill(-1);
      for (let i = 0; i < columns * rows; i += 1) {
        const index = i * 4;
        if (data[index + 3] < 8) continue;
        const value = luminance(data, index);
        raws[i] = value;
        if (value > background + 0.012) values.push(value);
      }
      if (!values.length) return;
      values.sort((a, b) => a - b);
      const peak = values[Math.min(values.length - 1, Math.floor(values.length * 0.985))];
      const span = Math.max(0.04, peak - background);
      for (let i = 0; i < raws.length; i += 1) {
        if (raws[i] >= 0) raws[i] = (raws[i] - background) / span;
      }

      const root = getComputedStyle(document.documentElement);
      const ink = [
        root.getPropertyValue('--text-dim').trim() || '#a0a0a0',
        root.getPropertyValue('--text-muted').trim() || '#b8b8b8',
        root.getPropertyValue('--text-primary').trim() || '#f5ffff',
      ];
      const built = ink.map((color) => buildAtlas(step, color));
      if (built.some((atlas) => !atlas)) return;
      const atlases = built as HTMLCanvasElement[];

      const base = document.createElement('canvas');
      base.width = width;
      base.height = height;
      const baseCtx = base.getContext('2d');
      if (!baseCtx) return;

      const shimmer: ShimmerCell[] = [];
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const source = raws[y * columns + x];
          if (source < 0) continue;
          const horizontalFade = smootherstep(fadeStart, fadeEnd, x / Math.max(1, columns - 1));
          const fade = applyBenchFade
            ? 1 - (1 - smoothstep(benchStart - 0.03, benchStart + 0.03, y / Math.max(1, rows - 1))) * (1 - horizontalFade)
            : 1;
          const gate = smoothstep(0.02, 0.075, source * fade);
          const raw = source * fade * gate;
          if (raw <= 0) continue;
          const value = Math.pow(Math.min(1, raw), 0.68);
          const threshold = (BAYER[y % 4][x % 4] + 0.5) / 16 - 0.5;
          const level = Math.max(
            0,
            Math.min(GLYPHS.length - 1, Math.floor(value * GLYPHS.length + threshold * 1.25)),
          );
          if (level === 0) continue;
          const tone = value > 0.86 ? 2 : value > 0.34 ? 1 : 0;
          const alpha = Math.min(0.98, 0.2 + value * 0.78) * fade * gate;
          drawGlyph(baseCtx, atlases[tone], level, alpha, x * step, y * step, step);

          if ((x * 13 + y * 7) % 47 === 0 && raw > 0.24 && tone < 2) {
            shimmer.push({
              x,
              y,
              level,
              tone,
              alpha,
              phase: ((x * 17 + y * 11) % 97) / 97 * Math.PI * 2,
            });
          }
        }
      }
      baseCtx.globalAlpha = 1;

      frame = { ctx, step, atlases, base, shimmer };
      render(performance.now());
      start();
    };

    image.decoding = 'async';
    image.onload = prepare;
    image.src = src;
    prepare();
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!disposed) prepare();
      });
    }

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(prepare);
      resizeObserver.observe(canvas);
    }
    if ('IntersectionObserver' in window) {
      visibilityObserver = new IntersectionObserver(([entry]) => {
        if (!entry) return;
        visible = entry.isIntersecting;
        if (visible) {
          render(performance.now());
          start();
        } else {
          stop();
        }
      });
      visibilityObserver.observe(canvas);
    }

    return () => {
      disposed = true;
      image.onload = null;
      stop();
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
    };
  }, [src, cell]);

  return <canvas ref={canvasRef} className="landing-hero__glyphs" aria-hidden="true" />;
};

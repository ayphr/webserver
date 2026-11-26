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
    expect(p.sw).toBeCloseTo(1600 / 1.45);
    expect(p.sh).toBeCloseTo(1600 / 1.45 / 2);
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

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

export function getImagePlacement({
  imageWidth,
  imageHeight,
  targetWidth,
  targetHeight,
  focusX = 0.62,
  zoom = 1.45,
  fit = 'cover',
}: ImagePlacementOptions): ImagePlacement {
  if (fit === 'contain') {
    const scale = Math.min(targetWidth / imageWidth, targetHeight / imageHeight) / zoom;
    const dw = imageWidth * scale;
    const dh = imageHeight * scale;
    return {
      sx: 0,
      sy: 0,
      sw: imageWidth,
      sh: imageHeight,
      dx: (targetWidth - dw) / 2,
      dy: (targetHeight - dh) / 2,
      dw,
      dh,
    };
  }

  const imageRatio = imageWidth / imageHeight;
  const targetRatio = targetWidth / targetHeight;
  let sw: number;
  let sh: number;

  if (imageRatio > targetRatio) {
    sh = imageHeight / zoom;
    sw = sh * targetRatio;
  } else {
    sw = imageWidth / zoom;
    sh = sw / targetRatio;
  }

  return {
    sx: imageWidth * focusX - sw / 2,
    sy: (imageHeight - sh) * 0.54,
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: targetWidth,
    dh: targetHeight,
  };
}

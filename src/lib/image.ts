const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const MAX_AVATAR_DIMENSION = 512;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

/** Returns an error message when a file is not a valid avatar, or null. */
export function validateAvatarFile(file: File): string | null {
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    return 'Please choose a PNG, JPEG, WEBP, or GIF image';
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return 'Image must be 8 MB or smaller';
  }
  return null;
}

/**
 * Downscales an image to at most MAX_AVATAR_DIMENSION on its longest side and
 * re-encodes it as WEBP to keep uploads small. Falls back to the original file
 * when the browser cannot decode or draw it (e.g. some GIFs).
 */
export async function prepareAvatarFile(file: File): Promise<File> {
  if (!globalThis.createImageBitmap || file.type === 'image/gif') {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const longestSide = Math.max(bitmap.width, bitmap.height);

    if (longestSide <= MAX_AVATAR_DIMENSION) {
      bitmap.close();
      return file;
    }

    const scale = MAX_AVATAR_DIMENSION / longestSide;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob) return file;

    return new File([blob], 'avatar.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}
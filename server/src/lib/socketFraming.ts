const FRAME_SIZE = 18;

export type FrameKind = 'json' | 'binary';

export function appendChunk(buffer: Uint8Array<ArrayBufferLike>, chunk: Uint8Array<ArrayBufferLike>) {
  const next = new Uint8Array(buffer.length + chunk.length);
  next.set(buffer, 0);
  next.set(chunk, buffer.length);
  return next;
}

export function parseIncomingBuffer(buffer: Uint8Array<ArrayBufferLike>): { frames: Uint8Array<ArrayBufferLike>[]; remainder: Uint8Array<ArrayBufferLike> } {
  const frames: Uint8Array<ArrayBufferLike>[] = [];
  let remainder = buffer;

  while (remainder.length >= FRAME_SIZE) {
    if (remainder[0] !== 0x02) {
      let startIndex = -1;
      for (let i = 1; i < remainder.length; i++) {
        if (remainder[i] === 0x02) {
          startIndex = i;
          break;
        }
      }

      if (startIndex === -1) {
        remainder = new Uint8Array(0);
        break;
      }

      remainder = remainder.slice(startIndex);
      if (remainder.length < FRAME_SIZE) break;
    }

    const frame = remainder.slice(0, FRAME_SIZE);
    if (frame[FRAME_SIZE - 1] !== 0x03) {
      remainder = remainder.slice(1);
      continue;
    }

    frames.push(frame);
    remainder = remainder.slice(FRAME_SIZE);
  }

  return { frames, remainder };
}

/**
 * Fixed-capacity FIFO ring buffer. The forecast engine stores every unit of
 * history here so its memory footprint stays constant regardless of uptime.
 */
export class RingBuffer<T> {
  private readonly buffer: T[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number, create: () => T) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('RingBuffer capacity must be a positive integer');
    }
    this.buffer = Array.from({ length: capacity }, create);
  }

  get size(): number {
    return this.count;
  }

  get full(): boolean {
    return this.count === this.capacity;
  }

  push(value: T): void {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  /** Element at `index` counted from the oldest retained entry (0-based). */
  at(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined;
    const start = this.count === this.capacity ? this.head : 0;
    return this.buffer[(start + index) % this.capacity];
  }

  /** Element `offset` back from the newest entry (0 = newest). */
  latest(offset = 0): T | undefined {
    return this.at(this.count - 1 - offset);
  }

  /** Up to `limit` most recent entries, oldest first. */
  recent(limit: number): T[] {
    const n = Math.min(limit, this.count);
    const out: T[] = [];
    for (let i = this.count - n; i < this.count; i += 1) {
      const value = this.at(i);
      if (value !== undefined) out.push(value);
    }
    return out;
  }

  toArray(): T[] {
    return this.recent(this.count);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

const BITS_PER_GEN = 131072; // 16 KB (2^17 bits -> fast bitwise AND mask)
const BIT_MASK = BITS_PER_GEN - 1;
const BYTES_PER_GEN = BITS_PER_GEN >>> 3; // 16,384 bytes
const HASH_COUNT = 7;
const MAX_ITEMS_PER_GEN = 10000;

export interface BloomSnapshot {
  active: Uint8Array;
  previous: Uint8Array;
  activeCount: number;
}

/**
 * Dual-generation Rotating Bloom Filter.
 * Tracks up to 20,000 seen post IDs in 32 KB fixed RAM with <1% false positives.
 */
export class RotatingBloomFilter {
  private active = new Uint8Array(BYTES_PER_GEN);
  private previous = new Uint8Array(BYTES_PER_GEN);
  private activeCount = 0;

  private hash1(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  private hash2(str: string): number {
    let h = 0x9e3779b9;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b);
      h ^= h >>> 13;
    }
    return (h >>> 0) | 1;
  }

  public add(id: string): void {
    if (this.activeCount >= MAX_ITEMS_PER_GEN) {
      this.previous.set(this.active);
      this.active.fill(0);
      this.activeCount = 0;
    }

    const h1 = this.hash1(id);
    const h2 = this.hash2(id);
    for (let i = 0; i < HASH_COUNT; i++) {
      const bit = (h1 + i * h2) & BIT_MASK;
      this.active[bit >>> 3] |= 1 << (bit & 7);
    }
    this.activeCount++;
  }

  public has(id: string): boolean {
    const h1 = this.hash1(id);
    const h2 = this.hash2(id);
    return this.checkBuffer(this.active, h1, h2) || this.checkBuffer(this.previous, h1, h2);
  }

  private checkBuffer(buf: Uint8Array, h1: number, h2: number): boolean {
    for (let i = 0; i < HASH_COUNT; i++) {
      const bit = (h1 + i * h2) & BIT_MASK;
      if ((buf[bit >>> 3] & (1 << (bit & 7))) === 0) return false;
    }
    return true;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public exportState(): BloomSnapshot {
    return {
      active: new Uint8Array(this.active),
      previous: new Uint8Array(this.previous),
      activeCount: this.activeCount,
    };
  }

  public importState(state: BloomSnapshot): void {
    if (state.active.byteLength === BYTES_PER_GEN) this.active.set(state.active);
    if (state.previous.byteLength === BYTES_PER_GEN) this.previous.set(state.previous);
    this.activeCount = Math.max(0, state.activeCount | 0);
  }
}

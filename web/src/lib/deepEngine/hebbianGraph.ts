const MAX_NODES = 128;
const MAX_EDGES_PER_NODE = 8;
const DECAY_GAMMA = 0.95;
const LEARN_RATE = 0.18;

export interface HebbianSnapshot {
  lastPositiveTag: string | null;
  nodes: Array<[string, Array<[string, number]>]>;
}

/**
 * "Neurons that fire together, wire together."
 * Learns invisible connections between tags/vibes a user enjoys back-to-back.
 * Strictly capped at 128 nodes x 8 edges (< 8 KB RAM).
 */
export class HebbianVibeGraph {
  private graph = new Map<string, Map<string, number>>();
  private lastPositiveTag: string | null = null;

  public observe(tag: string, reward: number): void {
    const cleanTag = tag.trim().toLowerCase();
    if (!cleanTag) return;

    if (reward > 0.25 && this.lastPositiveTag && this.lastPositiveTag !== cleanTag) {
      this.strengthen(this.lastPositiveTag, cleanTag, reward);
      this.strengthen(cleanTag, this.lastPositiveTag, reward);
    }

    if (reward > 0.25) {
      this.lastPositiveTag = cleanTag;
    }
  }

  private strengthen(from: string, to: string, reward: number): void {
    if (!this.graph.has(from) && this.graph.size >= MAX_NODES) {
      const oldestKey = this.graph.keys().next().value;
      if (oldestKey) this.graph.delete(oldestKey);
    }

    let edges = this.graph.get(from);
    if (!edges) {
      edges = new Map<string, number>();
      this.graph.set(from, edges);
    }

    for (const [k, w] of edges.entries()) {
      const decayed = w * DECAY_GAMMA;
      if (decayed < 0.03) edges.delete(k);
      else edges.set(k, decayed);
    }

    const prev = edges.get(to) ?? 0;
    edges.set(to, Math.min(1, prev + LEARN_RATE * reward));

    if (edges.size > MAX_EDGES_PER_NODE) {
      const sorted = [...edges.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_EDGES_PER_NODE);
      this.graph.set(from, new Map(sorted));
    }
  }

  public getNodeCount(): number {
    return this.graph.size;
  }

  public getEdgeCount(tag: string): number {
    return this.graph.get(tag.trim().toLowerCase())?.size ?? 0;
  }

  /**
   * Returns a `0..1` affinity boost if `candidateTag` is strongly wired to `currentTag`.
   */
  public getAffinityBoost(currentTag: string, candidateTag: string): number {
    return this.graph.get(currentTag.trim().toLowerCase())?.get(candidateTag.trim().toLowerCase()) ?? 0;
  }

  public exportState(): HebbianSnapshot {
    return {
      lastPositiveTag: this.lastPositiveTag,
      nodes: [...this.graph.entries()].map(([k, v]) => [k, [...v.entries()]]),
    };
  }

  public importState(snapshot: HebbianSnapshot): void {
    this.lastPositiveTag = snapshot.lastPositiveTag ?? null;
    this.graph = new Map(
      (snapshot.nodes ?? []).slice(0, MAX_NODES).map(([k, edges]) => [k, new Map(edges.slice(0, MAX_EDGES_PER_NODE))]),
    );
  }
}

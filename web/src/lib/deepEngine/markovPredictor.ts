export type UserActionState =
  | 'SWIPE_NEXT'
  | 'SWIPE_PREV'
  | 'OPEN_COMMENTS'
  | 'OPEN_PROFILE'
  | 'TAP_REMIX';

const ALL_STATES: readonly UserActionState[] = [
  'SWIPE_NEXT',
  'SWIPE_PREV',
  'OPEN_COMMENTS',
  'OPEN_PROFILE',
  'TAP_REMIX',
];

export interface MarkovSnapshot {
  lastState: UserActionState | null;
  transitions: Array<[UserActionState, Array<[UserActionState, number]>]>;
}

/**
 * First-order Markov Chain with Laplace smoothing (`alpha = 0.5`).
 * Predicts user's next action so Vybe can prefetch data BEFORE they tap.
 */
export class MarkovActionPredictor {
  private transitions = new Map<UserActionState, Map<UserActionState, number>>();
  private lastState: UserActionState | null = null;

  public record(nextState: UserActionState): void {
    if (this.lastState) {
      let row = this.transitions.get(this.lastState);
      if (!row) {
        row = new Map<UserActionState, number>();
        this.transitions.set(this.lastState, row);
      }
      row.set(nextState, (row.get(nextState) ?? 0) + 1);
    }
    this.lastState = nextState;
  }

  /**
   * Returns the most likely next action ONLY if confidence >= `minConfidence` (default 0.55).
   */
  public predictNext(minConfidence = 0.55): { action: UserActionState; confidence: number } | null {
    if (!this.lastState) return null;
    const row = this.transitions.get(this.lastState);
    if (!row) return null;

    const alpha = 0.5;
    let total = 0;
    for (const count of row.values()) total += count;
    const denom = total + alpha * ALL_STATES.length;

    let bestAction: UserActionState = 'SWIPE_NEXT';
    let bestProb = 0;

    for (const candidate of ALL_STATES) {
      const prob = ((row.get(candidate) ?? 0) + alpha) / denom;
      if (prob > bestProb) {
        bestProb = prob;
        bestAction = candidate;
      }
    }

    return bestProb >= minConfidence ? { action: bestAction, confidence: bestProb } : null;
  }

  public exportState(): MarkovSnapshot {
    return {
      lastState: this.lastState,
      transitions: [...this.transitions.entries()].map(([k, v]) => [k, [...v.entries()]]),
    };
  }

  public importState(snapshot: MarkovSnapshot): void {
    this.lastState = snapshot.lastState ?? null;
    this.transitions = new Map(
      (snapshot.transitions ?? []).map(([k, entries]) => [k, new Map(entries)]),
    );
  }
}

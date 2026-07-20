import { Injectable } from '@nestjs/common';

// Fraud, Sybil resistance & network health (M5-040..044). Sandbox heuristics on the
// rating graph + fingerprint blocklist; production swaps in graph-ML models.

@Injectable()
export class FraudService {
  // positive-rating edges: rater → set of subjects rated positively
  private readonly edges = new Map<string, Set<string>>();
  private readonly bannedFingerprints = new Set<string>();
  private readonly weightHistory = new Map<string, number[]>();

  /** Record a positive rating edge (used for collusion/Sybil detection). */
  recordRating(rater: string, subject: string, positive: boolean): void {
    if (!positive) return;
    const set = this.edges.get(rater) ?? new Set<string>();
    set.add(subject);
    this.edges.set(rater, set);
  }

  /** Discount a rating that closes a reciprocal positive loop (collusion ring, M5-041). */
  collusionFactor(rater: string, subject: string): number {
    const reciprocal = this.edges.get(subject)?.has(rater);
    return reciprocal ? 0.3 : 1;
  }

  /** Reciprocal positive pairs (M5-041). */
  detectCollusionPairs(): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    for (const [a, subjects] of this.edges) {
      for (const b of subjects) {
        if (a < b && this.edges.get(b)?.has(a)) pairs.push([a, b]);
      }
    }
    return pairs;
  }

  /**
   * Sybil clusters (M5-040): connected groups that only rate within the group (size ≥ 3).
   */
  detectSybilClusters(): string[][] {
    const nodes = new Set<string>([...this.edges.keys(), ...[...this.edges.values()].flatMap((s) => [...s])]);
    const seen = new Set<string>();
    const clusters: string[][] = [];
    for (const node of nodes) {
      if (seen.has(node)) continue;
      const group = this.componentOf(node, seen);
      const insular = group.every((m) => [...(this.edges.get(m) ?? [])].every((t) => group.includes(t)));
      if (group.length >= 3 && insular) clusters.push(group);
    }
    return clusters;
  }

  /** Reputation-milking heuristic (M5-043): a transaction value far above the built-up history. */
  recordWeightAndCheckMilking(did: string, weight: number): boolean {
    const history = this.weightHistory.get(did) ?? [];
    const avg = history.length ? history.reduce((s, w) => s + w, 0) / history.length : weight;
    history.push(weight);
    this.weightHistory.set(did, history);
    return history.length >= 3 && weight > avg * 5;
  }

  /** Re-identification prevention (M5-042): banned identity fingerprints can't re-enter. */
  banFingerprints(fingerprints: string[]): void {
    fingerprints.forEach((f) => this.bannedFingerprints.add(f));
  }
  isBanned(fingerprint: string): boolean {
    return this.bannedFingerprints.has(fingerprint);
  }

  private componentOf(start: string, seen: Set<string>): string[] {
    const stack = [start];
    const group: string[] = [];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      group.push(n);
      for (const t of this.edges.get(n) ?? []) if (!seen.has(t)) stack.push(t);
      for (const [r, s] of this.edges) if (s.has(n) && !seen.has(r)) stack.push(r);
    }
    return group;
  }
}

/**
 * SeeBuyGet session — the token the app carries, fixed against two field failures:
 *
 *  1. Lost on navigation. The legacy modules kept `let token = null` at module scope, so every
 *     `location.href` threw the token away and re-minted (and six modules sent `Bearer undefined`).
 *     Here the token persists in sessionStorage, so it survives navigations within the tab.
 *  2. A dead RTC. A cheap Android with a wrong real-time clock cannot be trusted for expiry, and the
 *     token's own `exp` must never be read. Expiry is tracked ONLY on the monotonic performance clock,
 *     as a soft early-refresh hint; the server's 401 is the real source of truth (the client re-mints
 *     and retries once on a 401).
 */
export interface MintedToken {
  access_token: string;
  expires_in: number;
}

export type MintFn = () => Promise<MintedToken>;

export class Session {
  private token: string | null;
  private softDeadlineMono = 0; // performance.now() ms; 0 = unknown (trust until a 401)
  /**
   * The mint currently on the wire, if any. Without this, concurrent callers (a Promise.all, or a
   * fire-and-forget ping racing a refresh) each cross the soft deadline and each POST a fresh mint:
   * duplicate round trips on a metered link, and — because a mint records WHY it failed in a single
   * slot — one request's failure can be reported against another's. All callers share one mint.
   */
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly mint: MintFn,
  ) {
    this.token = this.load();
  }

  /** The current token, minting/refreshing only when absent or past the soft monotonic deadline. */
  async getToken(): Promise<string> {
    if (this.token && !this.pastSoftDeadline()) return this.token;
    return this.refresh();
  }

  /** Force a fresh mint (called on 401, or proactively near the soft deadline). Single-flighted. */
  async refresh(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.mintOnce().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async mintOnce(): Promise<string> {
    const { access_token, expires_in } = await this.mint();
    this.token = access_token;
    // Refresh at 90% of the lifetime so a request never starts on an about-to-expire token. Monotonic
    // clock only — never the device wall clock.
    this.softDeadlineMono = this.now() + Math.max(0, expires_in * 1000 * 0.9);
    this.save(access_token);
    return access_token;
  }

  /** Drop the token (sign-out, or after a 401 before retrying). */
  clear(): void {
    this.token = null;
    this.softDeadlineMono = 0;
    try {
      globalThis.sessionStorage?.removeItem(this.storageKey);
    } catch {
      /* storage unavailable — in-memory only */
    }
  }

  private pastSoftDeadline(): boolean {
    return this.softDeadlineMono !== 0 && this.now() >= this.softDeadlineMono;
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : 0;
  }

  private load(): string | null {
    try {
      return globalThis.sessionStorage?.getItem(this.storageKey) ?? null;
    } catch {
      return null;
    }
  }

  private save(token: string): void {
    try {
      globalThis.sessionStorage?.setItem(this.storageKey, token);
    } catch {
      /* storage unavailable — in-memory only */
    }
  }
}

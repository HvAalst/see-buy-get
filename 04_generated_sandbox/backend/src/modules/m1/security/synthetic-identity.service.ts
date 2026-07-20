import { Injectable } from '@nestjs/common';

// Synthetic identity detection (UDIW-051). Sandbox model: build an identity graph keyed by
// shared signals (device fingerprint, payment-instrument hash). When the same signal links
// too many distinct accounts, the cluster is flagged so IdentityService can freeze it.

export interface IdentitySignals {
  deviceFingerprint?: string;
  paymentInstrumentHash?: string;
}

export interface SyntheticScreenResult {
  suspicious: boolean;
  sharedWith: string[];
  signal?: 'deviceFingerprint' | 'paymentInstrumentHash';
}

const CLUSTER_THRESHOLD = 3; // distinct accounts sharing a signal

@Injectable()
export class SyntheticIdentityService {
  private readonly byDevice = new Map<string, Set<string>>();
  private readonly byInstrument = new Map<string, Set<string>>();

  /** Record signals for an account and report whether it joins a suspicious cluster. */
  screen(accountId: string, signals: IdentitySignals): SyntheticScreenResult {
    const device = this.link(this.byDevice, signals.deviceFingerprint, accountId);
    const instrument = this.link(this.byInstrument, signals.paymentInstrumentHash, accountId);

    if (instrument.size >= CLUSTER_THRESHOLD) {
      return { suspicious: true, sharedWith: [...instrument].filter((a) => a !== accountId), signal: 'paymentInstrumentHash' };
    }
    if (device.size >= CLUSTER_THRESHOLD) {
      return { suspicious: true, sharedWith: [...device].filter((a) => a !== accountId), signal: 'deviceFingerprint' };
    }
    return { suspicious: false, sharedWith: [] };
  }

  private link(index: Map<string, Set<string>>, key: string | undefined, accountId: string): Set<string> {
    if (!key) return new Set();
    const set = index.get(key) ?? new Set<string>();
    set.add(accountId);
    index.set(key, set);
    return set;
  }
}

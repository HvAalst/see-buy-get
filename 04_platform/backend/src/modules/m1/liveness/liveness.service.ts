import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LedgerService } from '../../../foundation/ledger/ledger.service';

// Biometric liveness (T-104, UDIW-013). Sandbox model: issue a random challenge phrase,
// require the caller to echo it (stands in for "selfie video reading the phrase"), and on
// success mint a proof-of-liveness certificate anchored to the ledger. A wrong/absent
// phrase (spoof/replay) fails. Challenges are single-use and time-boxed.

const CHALLENGE_WORDS = ['river', 'orange', 'mountain', 'silver', 'harbor', 'lantern', 'meadow', 'copper'];
const TTL_MS = 5 * 60 * 1000;

interface ChallengeEntry {
  phrase: string;
  expiresAt: number;
}

export interface LivenessChallenge {
  challengeId: string;
  phrase: string;
}

export interface LivenessProof {
  certId: string;
  issuedAt: string;
  anchorTxId: string;
}

export interface LivenessOutcome {
  passed: boolean;
  reason?: string;
  proof?: LivenessProof;
}

@Injectable()
export class LivenessService {
  private readonly challenges = new Map<string, ChallengeEntry>();

  constructor(private readonly ledger: LedgerService) {}

  issueChallenge(): LivenessChallenge {
    const challengeId = `live_${randomBytes(12).toString('hex')}`;
    const phrase = Array.from({ length: 3 }, () => CHALLENGE_WORDS[randomBytes(1)[0] % CHALLENGE_WORDS.length]).join(' ');
    this.challenges.set(challengeId, { phrase, expiresAt: Date.now() + TTL_MS });
    return { challengeId, phrase };
  }

  verify(challengeId: string, response: string): LivenessOutcome {
    const entry = this.challenges.get(challengeId);
    if (!entry) return { passed: false, reason: 'unknown_challenge' };
    this.challenges.delete(challengeId); // single-use
    if (Date.now() > entry.expiresAt) return { passed: false, reason: 'challenge_expired' };
    if (!response || response.trim().toLowerCase() !== entry.phrase) {
      return { passed: false, reason: 'liveness_failed' };
    }

    const certId = `lvcert_${randomBytes(12).toString('hex')}`;
    const issuedAt = new Date().toISOString();
    const anchor = this.ledger.anchor({ type: 'proof-of-liveness', certId, challengeId, issuedAt });
    return { passed: true, proof: { certId, issuedAt, anchorTxId: anchor.txId } };
  }
}

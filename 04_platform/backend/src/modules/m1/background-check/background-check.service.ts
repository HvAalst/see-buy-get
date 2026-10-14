import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

// Background-check bureau integration (UDIW-023). Sandbox stub: passes unless the reference
// contains the 'FAILBG' sentinel (so tests can drive both outcomes).

export interface BackgroundCheckResult {
  passed: boolean;
  reference: string;
  reason?: string;
}

@Injectable()
export class BackgroundCheckService {
  run(subjectRef: string): BackgroundCheckResult {
    const reference = `bgc_${randomBytes(8).toString('hex')}`;
    if (subjectRef && subjectRef.toUpperCase().includes('FAILBG')) {
      return { passed: false, reference, reason: 'adverse_record' };
    }
    return { passed: true, reference };
  }
}

import { Injectable } from '@nestjs/common';
import { HS_CODE_RE } from './ewaybill-schema';

/**
 * HS CODES (M2-024): the FORMAT of a code somebody typed is checked, and nothing else.
 *
 * It used to suggest a code from the words of a description, and fill one in when none was typed. That is classifying
 * goods, which is regulated advice and the shipper's or its customs agent's to give: a wrong code is the trader's duty
 * and the trader's penalty. The user, 2026-10-18: removed. A shipment with no code carries none.
 */
@Injectable()
export class HsCodeService {
  /** Validate HS code format (6/8/10 digits). */
  isValid(code: string): boolean {
    return HS_CODE_RE.test(code);
  }
}

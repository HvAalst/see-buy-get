import { readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage } from 'class-validator';
import { BODY_LIMITS, DEFAULT_BODY, bodyForFile, bodyLimitFor, patternOf, sayTooLarge } from './body-limits';
import { GlosError } from './foundation/http/glos-error';
import { UPLOAD_LIMITS } from './foundation/media/upload-limits';
import { MAX_DOCUMENT_BYTES } from './foundation/entity/company-documents.service';
import { MAX_EVIDENCE_BYTES } from './foundation/entity/company-paper-reports.service';
import { MEDIA_MAX_BYTES } from './modules/pudo/media.types';
import { MAX_VOICE_BYTES } from './modules/pudo/conversation.service';
import { MAX_WORKBOOK_BYTES } from './modules/pudo/workbook';
import { HELP_IMAGE_MAX_BYTES } from './modules/pudo/help.types';
import { ImportOrdersDto } from './modules/pudo/carriage-contract.dto';
import { PackingImportDto } from './modules/pudo/export-packing.types';

/** The @MaxLength a DTO's field carries — the most a route says it takes, read from the route itself. */
function maxLengthOf(dto: new () => object, field: string): number | undefined {
  const rules = getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false);
  const rule = rules.find((r) => r.propertyName === field && r.name === 'maxLength');
  return rule ? Number(rule.constraints?.[0]) : undefined;
}

/**
 * THE BODY PARSER IS NEVER SMALLER THAN THE FILE (2026-11-02). Before, a route that took an 8 MB paper sat behind a
 * 2 MB parser, which turned a 3 MB scan away before the route — with its own words — was ever asked.
 */
describe('how large a request may be, route by route', () => {
  it('each service enforces the limit named in one place', () => {
    expect(MEDIA_MAX_BYTES).toBe(UPLOAD_LIMITS.photo);
    expect(MAX_DOCUMENT_BYTES).toBe(UPLOAD_LIMITS.document);
    expect(MAX_EVIDENCE_BYTES).toBe(UPLOAD_LIMITS.evidence);
    expect(MAX_VOICE_BYTES).toBe(UPLOAD_LIMITS.voice);
    expect(MAX_WORKBOOK_BYTES).toBe(UPLOAD_LIMITS.workbook);
    expect(HELP_IMAGE_MAX_BYTES).toBe(UPLOAD_LIMITS.helpPicture);
    // What a sheet's text may be, as the routes' own DTOs say it (they keep their number; this holds the two equal).
    expect(maxLengthOf(ImportOrdersDto, 'text')).toBe(UPLOAD_LIMITS.orderSheetText);
    expect(maxLengthOf(PackingImportDto, 'text')).toBe(UPLOAD_LIMITS.packingText);
  });

  it('gives every route a body at least as large as the largest file it takes, base64 and all', () => {
    for (const limit of BODY_LIMITS) {
      const most = limit.most ?? 0;
      const needed = limit.carries === 'file' ? Math.ceil((most * 4) / 3) : most * 3;
      expect({ name: limit.name, most: most > 0, enough: limit.bodyBytes > needed }).toEqual({ name: limit.name, most: true, enough: true });
    }
    // A photograph is sent with its thumbnail: the body holds both.
    expect(bodyLimitFor('/v1/sbg/media').bodyBytes).toBeGreaterThanOrEqual(bodyForFile(UPLOAD_LIMITS.photo + UPLOAD_LIMITS.photoThumb));
    // A workbook goes to the routes that take a sheet's text, whose bodies are larger still.
    for (const path of ['/v1/sbg/fleet/managers/did:x/contracts/c_1/orders/import', '/v1/sbg/exports/e_1/packing-list/check']) {
      expect(bodyLimitFor(path).bodyBytes).toBeGreaterThan(bodyForFile(UPLOAD_LIMITS.workbook));
    }
  });

  it('sends each named route to its own limit, in any case and with a slash at the end, and no other route', () => {
    expect(bodyLimitFor('/v1/sbg/entities/ent_1/documents').most).toBe(UPLOAD_LIMITS.document);
    expect(bodyLimitFor('/V1/SBG/Entities/ent_1/Documents/').most).toBe(UPLOAD_LIMITS.document);
    expect(bodyLimitFor('/v1/sbg/entities/ent_1/record/declare').most).toBe(UPLOAD_LIMITS.document);
    expect(bodyLimitFor('/v1/sbg/quotes/q_1/proforma').most).toBe(UPLOAD_LIMITS.document);
    expect(bodyLimitFor('/v1/sbg/entities/ent_1/documents/doc_1/report').most).toBe(UPLOAD_LIMITS.evidence);
    expect(bodyLimitFor('/v1/sbg/contract/company/papers/report').most).toBe(UPLOAD_LIMITS.evidence);
    expect(bodyLimitFor('/v1/sbg/paper-reports/case_1/answer').most).toBe(UPLOAD_LIMITS.evidence);
    expect(bodyLimitFor('/v1/sbg/fleet/managers/did:x/contracts/c_1/orders/import').most).toBe(UPLOAD_LIMITS.orderSheetText);
    expect(bodyLimitFor('/v1/sbg/exports/e_1/packing-list/check').most).toBe(UPLOAD_LIMITS.packingText);
    expect(bodyLimitFor('/v1/sbg/api/business/exports/e_1/packing-list').most).toBe(UPLOAD_LIMITS.packingText);
    expect(bodyLimitFor('/v1/sbg/media').most).toBe(UPLOAD_LIMITS.photo);
    expect(bodyLimitFor('/v1/sbg/identity/id-disputes/photo').most).toBe(UPLOAD_LIMITS.photo);
    expect(bodyLimitFor('/v1/sbg/conversations/c_1/voice').most).toBe(UPLOAD_LIMITS.voice);
    expect(bodyLimitFor('/v1/sbg/help/packaging/box/image').most).toBe(UPLOAD_LIMITS.helpPicture);
    // A photograph's bytes being READ is not one being sent; nor is a paper being verified.
    expect(bodyLimitFor('/v1/sbg/media/med_1')).toBe(DEFAULT_BODY);
    expect(bodyLimitFor('/v1/sbg/entities/ent_1/documents/doc_1/verify')).toBe(DEFAULT_BODY);
    expect(DEFAULT_BODY.carries).toBe('none');
    expect(patternOf('/v1/sbg/entities/:id/documents').test('/v1/sbg/entities/a/b/documents')).toBe(false);
  });

  it('names only routes that exist — each is in the contract the server publishes', () => {
    const contract = JSON.parse(readFileSync(join(__dirname, '..', 'contracts', 'openapi.json'), 'utf8')) as { paths: Record<string, unknown> };
    const routes = Object.keys(contract.paths);
    // The guard read the contract: the photo route is among what it found.
    expect(routes).toContain('/v1/sbg/media');
    const named = BODY_LIMITS.flatMap((l) => l.paths);
    expect(named.length).toBeGreaterThanOrEqual(10);
    for (const path of named) {
      const asContract = routes.some((r) => patternOf(path).test(r.replace(/\{[^}]+\}/g, 'x')));
      expect({ path, inTheContract: asContract }).toEqual({ path, inTheContract: true });
    }
  });

  it('turns the parser’s refusal into ours: MEDIA_TOO_LARGE, with the file’s size and the most', () => {
    const paper = BODY_LIMITS.find((l) => l.most === UPLOAD_LIMITS.document)!;
    let passed: unknown;
    sayTooLarge(paper)({ type: 'entity.too.large', length: 20_000_000, limit: paper.bodyBytes, status: 413 }, {} as never, {} as never, (e: unknown) => (passed = e));
    expect(passed).toBeInstanceOf(GlosError);
    const err = passed as GlosError;
    expect(err.code).toBe('MEDIA_TOO_LARGE');
    expect(err.getStatus()).toBe(413);
    expect(err.retryable).toBe(false);
    expect(err.params).toEqual({ bytes: 15_000_000, maxBytes: UPLOAD_LIMITS.document });
    // Sent in pieces, its length unknown: the most is still said.
    sayTooLarge(paper)({ type: 'entity.too.large' }, {} as never, {} as never, (e: unknown) => (passed = e));
    expect((passed as GlosError).params).toEqual({ maxBytes: UPLOAD_LIMITS.document });
    // A route that takes no file: too large, and nothing more to say.
    sayTooLarge(DEFAULT_BODY)({ type: 'entity.too.large', length: 3_000_000 }, {} as never, {} as never, (e: unknown) => (passed = e));
    expect((passed as GlosError).code).toBe('MEDIA_TOO_LARGE');
    expect((passed as GlosError).params).toEqual({});
    // Anything else goes on as it came.
    const other = new Error('something else');
    sayTooLarge(paper)(other, {} as never, {} as never, (e: unknown) => (passed = e));
    expect(passed).toBe(other);
  });
});

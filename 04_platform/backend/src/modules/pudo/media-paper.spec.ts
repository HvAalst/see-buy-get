import { MediaService } from './media.service';
import { bodyLimitFor } from '../../body-limits';
import { UPLOAD_LIMITS } from '../../foundation/media/upload-limits';

/**
 * 2026-11-03 — A PERSON'S PAPER AS A PHOTO OR A PDF (the owner, of a shop's ID and trading licence: "photo or pdf for both
 * docs"): kept as photos are, up to a company paper's size; a PDF's small copy is a tile that says PDF.
 */
describe('a paper, a photo or a PDF', () => {
  const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF').toString('base64')}`;

  it('takes a PDF for an ID or a licence, and shows it in the strip as a PDF tile', () => {
    const media = new MediaService();
    const { mediaId } = media.uploadPaper({ ownerDid: 'did:glos:pudo-agent:x', kind: 'kyc_id', dataUrl: pdf });
    expect(media.blob(mediaId).contentType).toBe('application/pdf');
    const thumb = media.blob(mediaId, 'thumb');
    expect(thumb.contentType).toBe('image/svg+xml');
    expect(thumb.bytes.toString()).toMatch(/>PDF</);
    expect(thumb.bytes.toString()).not.toMatch(/<script|onload|href/i);
  });

  it('refuses a PDF where only a photo is taken, and what is not a paper at all', () => {
    const media = new MediaService();
    expect(() => media.upload({ ownerDid: 'did:x', kind: 'kyc_id', dataUrl: pdf })).toThrow();
    expect(() => media.uploadPaper({ ownerDid: 'did:x', kind: 'kyc_licence', dataUrl: 'data:text/html;base64,PGgxPmhpPC9oMT4=' })).toThrow();
  });

  it('is sent to a door that takes a company paper’s size', () => {
    expect(bodyLimitFor('/v1/sbg/media/paper').most).toBe(UPLOAD_LIMITS.document);
    expect(bodyLimitFor('/v1/sbg/media').most).toBe(UPLOAD_LIMITS.photo);
  });
});

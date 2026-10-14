import { audioSignatureMatches, decodeAudio } from './decode-audio';

/**
 * CV4 — what counts as a voice message. Trust the bytes, never the label: the label is whatever the caller typed.
 */
describe('decoding a voice message', () => {
  const pad = (head: Buffer) => Buffer.concat([head, Buffer.alloc(40, 7)]);
  const url = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString('base64')}`;
  const WEBM = pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));

  it('accepts what a phone’s recorder produces, codec parameters and all', () => {
    expect(decodeAudio(url('audio/webm;codecs=opus', WEBM), 1000).contentType).toBe('audio/webm');
    expect(decodeAudio(url('audio/ogg', pad(Buffer.from('OggS'))), 1000).contentType).toBe('audio/ogg');
    expect(decodeAudio(url('audio/mp4', pad(Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))), 1000).contentType).toBe('audio/mp4');
    expect(decodeAudio(url('audio/mpeg', pad(Buffer.from('ID3'))), 1000).contentType).toBe('audio/mpeg');
  });

  it('refuses text, markup or an image announced as audio', () => {
    expect(() => decodeAudio(url('audio/webm', pad(Buffer.from('<script>alert(1)</script>'))), 1000)).toThrow(/not a real recording/);
    expect(() => decodeAudio(url('audio/mp4', pad(Buffer.from([0xff, 0xd8, 0xff]))), 1000)).toThrow(/not a real recording/);
    expect(audioSignatureMatches('audio/ogg', Buffer.from('short'))).toBe(false);
  });

  it('refuses a type it does not know, an empty recording and one past the ceiling', () => {
    expect(() => decodeAudio(url('audio/x-wav', WEBM), 1000)).toThrow(/Unsupported recording type/);
    expect(() => decodeAudio(url('image/png', WEBM), 1000)).toThrow(/Expected a base64 audio recording/);
    expect(() => decodeAudio('data:audio/webm;base64,', 1000)).toThrow(/Expected a base64 audio recording/);
    expect(() => decodeAudio(url('audio/webm', WEBM), 10)).toThrow(/too long to send/);
  });
});

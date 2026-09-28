import { signRequest, signatureParts } from './sigv4';

/**
 * SIGNING IS THE ONE THING HERE THAT CANNOT BE VERIFIED BY READING IT.
 *
 * A signature is byte-exact or worthless, and a plausible-looking wrong one fails only against a real
 * server — which is the shape of defect this project keeps finding (the vendor callback has been built,
 * signed and queued for months without ever being posted). So this checks against AWS's own published
 * worked example for PUT Object, which pins every intermediate step and not merely the answer: get the
 * canonical request wrong by one character and the first assertion says exactly where.
 */
describe('AWS Signature Version 4', () => {
  /** The documented example: PUT test$file.text into examplebucket, 24 May 2013. */
  const EXAMPLE = {
    method: 'PUT',
    url: 'https://examplebucket.s3.amazonaws.com/test$file.text',
    body: Buffer.from('Welcome to Amazon S3.'),
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    service: 's3',
    now: new Date('2013-05-24T00:00:00Z'),
    headers: {
      date: 'Fri, 24 May 2013 00:00:00 GMT',
      'x-amz-storage-class': 'REDUCED_REDUNDANCY',
    },
  };

  it('builds the canonical request AWS documents, character for character', () => {
    const parts = signatureParts(EXAMPLE);
    expect(parts.canonicalRequest).toBe(
      [
        'PUT',
        '/test%24file.text',
        '',
        'date:Fri, 24 May 2013 00:00:00 GMT',
        'host:examplebucket.s3.amazonaws.com',
        'x-amz-content-sha256:44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
        'x-amz-date:20130524T000000Z',
        'x-amz-storage-class:REDUCED_REDUNDANCY',
        '',
        'date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class',
        '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
      ].join('\n'),
    );
  });

  it('builds the string to sign AWS documents', () => {
    const parts = signatureParts(EXAMPLE);
    expect(parts.stringToSign).toBe(
      ['AWS4-HMAC-SHA256', '20130524T000000Z', '20130524/us-east-1/s3/aws4_request', '9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d'].join('\n'),
    );
  });

  it('PRODUCES THE PUBLISHED SIGNATURE — the assertion the whole file exists for', () => {
    expect(signatureParts(EXAMPLE).signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('puts the credential, the signed headers and the signature in the Authorization header', () => {
    const signed = signRequest(EXAMPLE);
    expect(signed.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, ' +
        'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('never sends a host header of its own — fetch sets it, and two is a 400', () => {
    const signed = signRequest(EXAMPLE);
    expect(Object.keys(signed.headers).map((h) => h.toLowerCase())).not.toContain('host');
    // ...but it was still SIGNED, which is what the server checks.
    expect(signatureParts(EXAMPLE).signedHeaders).toContain('host');
  });

  /* ------------------------------------------------------------- the details that bite -- */

  it('encodes a path segment once, and leaves the separators alone', () => {
    // S3 is the service that does NOT double-encode. Getting this wrong signs a different object name
    // than the one the request asks for, and the server says only "SignatureDoesNotMatch".
    const parts = signatureParts({ ...EXAMPLE, url: 'https://b.s3.amazonaws.com/notes/CMR-1/a b+c.zip' });
    expect(parts.canonicalRequest.split('\n')[1]).toBe('/notes/CMR-1/a%20b%2Bc.zip');
  });

  it('encodes the characters encodeURIComponent would leave behind', () => {
    // !'()* are unreserved to encodeURIComponent and reserved to SigV4. A bucket key with an
    // apostrophe in it would otherwise fail for no visible reason.
    const parts = signatureParts({ ...EXAMPLE, url: "https://b.s3.amazonaws.com/o'brien!(1).zip" });
    expect(parts.canonicalRequest.split('\n')[1]).toBe('/o%27brien%21%281%29.zip');
  });

  it('sorts query parameters by name and then by value', () => {
    const parts = signatureParts({ ...EXAMPLE, url: 'https://b.s3.amazonaws.com/k?b=2&a=2&a=1' });
    expect(parts.canonicalRequest.split('\n')[2]).toBe('a=1&a=2&b=2');
  });

  it('signs the body, so a changed byte is a different signature', () => {
    const a = signatureParts(EXAMPLE).signature;
    const b = signatureParts({ ...EXAMPLE, body: Buffer.from('Welcome to Amazon S3!') }).signature;
    expect(a).not.toBe(b);
  });

  it('signs a session token when there is one', () => {
    const parts = signatureParts({ ...EXAMPLE, sessionToken: 'tok123' });
    expect(parts.signedHeaders).toContain('x-amz-security-token');
    expect(parts.canonicalRequest).toContain('x-amz-security-token:tok123');
  });

  it('scopes the key to the day, the region and the service', () => {
    const here = signatureParts(EXAMPLE);
    const elsewhere = signatureParts({ ...EXAMPLE, region: 'eu-west-1' });
    expect(here.credentialScope).toBe('20130524/us-east-1/s3/aws4_request');
    expect(elsewhere.signature).not.toBe(here.signature);
  });
});

/**
 * EVERY SIGN-UP AGREES (the user, 2026-10-25: "every sign up needs an agreement of terms of use, use of data, storage of
 * data, cookie statement"): the versions of the terms of use, the data notice and the cookie statement a test signing
 * somebody up has read. A fresh server has version 1 of each, inserted with the system (foundation/documents).
 */
export const AGREED = { agreement: { versions: { terms: 1, privacy: 1, cookies: 1 } } } as const;

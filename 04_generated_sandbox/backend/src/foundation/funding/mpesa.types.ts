/**
 * WHAT SAFARICOM ACTUALLY SENDS AND EXPECTS — the Daraja wire, written down once.
 *
 * Every shape here is the provider's, not ours, and the names are deliberately theirs: `BillRefNumber`,
 * `CheckoutRequestID`, `stkCallback`. Renaming them to house style would make this file pleasant to read
 * and useless to check against the API documentation, which is the only thing that can tell you whether
 * it is right. The translation into our own vocabulary happens in the adapter, which is the whole job of
 * an adapter.
 *
 * TWO PATHS, AND THEY ARE NOT SYMMETRICAL. That asymmetry is the reason this file exists.
 *
 * **STK push (the main path).** We initiate: a POST to Daraja makes the payer's phone ring, they enter
 * their M-Pesa PIN, and a callback comes back to a URL we chose per request. Because WE started it we
 * already know who is paying and how much, so there is no reference for anybody to mistype — the
 * unattributable pile nearly empties. What comes back does NOT carry our account reference at all; it
 * carries the `CheckoutRequestID` we were given when we asked, which is why the adapter has to remember
 * the mapping. Forget that and every successful payment lands unattributed.
 *
 * **C2B paybill (the fallback).** The payer walks to a kiosk or uses their own phone's M-Pesa menu and
 * types a shortcode and an account number. We are told afterwards. Here our reference IS present — as
 * `BillRefNumber`, whatever the payer managed to type — and the callback shape is entirely different
 * from the STK one. It catches the payments STK cannot: somebody paying from a different number, an
 * agent paying on a shop's behalf, a phone with no data.
 *
 * NEITHER CALLBACK IS SIGNED. Not with an HMAC, not with a bearer token, not with anything. This is the
 * single most important fact on this page and the reason the funding seam's `verify` is asynchronous: a
 * POST body from Safaricom and a POST body from somebody who guessed the URL are byte-identical. The only
 * provenance available is (a) which address it arrived from and (b) asking Safaricom, over a channel we
 * authenticate ourselves, whether the transaction it describes actually happened. The adapter does both.
 */

/** Which Daraja to talk to. The sandbox is a real service with real callbacks against play money — it is
 *  not a stub of ours, which is exactly why it is worth pointing at. */
export type DarajaEnv = 'sandbox' | 'production';

export const DARAJA_HOSTS: Record<DarajaEnv, string> = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

/**
 * THE SHORTCODE'S KIND, because it changes the request and the money's destination.
 *
 * A paybill takes an account number from the payer and is the only kind that can carry our reference on
 * the fallback path. A till (buy goods) does not take one at all. Getting this wrong does not fail
 * loudly — it produces payments with no reference on them for ever.
 */
export type DarajaShortcodeKind = 'paybill' | 'till';

export const DARAJA_TRANSACTION_TYPE: Record<DarajaShortcodeKind, string> = {
  paybill: 'CustomerPayBillOnline',
  till: 'CustomerBuyGoodsOnline',
};

/** `POST /oauth/v1/generate?grant_type=client_credentials`, Basic auth with the app's key and secret. */
export interface DarajaTokenResponse {
  access_token: string;
  /** Seconds, as a STRING in Daraja's own responses. Always an hour in practice; never assumed here. */
  expires_in: string | number;
}

/** `POST /mpesa/stkpush/v1/processrequest` — what we send to make a phone ring. */
export interface DarajaStkRequest {
  BusinessShortCode: string;
  /** base64(shortcode + passkey + timestamp). Not a secret in itself — the passkey inside it is. */
  Password: string;
  /** `yyyyMMddHHmmss` in EAST AFRICA TIME, and it must match the one inside `Password`. */
  Timestamp: string;
  TransactionType: string;
  /** Whole shillings. Daraja rejects a decimal outright — see `wholeShillings` in the adapter. */
  Amount: number;
  /** The paying subscriber, `2547XXXXXXXX` — no plus, no leading zero. */
  PartyA: string;
  /** Who is paid: the shortcode (for a till, the store number). */
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  /**
   * Our reference, as the payer's statement will show it. **Max 12 characters** — the constraint that
   * decides the shape of the whole reference scheme, since `SBG-QNTS-QP5D` is thirteen.
   */
  AccountReference: string;
  /** Free text shown in the prompt. Max 13 characters in practice. */
  TransactionDesc: string;
}

/** The synchronous answer to that POST. `ResponseCode === '0'` means *the prompt was sent*, nothing more. */
export interface DarajaStkResponse {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  /** Present instead of the above when the request itself was rejected. */
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
}

/** One `CallbackMetadata.Item`. Daraja sends a list of name/value pairs rather than an object. */
export interface DarajaCallbackItem {
  Name: string;
  Value?: string | number;
}

/**
 * The STK callback body. Arrives at the `CallBackURL` we gave, unsigned, as:
 * `{"Body":{"stkCallback":{…}}}`.
 *
 * `ResultCode` 0 is paid. Everything else is a non-payment with a reason worth keeping: 1032 is the payer
 * pressing cancel, 1037 is a phone that never answered, 1 is not enough money in the wallet, 2001 is a
 * wrong PIN. A failed STK is NOT an error of ours and must not read like one.
 */
export interface DarajaStkCallback {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: DarajaCallbackItem[] };
    };
  };
}

/**
 * `POST /mpesa/stkpushquery/v1/query` — "did that prompt end in a payment?"
 *
 * The belt to the callback's braces, and the thing that makes an unsigned callback safe to act on: we ask
 * Safaricom over a connection we authenticated, so the answer cannot be forged by whoever posted to us.
 */
export interface DarajaStkQueryResponse {
  ResponseCode?: string;
  ResultCode?: number | string;
  ResultDesc?: string;
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * The C2B confirmation body — the paybill fallback's callback. A completely different shape from the STK
 * one, flat, with every value a string, and with our reference in `BillRefNumber` exactly as the payer
 * typed it (or did not).
 *
 * `MSISDN` is masked in production (`25470****149`), which is a privacy decision of Safaricom's we simply
 * inherit; it is kept as a label for a human chasing a payment, never as an identity.
 */
export interface DarajaC2bConfirmation {
  TransactionType?: string;
  TransID?: string;
  /** `yyyyMMddHHmmss`, East Africa Time. */
  TransTime?: string;
  TransAmount?: string | number;
  BusinessShortCode?: string;
  BillRefNumber?: string;
  InvoiceNumber?: string;
  OrgAccountBalance?: string;
  ThirdPartyTransID?: string;
  MSISDN?: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
}

/**
 * SAFARICOM'S PUBLISHED CALLBACK RANGES.
 *
 * The only provenance an unsigned callback has, and on its own not enough — an allowlist says a body came
 * from their network, never that the body is true, which is why the adapter also asks them. Kept as CIDR
 * strings and matched with a real prefix comparison rather than `startsWith`, because `196.201.214.1`
 * must not be allowed to admit `196.201.214.100`, and because `196.201.21` would otherwise admit a
 * different /24 entirely.
 *
 * Overridable by configuration: these change, and a deployment that cannot correct them without a release
 * is a deployment that will one day silently refuse every payment.
 */
export const DARAJA_CALLBACK_CIDRS = [
  '196.201.214.0/24',
  '196.201.213.0/24',
  '196.201.212.0/24',
  '196.201.179.0/24',
  '196.201.177.0/24',
  '196.201.176.0/24',
];

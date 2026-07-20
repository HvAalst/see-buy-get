// M6 auth shim contracts (T-006, APIG-011 subset).

export type GrantType = 'client_credentials' | 'did';

export interface IssueTokenInput {
  /** Subject: a client id (client_credentials) or a DID (did-bound). */
  sub: string;
  type: GrantType;
  ttlSeconds?: number;
}

export interface AccessToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface IntrospectionResult {
  active: boolean;
  sub?: string;
  type?: GrantType;
  exp?: number;
  reason?: string;
}

export interface TokenClaims {
  sub: string;
  type: GrantType;
  iat: number;
  exp: number;
}

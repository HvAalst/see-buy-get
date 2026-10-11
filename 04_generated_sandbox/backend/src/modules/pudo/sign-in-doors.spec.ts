import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../foundation/auth/public.decorator';
import { RATE_LIMIT_KEY, RateLimitGuard, RateLimitSpec } from '../../foundation/http/rate-limit.guard';
import { AuthController } from '../../foundation/auth/auth.controller';
import { SbgController } from './pudo.controller';
import { IdentityController } from './identity.controller';
import { AccountMoveController } from './account-move.controller';
import { IdDisputeController } from './id-dispute.controller';
import { DocumentLinkController } from './document-link.controller';

/**
 * EVERY DOOR ANYBODY CAN KNOCK ON, AND WHETHER IT COUNTS THE KNOCKS.
 *
 * The Shop and Hub sign-in went without a limit for as long as it did because nothing said it should have one: each
 * door got its limit when somebody thought of it. This reads the doors themselves — every route that needs no
 * sign-in and changes something — so that a new one is either limited or put on the short list below WITH ITS REASON,
 * and is never just forgotten.
 *
 * A limit is two decorators, and one without the other does nothing: `@RateLimit` only writes a number down, and
 * `@UseGuards(RateLimitGuard)` is what reads it. Both are asked for.
 */
interface Door {
  path: string;
  open: boolean;
  limit?: RateLimitSpec;
  guarded: boolean;
}

function doorsOf(controller: { prototype: object; name: string }, prefix: string): Door[] {
  const proto = controller.prototype as Record<string, unknown>;
  const doors: Door[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    const handler = proto[name];
    if (typeof handler !== 'function' || name === 'constructor') continue;
    if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.POST) continue;
    const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
    const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
    doors.push({ path: `${prefix}${path}`.replace(/\/$/, ''), open: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true, limit: Reflect.getMetadata(RATE_LIMIT_KEY, handler), guarded: guards.includes(RateLimitGuard) });
  }
  return doors;
}

const DOORS = [
  ...doorsOf(SbgController, 'sbg/'),
  ...doorsOf(IdentityController, 'sbg/identity/'),
  ...doorsOf(AccountMoveController, 'sbg/'),
  ...doorsOf(IdDisputeController, 'sbg/'),
  ...doorsOf(DocumentLinkController, 'sbg/'),
  ...doorsOf(AuthController, 'auth/'),
];
const door = (path: string) => DOORS.find((d) => d.path === path);
const QUARTER_HOUR = 15 * 60;

describe('every door anybody can knock on', () => {
  it('read the doors: hundreds of routes, and the ones this is about among them', () => {
    expect(DOORS.length).toBeGreaterThan(200);
    expect(DOORS.filter((d) => d.open).length).toBeGreaterThan(30);
    for (const path of ['sbg/auth/login', 'sbg/vendors/session', 'sbg/operators/login', 'sbg/identity/login', 'auth/token']) expect([path, door(path)?.open]).toEqual([path, true]);
  });

  /**
   * THE DOORS THAT TAKE A SECRET — a password, a PIN, a code, a store's secret — and how many tries one caller gets
   * in a quarter of an hour. Sixty where a street of shops or a depot of drivers may stand behind one address of a
   * mobile network; twenty where an office does; ten where the act is rare. (The count nobody can spread over many
   * addresses is the one against the ACCOUNT: `PasswordTries`, a PIN's five tries, a code's five.)
   */
  const SECRET_DOORS: Record<string, number> = {
    'sbg/auth/login': 60, // a shop, a hub, a courier by email
    'sbg/auth/password': 20,
    'sbg/auth/forgot': 20,
    'sbg/auth/reset': 20,
    'sbg/auth/phone/verify': 60,
    'sbg/operators/login': 20,
    'sbg/operators/password': 20,
    'sbg/operators/welcome': 20, // the link a new member of staff was emailed: they choose their password
    'sbg/operators/welcome/check': 20, // …and whose link it is, asked before the password is typed
    'sbg/entities/admins/login': 20,
    'sbg/entities/admins/password': 20,
    'sbg/vendors/session': 20,
    'sbg/vendors/login': 20,
    'sbg/fleet/managers/login': 20,
    'sbg/fleet/managers/session': 20,
    'sbg/fleet/managers/mine': 20,
    'sbg/drivers/session': 60,
    'sbg/identity/login': 60,
    'sbg/identity/device': 20, // the code was typed: this device is handed its key
    'sbg/identity/pin/change': 20,
    'sbg/identity/recover': 10,
    'sbg/identity/account-code': 10,
    'sbg/identity/phone/undo': 10,
    'sbg/identity/email/request': 20,
  };

  it.each(Object.entries(SECRET_DOORS))('%s counts one caller’s tries: %i in a quarter of an hour, and the count is read', (path, limit) => {
    const d = door(path);
    expect(d).toBeDefined();
    expect(d!.limit).toEqual({ limit, windowSec: QUARTER_HOUR });
    // The number alone is a note to nobody: the guard is what reads it.
    expect(d!.guarded).toBe(true);
  });

  it('…and so does the one that asks for a password from INSIDE: replacing a store’s secret', () => {
    const d = door('sbg/vendors/:id/secret/rotate')!;
    expect(d.open).toBe(false);
    expect(d.limit).toEqual({ limit: 20, windowSec: QUARTER_HOUR });
    expect(d.guarded).toBe(true);
  });

  it('the doors that make us WRITE TO somebody who has confirmed nothing are counted too: a new store’s welcome, and "tell me when you reach my country"', () => {
    for (const path of ['sbg/vendors', 'sbg/countries/:code/interest']) {
      expect([path, door(path)?.open, door(path)?.limit, door(path)?.guarded]).toEqual([path, true, { limit: 20, windowSec: QUARTER_HOUR }, true]);
    }
  });

  it('the doors that MAKE an account, or send a code to a phone, are counted as well — widely, because a market’s worth of people can stand behind one address', () => {
    for (const path of ['sbg/auth/phone/request', 'sbg/auth/signup', 'sbg/identity/enroll']) {
      expect([path, door(path)?.open, door(path)?.limit, door(path)?.guarded]).toEqual([path, true, { limit: 120, windowSec: QUARTER_HOUR }, true]);
    }
  });

  it('no limit is written down without the guard that reads it, on any route', () => {
    expect(DOORS.filter((d) => d.limit && !d.guarded).map((d) => d.path)).toEqual([]);
  });

  /**
   * WHAT IS OPEN AND NOT COUNTED PER CALLER — every one of them, each with why. A new open door that changes something
   * fails this until it is given a limit or a line here.
   */
  const NOT_COUNTED: Record<string, string> = {
    'sbg/size/classify': 'a sum over the open size thresholds: it reads nothing about anybody and keeps nothing',
    'sbg/consignment-notes/verify': 'answers about a SHA-256 fingerprint and nothing else: whoever asks already holds the document, and a fingerprint cannot be guessed',
    'sbg/dispatch/offers/decline': 'takes the single-use token that rode in one driver’s notification: it can only say "not now" to that one offer, and dies with it',
    'auth/token': 'the trusted-caller grant: closed outside a sandbox unless GLOS_CLIENT_SECRET is set, and that is a secret a generator made, not one to be guessed',
    'auth/introspect': 'says whether a token somebody already holds is good; it gives nothing away about one they do not hold',
  };

  it('what is open and not counted per caller is exactly the list that says why', () => {
    const open = DOORS.filter((d) => d.open && !d.limit).map((d) => d.path).sort();
    expect(open).toEqual(Object.keys(NOT_COUNTED).sort());
    for (const why of Object.values(NOT_COUNTED)) expect(why.length).toBeGreaterThan(40);
  });
});

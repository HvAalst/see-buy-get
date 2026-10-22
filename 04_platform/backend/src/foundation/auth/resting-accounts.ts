import { Injectable } from '@nestjs/common';

/**
 * AN ACCOUNT AT REST — muted by its own owner (the user, 2026-10-22: "an account can be muted by the user"; it rests,
 * and can still read).
 *
 * Nothing new reaches a resting account: no notification on its phone and no email, beyond sign-in codes and what
 * keeps it safe; no new parcel names its shop, no load is offered to its driver, no new work to its fleet, no new
 * order to its store. What it already holds goes on, as a hold never stops the finishing of old work.
 *
 * WHO ASKS, AND WHO ANSWERS. The people who send, find and offer — notifications, mail, the shop finder, the
 * matcher — sit in many services; the one that knows who muted what is the person spine (PersonService), which also
 * knows every role a person owns. This is where the two meet without either importing the other: the spine answers
 * by DID (the person's own, or any shop, driver, fleet or store they own), the account book answers by email
 * address; everybody else only asks. With nobody registered, nothing is resting — the safe way round, since a
 * mistaken "resting" would silence somebody's safety notices or hide a working shop.
 */
@Injectable()
export class RestingAccounts {
  private readonly byDid: Array<(did: string) => boolean> = [];
  private readonly byAddress: Array<(address: string) => boolean> = [];

  /** Whoever keeps the mute registers how to tell, by DID. */
  answerForDid(test: (did: string) => boolean): void {
    this.byDid.push(test);
  }

  /** …and by email address: a person's recovery email, or the email an account signs in with. */
  answerForAddress(test: (address: string) => boolean): void {
    this.byAddress.push(test);
  }

  /** Is the owner of this DID — a person, or a shop, driver, fleet or store a person owns — resting? */
  isResting(did: string | undefined | null): boolean {
    if (!did) return false;
    return this.byDid.some((test) => test(did));
  }

  /** Does this address belong to an account at rest? */
  isRestingAddress(address: string | undefined | null): boolean {
    const a = (address ?? '').trim().toLowerCase();
    if (!a.includes('@')) return false;
    return this.byAddress.some((test) => test(a));
  }
}

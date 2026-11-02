import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersonService } from './person.service';
import { ConversationService } from './conversation.service';
import { carKeyFromHeader, carKeyHashOf, isFcmToken, newCarKey, type DeviceCarKey } from './car-keys';
import { asName, carLangOf, carLineOf, carWordsFor } from './car-words';
import type { CarChatRead, CarChatView, CarHere, CarReplySent, CarTokenRegistered, CarTurnedOn } from './car.types';

/** The newest unread messages one answer carries: what a car's notification shows; the rest are counted. */
export const CAR_LINES = 10;

/** Who a car key speaks for, once its door has checked it. */
export interface CarCaller {
  personDid: string;
  driverDid: string;
  keyHash: string;
  lang: string;
}

/** Said at a car door for a key that opens nothing: never which of the reasons it was. */
const NOT_A_CAR_KEY = 'That car key is not one of ours, or it was turned off. Turn “Messages in the car” on again in the SeeBuyGet Driver app.';
const CAR_ONLY = 'This door takes the car key of the SeeBuyGet Driver app on this phone (Authorization: Car <key>), and nothing else.';

/**
 * MESSAGES IN THE CAR (05_engineering/android-auto-messages.md; the owner, 2026-11-02: "we start with 2" — the driver's
 * messages read aloud in the car and answered by voice; "just to keep drivers' safety in mind, we must reduce the
 * tapping").
 *
 * TURNING IT ON is Settings', in the Driver app, signed in as the driver, on a phone the driver's PIN already works on —
 * asked first, before the PIN is looked at — with the PIN again, through the door's own check and counter: a phone left
 * signed in is not proof of who holds it. A CAR KEY is made, bound to the person, to the driver record they were signed
 * in as and to that phone's record, and handed to the page once; the page hands it to the Play app's native part.
 *
 * THE CAR'S DOORS (car.controller.ts) take that key and nothing else, and it opens nothing else. With it the native part
 * does exactly what the car does: tells us where Firebase reaches the phone, reads one chat's unread messages, sends a
 * spoken reply as text through the chat's own send path (so every refusal and limit of a typed message applies, and the
 * message says "Sent from the car"), and marks a chat read. Never an offer, a price, a settlement: the car has no
 * buttons for a decision, and a decision does not belong at the wheel.
 */
@Injectable()
export class CarMessagesService {
  constructor(
    private readonly persons: PersonService,
    private readonly conversations: ConversationService,
  ) {}

  /* ------------------------------------------------------------------------------------- Settings -- */

  /**
   * Is it on, on this phone? Read on the device's own record, among the keys this browser holds. The app's language is
   * kept with the key as it is read here: a quick reply is read aloud in the language the driver has the app in now.
   */
  here(personDid: string, keys: string[] | undefined, lang?: string): CarHere {
    const { which, car } = this.persons.carHere(personDid, keys);
    if (car && lang && carLangOf(lang) !== car.lang) this.persons.updateCarKey(car.keyHash, (c) => ({ ...c, lang: carLangOf(lang) }));
    return viewOf(which, car);
  }

  /**
   * TURN IT ON, on this phone. Refused — before the PIN is looked at — where none of the browser's keys is a device of this
   * person's: the key lives on a device the PIN works on. Then the PIN, counted as at the door. A key this phone had is
   * replaced, and opens nothing from now on.
   */
  turnOn(personDid: string, driverDid: string, keys: string[] | undefined, pin: string, lang?: string, now: number = Date.now()): CarTurnedOn {
    const { which, key } = this.persons.carHere(personDid, keys);
    if (!key) throw new GlosError('DEVICE_NOT_KNOWN', 'Your PIN does not work on this phone yet, so messages cannot be read in the car from it. Sign in here with your PIN first.');
    this.persons.confirmPin(personDid, pin);
    const secret = newCarKey();
    const car: DeviceCarKey = { keyHash: carKeyHashOf(secret), driverDid, addedAt: new Date(now).toISOString(), lang: carLangOf(lang) };
    if (!this.persons.setCarKey(personDid, key, car)) throw new GlosError('DEVICE_NOT_KNOWN', 'This phone was forgotten meanwhile. Sign in here with your PIN first.');
    return { ...viewOf(which, car), key: secret };
  }

  /** TURN IT OFF here. No PIN: it takes something away from whoever holds the phone and gives nothing. The key opens nothing from now on. */
  turnOff(personDid: string, keys: string[] | undefined): CarHere {
    const { which, key } = this.persons.carHere(personDid, keys);
    this.persons.dropCarKey(personDid, key);
    return { on: false, which };
  }

  /* --------------------------------------------------------------------------- the car's own doors -- */

  /**
   * WHO A CAR DOOR IS SPEAKING TO. Only an `Authorization: Car <key>` header; then a key of ours, on a device still known,
   * for a person who still holds the driver record it was made for. One answer for every way a key opens nothing.
   */
  resolve(header: string | string[] | undefined, now: number = Date.now()): CarCaller {
    const key = carKeyFromHeader(header);
    if (!key) throw new GlosError('UNAUTHORIZED', CAR_ONLY);
    const keyHash = carKeyHashOf(key);
    const found = this.persons.findCarKey(keyHash, now);
    const person = found ? this.persons.findByDid(found.personDid) : undefined;
    const holds = Boolean(found && person && !person.closedAt && person.roles.some((r) => r.role === 'driver' && r.entityDid === found.car.driverDid && r.status === 'active'));
    if (!found || !holds) throw new GlosError('UNAUTHORIZED', NOT_A_CAR_KEY);
    // The day it was last used, once a day at most. It does not keep the phone known: only the PIN, or a code, does.
    const today = new Date(now).toISOString();
    if (found.car.usedAt?.slice(0, 10) !== today.slice(0, 10)) this.persons.updateCarKey(keyHash, (c) => ({ ...c, usedAt: today }), now);
    return { personDid: found.personDid, driverDid: found.car.driverDid, keyHash, lang: found.car.lang };
  }

  /** Where Firebase reaches this phone — a new token replaces the one before (Firebase rotates them). */
  registerToken(caller: CarCaller, token: string, now: number = Date.now()): CarTokenRegistered {
    if (!isFcmToken(token)) throw new GlosError('INVALID_INPUT', 'That is not a Firebase token', { field: 'token' });
    if (!this.persons.updateCarKey(caller.keyHash, (c) => ({ ...c, fcmToken: token, tokenAt: new Date(now).toISOString() }), now)) throw new GlosError('UNAUTHORIZED', NOT_A_CAR_KEY);
    return { registered: true };
  }

  /**
   * ONE CHAT'S UNREAD MESSAGES, as the car reads them: titled by the load, each from the other side as the chat names them,
   * in the driver's language. Only a chat of this driver's — any other is "not found", as everywhere.
   */
  unread(caller: CarCaller, conversationId: string): CarChatView {
    const { thread, items } = this.conversations.unreadFor(conversationId, caller.driverDid);
    const words = carWordsFor(caller.lang);
    const from = thread.counterpartName ?? asName(words.poster);
    const label = thread.freightLabel ?? '';
    return {
      conversationId: thread.conversationId,
      title: label ? `${thread.freightCode} · ${label}` : thread.freightCode,
      code: thread.freightCode,
      label,
      from,
      lang: caller.lang,
      unread: items.length,
      lastSeq: thread.lastSeq,
      canReply: !thread.blocked,
      ...(thread.blocked ? { closed: thread.blockedByMe ? words.closedByMe : words.closed } : {}),
      messages: items.slice(-CAR_LINES).map((m) => ({ seq: m.seq, from, text: carLineOf(m, words), kind: m.kind, at: m.at })),
    };
  }

  /** A SPOKEN REPLY, sent as text — through the chat's own send path, marked as from the car. Refused as a typed one would be. */
  reply(caller: CarCaller, conversationId: string, text: string, now: number = Date.now()): CarReplySent {
    const sent = this.conversations.send(conversationId, caller.driverDid, { body: text }, now, 'car');
    return { sent: true, seq: sent.seq, at: sent.at, via: 'car' };
  }

  /** "Mark as read": up to the newest message the car showed, as opening the chat would. */
  markRead(caller: CarCaller, conversationId: string, seq: number): CarChatRead {
    const view = this.conversations.markRead(conversationId, caller.driverDid, seq);
    return { read: true, unread: view.unread };
  }
}

function viewOf(which: number, car: DeviceCarKey | undefined): CarHere {
  if (!car) return { on: false, which };
  return { on: true, which, phone: car.fcmToken ? 'on' : 'waiting', addedAt: car.addedAt, ...(car.tokenAt && car.fcmToken ? { tokenAt: car.tokenAt } : {}) };
}

/**
 * MESSAGES IN THE CAR — what the car's doors answer, and what Settings is told (05_engineering/android-auto-messages.md,
 * section 3, "the contract"; the owner, 2026-11-02: "we start with 2"). Classes, so the contract says their shape to the
 * Android app's native part.
 */

/** Settings › "Messages in the car", on this phone: on or off, and whether the phone has answered yet. */
export class CarHere {
  /** A car key lives on this phone's record. */
  on!: boolean;
  /** Which of the browser's device keys is this person's; -1 when none is (the PIN does not work here, so nothing can be turned on). */
  which!: number;
  /** `waiting` — made, and the phone's native part has not told us where to wake it yet; `on` — it has. Absent when off. */
  phone?: 'waiting' | 'on';
  /** When it was turned on. */
  addedAt?: string;
  /** When the phone last told us where to wake it. */
  tokenAt?: string;
}

/** Turned on: what Settings is told, and the key — ONCE, in this answer only, for the page to hand to the native part. */
export class CarTurnedOn extends CarHere {
  /** `car_` and 64 hex characters. Kept on the server only as a hash: this is the one time it is seen. */
  key!: string;
}

/** The phone told us where to wake it. */
export class CarTokenRegistered {
  registered!: boolean;
}

/** One unread message, as the car reads it aloud. */
export class CarChatLine {
  /** Its place in the chat: what "Mark as read" is given back. */
  seq!: number;
  /** Who it is from, as the chat names them to the driver: "The poster". */
  from!: string;
  /** What the car reads aloud — the words; a quick reply in the driver's language; or, for a voice message or a photo, what it is and to open the app when they stop. */
  text!: string;
  /** What kind of message it was: `text` and `quick` are words; anything else is something to open the app for. */
  kind!: string;
  /** When it arrived. */
  at!: string;
}

/** One chat's unread messages, for the notification the car reads. */
export class CarChatView {
  conversationId!: string;
  /** What the conversation is titled by: the load's code and what it is — "FRT-7781 · Roses · Nakuru → Nairobi". */
  title!: string;
  /** The load's code. */
  code!: string;
  /** What the load is, from where to where. */
  label!: string;
  /** The other side, as the chat names them. */
  from!: string;
  /** The language the words are in: the Driver app's. */
  lang!: string;
  /** How many are unread in all; `messages` carries the newest of them. */
  unread!: number;
  /** The chat's last sequence number. */
  lastSeq!: number;
  /** A reply can be sent: false when the conversation is closed. */
  canReply!: boolean;
  /** Why not, in the driver's language — what the car says instead of offering Reply. */
  closed?: string;
  messages!: CarChatLine[];
}

/** A reply from the car, in the chat — marked so both sides see "Sent from the car". */
export class CarReplySent {
  sent!: boolean;
  seq!: number;
  at!: string;
  via!: 'car';
}

/** The chat marked read, as opening it would. */
export class CarChatRead {
  read!: boolean;
  /** Still unread after it: anything that arrived after the message the car was showing. */
  unread!: number;
}

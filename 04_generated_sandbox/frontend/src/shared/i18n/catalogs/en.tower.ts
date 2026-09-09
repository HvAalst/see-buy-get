/**
 * The OPERATOR CONSOLE's strings — the `tower.*` namespace.
 *
 * Written for somebody who works here all day and knows the domain, which is a different register from
 * the seven field apps: it may say "constraint" and "corridor", and it does not have to be readable at
 * arm's length by somebody who has never seen the screen before. What it must still do is say what is
 * TRUE — most of the sentences in this file exist to stop a screen implying something the data does not
 * support.
 */
export const enTower = {
  'tower.appTitle': 'SeeBuyGet Operator',
  'tower.rail.heading': 'The network',
  'tower.nav.hazards': 'Road hazards',

  // Who is at the keyboard. The credential proves somebody has the operator key; the NAME is what goes
  // into the record beside every decision, and the sign-in screen says plainly that it is not verified.
  'tower.signIn.title': 'Operator sign-in',
  'tower.signIn.lede': 'This console acts with full operator rights on the live network.',
  'tower.signIn.name': 'Your name',
  'tower.signIn.namePlaceholder': 'e.g. A. Mwangi',
  'tower.signIn.nameHint': 'Kept with every decision you make here. It is not verified — the key below is what proves you may be here, and your name is what tells the next person who made the call.',
  'tower.signIn.key': 'Operator key',
  'tower.signIn.keyHint': 'The shared operator credential. It is never stored on this machine beyond this browser tab: close the tab and this console is signed out.',
  'tower.signIn.keySandbox': 'On a sandbox server with no operator key configured, any value is accepted.',
  'tower.signIn.cta': 'Sign in',
  'tower.signIn.needName': 'Say who you are — every decision here is recorded against a name.',
  'tower.signIn.needKey': 'The operator key is required.',
  'tower.signIn.rejected': 'That key was not accepted.',
  'tower.signOut': 'Sign out',
  'tower.signedInAs': 'Signed in as',

  // The masthead's live line: what is waiting, never who is looking.
  'tower.work.unknown': 'Loading the queue…',
  'tower.work.clear': 'Nothing disputed',
  'tower.work.waiting': '{n} disputed',

  'tower.outdated.title': 'This console is out of date',
  'tower.outdated.body': 'The server is running a newer version. Reload the page to pick it up.',
  'tower.outdated.cta': 'Reload',

  // ---- the disputed-hazard queue -------------------------------------------------------------
  'tower.hazards.title': 'Disputed road hazards',
  'tower.hazards.lede': 'Drivers report what is on the road, and a driver saying a hazard is gone does not remove it. Clearing one is the only way it stops warning, and only from here.',
  'tower.hazards.caveatLead': 'Everything in this list is still warning every driver',
  'tower.hazards.caveat': '— at full weight, and still blocking the same loads. A dispute changes nothing on its own, and that is deliberate: being wrong about a bridge that is not there costs a detour, being wrong about one that is still there kills somebody.',
  'tower.hazards.refresh': 'Refresh',
  'tower.hazards.updatedAt': 'Read at {time}',
  'tower.hazards.count': '{n} waiting',
  'tower.hazards.loading': 'Reading the queue…',
  'tower.hazards.emptyTitle': 'Nothing is disputed',
  'tower.hazards.emptyBody': 'No driver is currently saying a reported hazard has gone. That is not the same as the map being up to date — it only means nobody has said otherwise.',
  'tower.hazards.failedTitle': 'Could not read the queue',

  'tower.hazards.col.hazard': 'Hazard',
  'tower.hazards.col.measure': 'Posted',
  'tower.hazards.col.where': 'Where',
  'tower.hazards.col.evidence': 'Said to be there / gone',
  'tower.hazards.col.waiting': 'Waiting',

  'tower.hazards.blocks': 'Blocks loads',
  'tower.hazards.advisory': 'Costs time',
  'tower.hazards.evidence': '{confirmations} saw it · {refutations} say it is gone',
  'tower.hazards.reportedAt': 'Reported {date}',
  'tower.hazards.noteLabel': 'Driver notes',
  'tower.hazards.openMap': 'Open in a map',
  'tower.hazards.longWait': 'Waiting a while',

  'tower.hazards.clear': 'Clear this',
  'tower.hazards.clearTitle': 'Take this off every driver’s map',
  'tower.hazards.clearBody': 'It stops warning immediately, everywhere. The record is kept with your name and your reason, so the decision can be reviewed — and a driver who meets it again can report it afresh.',
  'tower.hazards.reason': 'Why is it being cleared?',
  'tower.hazards.reasonPlaceholder': 'e.g. Council confirmed the bridge was rebuilt to 6.0 m on 4 September',
  'tower.hazards.reasonHint': 'Kept forever, and read by whoever asks later why this hazard vanished.',
  'tower.hazards.reasonNeeded': 'A reason is required.',
  'tower.hazards.confirm': 'Clear it',
  'tower.hazards.cancel': 'Keep it',
  'tower.hazards.cleared': 'Cleared {hazard} — the reason is on the record.',
  'tower.hazards.clearFailed': 'Could not clear that',

  'tower.wait.now': 'Just now',
  'tower.wait.hours': '{n} h',
  'tower.wait.days': '{n} days',
  'tower.unit.metres': '{n} m',
  'tower.unit.tonnes': '{n} t',

  'tower.kind.LOW_BRIDGE': 'Low bridge',
  'tower.kind.HEIGHT_BARRIER': 'Height barrier',
  'tower.kind.WEIGHT_LIMIT': 'Weight limit',
  'tower.kind.NO_HAZMAT': 'No hazardous cargo',
  'tower.kind.WASHOUT': 'Washed-out road',
  'tower.kind.WEIGHBRIDGE': 'Weighbridge',
  'tower.kind.FERRY': 'Ferry',
  'tower.kind.CHECKPOINT': 'Checkpoint',
};

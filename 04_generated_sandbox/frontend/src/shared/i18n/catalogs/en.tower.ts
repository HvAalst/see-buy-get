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

  // ---- what a sister charges ------------------------------------------------------------------
  // The register here is a business one on purpose: the person reading it is deciding what to charge, and
  // the hints exist because two of these knobs behave in ways nobody guesses (the three layers ADD, and an
  // empty box inherits rather than meaning zero).
  'tower.nav.rates': 'Rates & tax',
  'tower.rates.title': 'What each sister charges',
  'tower.rates.lede': 'Every sister prices for itself, per kind of work. The three layers are added, never compounded, and each one can be set for one lane or for everything.',
  'tower.rates.caveatLead': 'The split is ours alone.',
  'tower.rates.caveat': 'A buyer sees a price; a merchant sees one platform fee line; nobody outside this screen sees it broken into three. It is separated so somebody can answer whether we are earning because the market is good or because we are carrying risk nobody is paying for — a question one blended percentage cannot be asked.',
  'tower.rates.pickSister': 'Which company',
  'tower.rates.group': 'The mother company',
  'tower.rates.groupLead': '{name} charges nothing.',
  'tower.rates.groupBody': 'It is the merchant of record nowhere and is never a party to a customer transaction, so it has no rates to set. It earns its licence fee from the sisters instead. Shown rather than hidden, so looking for its rates gives you an answer.',
  'tower.rates.whatItCharges': 'What {name} charges',
  'tower.rates.registeredAs': 'Collects tax as {registration}',
  'tower.rates.notRegistered': 'Not registered to collect tax',
  'tower.rates.loading': 'Reading the rates…',
  'tower.rates.failedTitle': 'Could not read the rates',
  'tower.rates.edit': 'Set',
  'tower.rates.save': 'Save',
  'tower.rates.saved': 'Saved — {lane}. Nothing already sold is repriced.',
  'tower.rates.refused': 'Not saved',

  'tower.rates.col.lane': 'Kind of work',
  'tower.rates.col.total': 'Total',
  'tower.rates.costOfRisk': 'Cost of risk',
  'tower.rates.profitOnRisk': 'Profit on risk',
  'tower.rates.margin': 'Margin',

  'tower.rates.stackTitle': 'The three layers',
  'tower.rates.stackHint': 'They ADD UP — they do not compound. Cost of risk is what carrying the exposure costs us; profit on risk is what we earn for choosing to carry it; margin is the general company layer.',
  'tower.rates.emptyInherits': 'An empty box INHERITS — a lane falls back to this company’s own rate, and that falls back to the network default. The grey number in an empty box is what it would inherit. Clearing a box is how you give a number back.',
  'tower.rates.notANumber': '{field} is not a number.',
  'tower.rates.outOfBounds': '{field} has to be between {min} and {max}.',
  'tower.rates.sumOverCeiling': 'Those come to {sum}, over the {max} ceiling. They ADD UP — they do not compound.',

  'tower.tax.title': 'Tax',
  'tower.tax.hint': 'Money this company never owns for a moment: it is held, and it is handed over. Charged on the whole price including our own fee, because what is taxed is the sale and not the profit.',
  'tower.tax.rate': 'Tax rate',
  'tower.tax.label': 'What it is called',
  'tower.tax.registration': 'Registration number',
  'tower.tax.registrationHint': 'This company’s number, not this lane’s. Every tax save carries it, so a rate and the authority to charge it stay one act.',
  'tower.tax.needsRegistration': 'A rate above zero needs a registration number — charging tax you are not registered to collect is money taken in the name of an authority that has never heard of you.',

  'tower.cover.title': 'Cover',
  'tower.cover.hint': 'What is carried for free on everything, and what it costs to declare more. Charged on the value of somebody’s goods, which is a different base from the layers above — and it accrues to the claims provision rather than to revenue.',
  'tower.cover.freeLimit': 'Free cover',
  'tower.cover.freeLimitIn': 'Free cover ({currency})',
  'tower.cover.premium': 'Premium',
  'tower.cover.negative': 'A free cover limit cannot be negative.',

  'tower.lane.default': 'Everything (default)',
  'tower.lane.pudo': 'Parcels · shop to shop',
  'tower.lane.mdp': 'Parcels · through a hub',
  'tower.lane.dedicated': 'Dedicated freight',

  'tower.origin.here': 'Set here',
  'tower.origin.lane': 'From this lane',
  'tower.origin.sister': 'From the company default',
  'tower.origin.legacyFee': 'From the old single fee',
  'tower.origin.network': 'Network default',
  'tower.origin.none': 'Nothing set',

  'tower.impact.title': 'What each rate actually did',
  'tower.impact.hint': 'Per spell, in time order — a rate raised and lowered again is two periods to compare',
  'tower.impact.emptyTitle': 'Nothing priced yet',
  'tower.impact.emptyBody': 'No shipment has been sold under a rate here, so there is nothing to compare. This fills itself in as work goes through.',
  'tower.impact.col.rate': 'Rate',
  'tower.impact.col.period': 'Period',
  'tower.impact.col.shipments': 'Shipments',
  'tower.impact.col.gross': 'Charged',
  'tower.impact.col.margin': 'Our cut',
  'tower.impact.col.avg': 'Per shipment',
  'tower.impact.unpriced': '{n} more carried no margin at all — walk-up cash, which is priced by a different product and would only dilute the rates it was never sold at.',

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

/**
 * 2026-11-27 — the codes a refusal or a notice says back (a payout's or a payment's status, a load's or a parcel's, a role): in
 * English each is the code itself, as it was said before; the other languages say it in words (../<lang>/codes.ts). Said
 * through codeSaid (notice-words/codes.ts), which keeps a code that has no phrase as it is.
 */
export const EN_CODES = {
  'code.payout.requested': 'requested',
  'code.payout.submitted': 'submitted',
  'code.payout.settled': 'settled',
  'code.payout.failed': 'failed',
  'code.payout.reversed': 'reversed',

  'code.funding.awaiting': 'awaiting',
  'code.funding.confirmed': 'confirmed',
  'code.funding.failed': 'failed',
  'code.funding.expired': 'expired',
  'code.funding.reversed': 'reversed',
  'code.fundingOutcome.credited': 'credited',
  'code.fundingOutcome.refused': 'refused',

  'code.freight.scheduled': 'scheduled',
  'code.freight.available': 'available',
  'code.freight.ordered': 'ordered',
  'code.freight.claimed': 'claimed',
  'code.freight.in_transit': 'in_transit',
  'code.freight.delivered': 'delivered',
  'code.freight.refused': 'refused',
  'code.freight.cancelled': 'cancelled',

  'code.parcel.Created': 'Created',
  'code.parcel.At_PUDO': 'At_PUDO',
  'code.parcel.On_Bus': 'On_Bus',
  'code.parcel.At_MDP': 'At_MDP',
  'code.parcel.Ready_For_Pickup': 'Ready_For_Pickup',
  'code.parcel.Unclaimed': 'Unclaimed',
  'code.parcel.Delivered': 'Delivered',
  'code.parcel.Disputed': 'Disputed',
  'code.parcel.Voided': 'Voided',
  'code.parcel.Returned': 'Returned',
  'code.parcel.Lost': 'Lost',

  'code.role.consumer': 'consumer',
  'code.role.driver': 'driver',
  'code.role.agent': 'agent',
  'code.role.mdp': 'mdp',
  'code.role.fleet_manager': 'fleet_manager',
  'code.role.vendor': 'vendor',
} as const;

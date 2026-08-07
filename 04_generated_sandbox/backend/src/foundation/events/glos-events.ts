// Canonical GLOS event catalog — the cross-module cascade spine (T-002).
// These string constants are the contract between modules; payload shapes are added
// alongside the feature that emits them. Mirrors the hook maps in 02_epic_domains/.

export const GlosEvent = {
  Did: {
    Generated: 'did.generated',
  },
  Identity: {
    Verified: 'identity.verified',
    TierUpgraded: 'identity.tier_upgraded',
    AccountSuspended: 'identity.account_suspended',
    VcIssued: 'identity.vc_issued',
    VcRevoked: 'identity.vc_revoked',
    ConsentReceiptLogged: 'identity.consent_logged',
  },
  Wallet: {
    Provisioned: 'wallet.provisioned',
    PayoutCompleted: 'wallet.payout_completed',
  },
  Shipment: {
    Created: 'shipment.created',
    Enriched: 'shipment.enriched',
    Amended: 'shipment.amended',
    LegDecomposed: 'shipment.leg_decomposed',
    JobRequirementVectorReady: 'shipment.jrv_ready',
    LabelGenerated: 'shipment.label_generated',
  },
  Match: {
    Confirmed: 'match.confirmed',
    OfferSent: 'match.offer_sent',
    OfferAccepted: 'match.offer_accepted',
    FallbackCascaded: 'match.fallback_cascaded',
  },
  Tracking: {
    PickupOk: 'tracking.pickup_ok',
    HandoverOk: 'tracking.handover_ok',
    Delivered: 'tracking.delivered',
    ExceptionRaised: 'tracking.exception_raised',
  },
  Settlement: {
    EscrowCreated: 'settlement.escrow_created',
    EscrowFunded: 'settlement.escrow_funded',
    MilestoneReleased: 'settlement.milestone_released',
    DisputeResolved: 'settlement.dispute_resolved',
  },
  Reputation: {
    RatingSubmitted: 'reputation.rating_submitted',
    ScoreUpdated: 'reputation.score_updated',
    BadgeIssued: 'reputation.badge_issued',
  },
  Pudo: {
    AgentActivated: 'pudo.agent_activated',
    AgentLocked: 'pudo.agent_locked',
    WalletToppedUp: 'pudo.wallet_topped_up',
    InboundCreated: 'pudo.inbound_created',
    ParcelPaid: 'pudo.parcel_paid', // vendor prepaid the full cost → label unblocked + drop-off PUDO notified
    ParcelMinted: 'pudo.parcel_minted', // PG1 — a person pre-minted a peer send in-app (cash at drop-off) → twin + journey born now
    ParcelAccepted: 'pudo.parcel_accepted',
    ParcelHandedToBus: 'pudo.parcel_handed_to_bus',
    ParcelShortShipped: 'pudo.parcel_short_shipped', // a waiting parcel knowingly left behind at handover (short-ship)
    ParcelReadyForPickup: 'pudo.parcel_ready_for_pickup',
    ParcelDelivered: 'pudo.parcel_delivered',
    ParcelDisputed: 'pudo.parcel_disputed',
    ParcelVoided: 'pudo.parcel_voided',
    BagLoaded: 'pudo.bag_loaded', // a tote (with its parcels) scanned onto a bus
    BagArrivedAtMdp: 'pudo.bag_arrived_at_mdp', // bus drops a bag; MDP empties it
    BagDelivered: 'pudo.bag_delivered', // a tote unloaded at the destination PUDO (parcels shelved/arrived)
    ParcelSorted: 'pudo.parcel_sorted', // a parcel routed into its next-hop bag at an MDP
    DriverActivated: 'pudo.driver_activated', // driver onboarded → badge issued
    DriverSuspended: 'pudo.driver_suspended',
    DriverCoupled: 'pudo.driver_coupled', // driver ↔ vehicle coupling formed
    DriverUncoupled: 'pudo.driver_uncoupled',
    ToteAvailable: 'pudo.tote_available', // a full/aged tote published to the claim marketplace
    LoadClaimed: 'pudo.load_claimed', // a driver claimed a tote/freight along their route
    FreightTempBreach: 'pudo.freight_temp_breach', // S33b — a cold-chain freight logged an out-of-band temperature
    FleetManagerActivated: 'pudo.fleet_manager_activated', // operator vetted + bonded → may build a fleet
  },
  Orchestration: {
    SignalReceived: 'orchestration.signal_received',
    DisruptionDetected: 'orchestration.disruption_detected',
    ImpactAssessed: 'orchestration.impact_assessed',
    RecommendationGenerated: 'orchestration.recommendation_generated',
    ApprovalRequested: 'orchestration.approval_requested',
    AutonomousActionExecuted: 'orchestration.action_executed',
    ActionRolledBack: 'orchestration.action_rolled_back',
    AutoResponseCompleted: 'orchestration.auto_response_completed',
  },
} as const;

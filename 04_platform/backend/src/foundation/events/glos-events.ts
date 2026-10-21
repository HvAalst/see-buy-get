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
    /**
     * A shop finished the registration form. It is in DRAFT and has sent nothing yet.
     *
     * Published so the applicant can be told what is still needed AT THAT MOMENT, which is the only
     * moment they are certain to be holding the phone. The sweep that follows catches everyone who was
     * already stuck when this shipped, and everyone who half-finishes later — but a sweep alone would
     * mean a shop finishes a form, is told nothing, and hears from us hours later.
     */
    AgentRegistered: 'pudo.agent_registered',
    /** A KYC decision went against the applicant. Carries the reason, because they are shown it. */
    AgentKycRejected: 'pudo.agent_kyc_rejected',
    /** The same, for a heavy-registry driver: they are shown the reason and can send fresh papers. */
    DriverKycRejected: 'pudo.driver_kyc_rejected',
    /** A member of staff decided on a hub's papers: approved, or sent back with the reason it is shown. Told to the hub. */
    HubPapersDecided: 'pudo.hub_papers_decided',
    // A driver in no fleet asked to ride for themselves on something heavy, and staff decided: told to the driver.
    DriverRideAloneDecided: 'pudo.driver_ride_alone_decided',
    // Round 39 — a light courier's ID photo seen by staff, or sent back with the reason: told to the rider.
    DriverIdPhotoDecided: 'pudo.driver_id_photo_decided',
    // Round 39 — a corridor or hub rated for a threat (the risk register): told to whoever works under it.
    RiskRated: 'pudo.risk_rated',
    // A fleet office put a driver on a day's roster, or took them off a day they had been told they drive.
    DriverRostered: 'pudo.driver_rostered',
    // A defect reported on a vehicle (its office is told), and the office's word on it (the driver who reported it is told).
    VehicleDefectReported: 'pudo.vehicle_defect_reported',
    VehicleDefectDecided: 'pudo.vehicle_defect_decided',
    // A fleet's vehicle comes due for a service, or is overdue: its office is told, once each.
    VehicleServiceDue: 'pudo.vehicle_service_due',
    // A vehicle broke down on the road (its office and the shippers of what is aboard are told), and how it ended.
    VehicleBrokeDown: 'pudo.vehicle_broke_down',
    VehicleGoneSilent: 'pudo.vehicle_gone_silent', // round 17 — the phone on a shift said nothing longer than its fleet allows, last heard away from any stop; its fleet's managers are told
    VehicleStandingStill: 'pudo.vehicle_standing_still', // round 16 — a vehicle on a shift stood still longer than its fleet allows, away from any stop; its fleet's managers are told
    VehicleBreakdownResolved: 'pudo.vehicle_breakdown_resolved',
    // A broken-down vehicle's loads were taken over by another of the fleet's vehicles.
    VehicleLoadsHandedOver: 'pudo.vehicle_loads_handed_over',
    // The receiver added a note to a damage claim report, after handover: the sender is told.
    DamageReportNoted: 'pudo.damage_report_noted',
    /**
     * A renewed licence a courier sent was checked: recorded (they may start shifts again) or refused,
     * with the reason. Published only when somebody was waiting on the answer.
     */
    DriverLicenceChecked: 'pudo.driver_licence_checked',
    /**
     * A driver sent a renewed licence to be read. Carries the fleet they drive for, when there is one: its
     * office is who reads the card, and an office is not watching a queue the way network staff are.
     */
    DriverLicenceSent: 'pudo.driver_licence_sent',
    /**
     * The same, for a fleet OPERATOR's own licence or cover: a document the fleet sent was recorded or turned
     * down. Published only when the fleet was waiting on the answer — a date staff typed on their own is not
     * news to anybody.
     */
    FleetPaperChecked: 'pudo.fleet_paper_checked',
    WalletToppedUp: 'pudo.wallet_topped_up',
    InboundCreated: 'pudo.inbound_created',
    ParcelPaid: 'pudo.parcel_paid', // vendor prepaid the full cost → label unblocked + drop-off PUDO notified
    ParcelMinted: 'pudo.parcel_minted', // PG1 — a person pre-minted a peer send in-app (cash at drop-off) → twin + journey born now
    ParcelAccepted: 'pudo.parcel_accepted',
    ParcelHandedToBus: 'pudo.parcel_handed_to_bus',
    ParcelShortShipped: 'pudo.parcel_short_shipped', // a waiting parcel knowingly left behind at handover (short-ship)
    ParcelReadyForPickup: 'pudo.parcel_ready_for_pickup',
    // The parcel's release secret was burned by wrong guesses and an operator rotated it. Deliberately
    // NOT a re-published ParcelReadyForPickup: the parcel did not arrive twice, and the twin's journey
    // must not grow a second out-for-delivery scan just because a code changed.
    ParcelReleaseCodeReissued: 'pudo.parcel_release_code_reissued',
    ParcelDelivered: 'pudo.parcel_delivered',
    ParcelDisputed: 'pudo.parcel_disputed',
    /** A dispute on a parcel was decided — upheld, in part, or rejected — with the reason the people concerned are shown. */
    ParcelDisputeDecided: 'pudo.parcel_dispute_decided',
    ParcelVoided: 'pudo.parcel_voided',
    /** Declared lost by staff after a search; the sender is told, and holds a damage claim report. */
    ParcelLost: 'pudo.parcel_lost',
    /** A lost parcel turned up, and carries on from where it was lost. */
    ParcelFound: 'pudo.parcel_found',
    BagLoaded: 'pudo.bag_loaded', // a tote (with its parcels) scanned onto a bus
    BagArrivedAtMdp: 'pudo.bag_arrived_at_mdp', // bus drops a bag; MDP empties it
    BagDelivered: 'pudo.bag_delivered', // a tote unloaded at the destination PUDO (parcels shelved/arrived)
    ParcelSorted: 'pudo.parcel_sorted', // a parcel routed into its next-hop bag at an MDP
    DriverActivated: 'pudo.driver_activated', // driver onboarded → badge issued
    DriverSuspended: 'pudo.driver_suspended',
    DriverCoupled: 'pudo.driver_coupled', // driver ↔ vehicle coupling formed
    DriverUncoupled: 'pudo.driver_uncoupled',
    DriverMoved: 'pudo.driver_moved', // a live GPS fix — the trigger for "there is a load on your road NOW"
    ToteAvailable: 'pudo.tote_available', // a full/aged/SEALED tote published to the claim marketplace
    ToteNeedsSeal: 'pudo.tote_needs_seal', // a SHOP bag is full/aged but still open — ask the shop to close it
    FreightPosted: 'pudo.freight_posted',
    FreightAssigned: 'pudo.freight_assigned',
    FreightInstructed: 'pudo.freight_instructed',
    FreightHandedBack: 'pudo.freight_handed_back', // FP8 — a driver gave a claimed load back before pickup; the sender (and the office that put it on them) is told // FP7 — the sender's instructions changed on a load a driver holds; the driver is told // FP5 — the fleet office put a load on one of its drivers; the driver is told
    NoteFrozen: 'pudo.note_frozen', // a copy of a consignment note was frozen — the trigger for delivering the bundle to a party's own storage
    NoteExpiringSoon: 'pudo.note_expiring_soon', // a consignment note reaches the end of its retention window — the parties are told while they can still export it
    FreightPickedUp: 'pudo.freight_picked_up', // the carrier took the goods over — the consignment note's first original is frozen here
    FreightDelivered: 'pudo.freight_delivered', // FP2 — the consignment closes: the sender is sent its receipt // a dedicated-freight load registered → ping drivers near its pickup
    FreightCancelled: 'pudo.freight_cancelled', // FP3 — the sender (or the network) withdrew a load before it was taken over; a driver who had claimed it is told
    FreightDeliveryFailed: 'pudo.freight_delivery_failed', // FP3b — the driver was at the door and could not hand over; the load stays on the van, the sender is told
    FreightHeld: 'pudo.freight_held', // a load held by the police, customs or another authority, as its driver said; operations' case, the shipper and the fleet told
    FreightLetGo: 'pudo.freight_let_go', // …and let go, as its driver said
    FreightPassed: 'pudo.freight_passed', // round 14 — the driver said the load is at a border post, cleared it, or is at a hub; its shipper's and its fleet's systems are told
    UnitHeld: 'pudo.unit_held', // round 35 — a load or a parcel held under the tamper protocol: operations' case at once, the shipper's bell, the store's system
    UnitReleased: 'pudo.unit_released', // round 35 — operations released it, with a reason; the same people told
    FreightSealBroken: 'pudo.freight_seal_broken', // round 15 — a seal on a load found broken on the road; the shipper (bell + system) and the fleet's system told at once, the note frozen
    FreightClaimOpened: 'pudo.freight_claim_opened', // FP3b — the sender says the goods arrived damaged, short, or not at all
    FreightClaimDecided: 'pudo.freight_claim_decided', // FP3b — an operator decided it, with a reason the claimant is shown
    LoadClaimed: 'pudo.load_claimed', // a driver claimed a tote/freight along their route
    // F3/F4 — a fleet's own departure. Until these existed DepartureService published nothing at all, so a
    // run could be called off with five shippers aboard and not one of them could be told.
    DepartureBooked: 'pudo.departure_booked', // a shipper took space on a run; the fleet office is told
    OrderSplit: 'pudo.order_split', // an order is coming in several loads (or one again): its shipper is told
    OrderLeftOut: 'pudo.order_left_out', // a carrier's accepted plan leaves an order on no vehicle (or has it on one after all): its shipper is told
    OrderWindowPlanned: 'pudo.order_window_planned', // a carrier's accepted plan has an order outside the window asked for (or inside it again): its shipper is told
    OrderHandedOn: 'pudo.order_handed_on', // P4 — orders moved between a fleet and its partners; the other office is told
    OrderPlaced: 'pudo.order_placed', // an order came in under a fleet's contract — from its shipper, or a sheet the office uploaded
    OrderChanged: 'pudo.order_changed', // the office changed an order in a way nothing else says: pinned where it goes, took it back off the board
    DayPlanAccepted: 'pudo.day_plan_accepted', // a fleet office accepted its plan for a day
    DepartureBookingCancelled: 'pudo.departure_booking_cancelled', // a shipper gave the space back; it is for sale again
    DepartureDeparted: 'pudo.departure_departed', // the truck has gone — the last moment anything could change
    /** A different truck was put on a run before it left. Shippers see a vehicle's CLASS, never its plate, so they are told only when the class changed. */
    DepartureVehicleChanged: 'pudo.departure_vehicle_changed',
    /** A driver took a fleet's offer and now drives for it. Both fleets are told; the driver said yes. */
    DriverChangedFleet: 'pudo.driver_changed_fleet',
    /** A fleet offered a place to a driver already on the network — the driver, by name, is the only one who can answer. */
    FleetOfferMade: 'pudo.fleet_offer_made',
    /** The driver said no, or the fleet took its offer back. The other side is told. */
    FleetOfferClosed: 'pudo.fleet_offer_closed',
    /** A fleet took a driver off its fleet. The driver is told why; the fleet's other managers see who did it. */
    DriverLeftFleet: 'pudo.driver_left_fleet',
    /** The fleet office put a vehicle on a driver's list for today. It starts nothing — the driver does, with their PIN. */
    DriverVehicleSuggested: 'pudo.driver_vehicle_suggested',
    /** Five wrong PINs for one phone: the PIN is locked until the phone is verified by code, and its owner is told. */
    PersonPinLocked: 'pudo.person_pin_locked',
    /** A PIN was REPLACED by a code — forgotten, or locked. Its holder is told, because a code to a phone is something somebody else may have read. */
    PersonPinReplaced: 'pudo.person_pin_replaced',
    /** A phone or browser this person's PIN had never worked on was confirmed by a code. Their PIN works there now, and they are told. */
    PersonDeviceConfirmed: 'pudo.person_device_confirmed',
    DepartureDelivered: 'pudo.departure_delivered', // one booking reached its destination and was handed over
    DepartureCancelled: 'pudo.departure_cancelled', // the run is not happening, and everybody aboard has to be told
    DepartureClaimOpened: 'pudo.departure_claim_opened', // the shipper says something went wrong; the carrier is told, and nobody adjudicates
    DepartureClaimAnswered: 'pudo.departure_claim_answered', // the carrier's own words about their own liability, back to the shipper
    FreightTempBreach: 'pudo.freight_temp_breach', // S33b — a cold-chain freight logged an out-of-band temperature; round 25 — the shipper and the carrying fleet told (bell + system), the note frozen
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

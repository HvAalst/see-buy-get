import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FreightTrackView } from './dispatch.types';
import { GeoPoint } from './pudo.types';

/**
 * INBOUND SUPPLY, READING A (assessment.html D1–D14; the user, 2026-10-25: "Yes, A then B") — a business receiving
 * goods at its own sites. Its delivery places can receive: each gets a code the business gives its suppliers, who write
 * it as "deliver to" when they post a load. What is addressed there, the business sees coming in.
 *
 * WHAT THE RECEIVER SEES (D2, D5, D7): the logistics half — its own number for the order, who it is from, how many
 * packages of what and how heavy, when it leaves and when it is expected, where it is now and who is bringing it, as the
 * load's own tracking link shows anybody who holds it. Never a price, never the supplier's contacts.
 */

/** One of a business's receiving points: the place, and the code its suppliers write. */
export class ReceivingPointView {
  siteId: string;
  name: string;
  @ApiProperty({ type: GeoPoint }) location: GeoPoint;
  /** "7KQ3-PX9M": what the business gives its suppliers. */
  code: string;
  since: string;
  by: string;
}

/** What a "deliver to" code names, for the supplier about to send there: the business and the place, nothing more. */
export class ReceivingPointNamed {
  name: string;
  siteName: string;
  @ApiProperty({ type: GeoPoint }) location: GeoPoint;
}

/** A load coming in to one of the business's receiving points — the tracking link's view, and the receiver's own facts. */
export class InboundRow extends FreightTrackView {
  freightId: string;
  /** The load's own tracking link, to open the whole of it. */
  @ApiPropertyOptional() trackingKey?: string;
  /** The receiver's own number for the order, as the supplier wrote it. */
  @ApiPropertyOptional() reference?: string;
  /** Which receiving point it is for. */
  site: { siteId: string; name: string };
  /** Who it is from: the business that sent it — or, sent by its forwarder, the client it was sent for. */
  from: string;
  @ApiPropertyOptional() packages?: number;
  @ApiPropertyOptional() packaging?: string;
}

/** What is coming in to a business: its receiving points, and what is addressed to them — coming first, then the last fortnight's. */
export class InboundView {
  @ApiProperty({ type: [ReceivingPointView] }) points: ReceivingPointView[];
  @ApiProperty({ type: [InboundRow] }) items: InboundRow[];
}


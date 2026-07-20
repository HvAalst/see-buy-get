// Standards compliance + interoperability (NFR-M2-05/06). Declares the standards the e-waybill
// conforms to, a field-level crosswalk to each, and a Protocol Buffers schema published alongside
// the JSON Schema so third parties can independently generate GLOS e-waybills.

export const STANDARDS = [
  { name: 'UN/CEFACT MMT', version: 'R28+' },
  { name: 'WCO Data Model', version: '4.0' },
  { name: 'IATA ONE Record', version: '3.0' },
  { name: 'FIATA FWB', version: '2020' },
] as const;

/** GLOS e-waybill field → equivalent data element in each standard (NFR-M2-05). */
export const STANDARDS_CROSSWALK: Record<string, { unCefactMMT: string; wcoDataModel: string; iataOneRecord: string }> = {
  'identifiers.glosShipmentId': { unCefactMMT: 'Consignment.ID', wcoDataModel: 'GovernmentAgencyGoodsItem.ID', iataOneRecord: 'Waybill.waybillNumber' },
  'parties[].did': { unCefactMMT: 'TradeParty.ID', wcoDataModel: 'Consignor/Consignee.ID', iataOneRecord: 'Party.partyDetails.iataCargoAgentCode' },
  'transport.mode': { unCefactMMT: 'LogisticsTransportMovement.ModeCode', wcoDataModel: 'BorderTransportMeans.ModeCode', iataOneRecord: 'TransportMovement.modeCode' },
  'goods.hsCode': { unCefactMMT: 'Commodity.ClassificationCode', wcoDataModel: 'Commodity.TariffClassification.ID', iataOneRecord: 'Piece.goodsDescription.harmonisedCommodityCode' },
  'goods.commercialValue': { unCefactMMT: 'TradeSettlement.InvoiceAmount', wcoDataModel: 'CustomsValuation.ItemChargeAmount', iataOneRecord: 'Piece.declaredValueForCarriage' },
  'goods.incoterms': { unCefactMMT: 'TradeAgreement.DeliveryTerms.Code', wcoDataModel: 'DeliveryTerms.Code', iataOneRecord: 'Booking.incoterms' },
  'packaging.totalWeightKg': { unCefactMMT: 'Consignment.GrossMassMeasure', wcoDataModel: 'GoodsMeasure.GrossMassMeasure', iataOneRecord: 'Piece.grossWeight' },
  'packaging.count': { unCefactMMT: 'Consignment.TotalPackageQuantity', wcoDataModel: 'Packaging.QuantityQuantity', iataOneRecord: 'Shipment.totalPieceCount' },
  'handling.codes': { unCefactMMT: 'HandlingInstructions.DescriptionCode', wcoDataModel: 'AdditionalInformation.StatementCode', iataOneRecord: 'SpecialHandling.specialHandlingCodeListVersion' },
};

/** Open Protocol Buffers schema (NFR-M2-06), served at GET /v1/shipments/schema?format=proto. */
export const EWAYBILL_PROTO = `syntax = "proto3";
package glos.ewaybill.v1;

// GLOS Universal E-Waybill — aligned with UN/CEFACT MMT R28+, WCO Data Model 4.0, IATA ONE Record.
message EWaybill {
  Identifiers identifiers = 1;
  repeated Party parties = 2;
  Transport transport = 3;
  Goods goods = 4;
  Packaging packaging = 5;
  Handling handling = 6;
  map<string, string> references = 7; // namespaced tags, e.g. "eu:eori"
}
message Identifiers { string glos_shipment_id = 1; string shipper_ref = 2; }
message Party { string role = 1; string did = 2; }
message Transport {
  string mode = 1; // road|rail|air|ocean|courier|multimodal
  Ocean ocean = 2; Air air = 3; Road road = 4; Rail rail = 5;
}
message Ocean { string vessel = 1; string voyage = 2; string container_number = 3; string booking_ref = 4; }
message Air { string flight_number = 1; string mawb = 2; }
message Road { string license_plate = 1; string vehicle_id = 2; }
message Rail { string train_number = 1; string wagon_number = 2; }
message Goods { string description = 1; string hs_code = 2; string incoterms = 3; CommercialValue commercial_value = 4; }
message CommercialValue { double amount = 1; string currency = 2; }
message Packaging { int32 count = 1; double total_weight_kg = 2; repeated Package packages = 3; }
message Package { string id = 1; double weight_kg = 2; double length_cm = 3; double width_cm = 4; double height_cm = 5; }
message Handling { repeated string codes = 1; }
`;

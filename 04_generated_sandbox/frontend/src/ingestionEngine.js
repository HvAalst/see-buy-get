const ingestedItems = [];

function createShipmentRecord(shipment) {
  const timestamp = Date.now();
  const record = {
    id: `SH-${timestamp}-${Math.floor(Math.random() * 1000)}`,
    receivedAt: new Date().toISOString(),
    status: 'ingested',
    ...shipment,
  };
  ingestedItems.unshift(record);
  return record;
}

export const ingestionEngine = {
  ingestParcel(shipment) {
    return createShipmentRecord({
      ...shipment,
      type: 'Parcel',
      category: 'parcel',
    });
  },

  ingestCargo(shipment) {
    return createShipmentRecord({
      ...shipment,
      type: 'Cargo',
      category: 'cargo',
    });
  },

  getRecentIngestions(limit = 8) {
    return ingestedItems.slice(0, limit);
  },

  getAllIngestions() {
    return [...ingestedItems];
  },
};

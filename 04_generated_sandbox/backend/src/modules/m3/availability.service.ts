import { Injectable } from '@nestjs/common';
import { AvailabilityEntry } from './matching.types';

/**
 * AvailabilityService (M3-020). The live supply pool — carriers broadcast availability via a
 * lightweight heartbeat (DID, zone, equipment, status). M3 matches against this pool.
 */
@Injectable()
export class AvailabilityService {
  private readonly pool = new Map<string, AvailabilityEntry>();

  broadcast(entry: { did: string; zone: string; equipment?: string[]; status?: 'available' | 'busy' }): AvailabilityEntry {
    const record: AvailabilityEntry = {
      did: entry.did,
      zone: entry.zone,
      equipment: entry.equipment ?? [],
      status: entry.status ?? 'available',
      updatedAt: new Date().toISOString(),
    };
    this.pool.set(entry.did, record);
    return record;
  }

  setStatus(did: string, status: 'available' | 'busy'): void {
    const entry = this.pool.get(did);
    if (entry) {
      entry.status = status;
      entry.updatedAt = new Date().toISOString();
    }
  }

  available(): AvailabilityEntry[] {
    return Array.from(this.pool.values()).filter((e) => e.status === 'available');
  }

  get(did: string): AvailabilityEntry | undefined {
    return this.pool.get(did);
  }
}

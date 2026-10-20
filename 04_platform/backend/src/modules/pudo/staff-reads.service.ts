import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { isStaffAccount } from '../../foundation/auth/setup-key';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { STAFF_READ_WINDOW_MS, STAFF_READS_LIMIT, type StaffRead, type StaffReadList } from './staff-reads.types';

/** WHAT STAFF OPENED (staff-reads.types.ts): noted by StaffReadInterceptor, read on the console. */
@Injectable()
export class StaffReadService {
  private readonly reads = new PersistentMap<string, StaffRead>('staff-reads');
  /** The line a record opened again soon counts on: who · route · record → the line. Lost at a restart, harmlessly. */
  private readonly recent = new Map<string, string>();

  /** Note a record a member of staff opened. Anybody else's reading is not noted here. */
  note(actor: IntrospectionResult | undefined, route: string, record: string, now: number = Date.now()): void {
    if (actor?.role !== 'operator') return;
    const by = readerOf(actor);
    const key = `${by.staffId ?? by.name}|${route}|${record}`;
    const last = this.recent.get(key);
    const line = last ? this.reads.get(last) : undefined;
    if (line && now - Date.parse(line.lastAt) <= STAFF_READ_WINDOW_MS) {
      this.reads.set(line.readId, { ...line, lastAt: new Date(now).toISOString(), times: line.times + 1 });
      return;
    }
    const at = new Date(now).toISOString();
    const read: StaffRead = { readId: `srd_${randomBytes(8).toString('hex')}`, at, lastAt: at, times: 1, by, route, record };
    this.reads.set(read.readId, read);
    this.recent.set(key, read.readId);
  }

  /** The log, newest first: of one member of staff (by name), of one record, or all of it. */
  list(filter: { by?: string; record?: string } = {}, limit: number = STAFF_READS_LIMIT): StaffReadList {
    const by = filter.by?.trim().toLowerCase();
    const record = filter.record?.trim().toLowerCase();
    const all = [...this.reads.values()]
      .filter((r) => (!by || r.by.name.toLowerCase().includes(by)) && (!record || r.record.toLowerCase().includes(record)))
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
    return {
      total: all.length,
      items: all.slice(0, Math.max(1, Math.min(limit, STAFF_READS_LIMIT))).map((r) => ({
        readId: r.readId,
        at: r.at,
        lastAt: r.lastAt,
        times: r.times,
        byKind: r.by.kind,
        byName: r.by.name,
        ...(r.by.staffId ? { staffId: r.by.staffId } : {}),
        route: r.route,
        record: r.record,
      })),
    };
  }
}

/** A member of staff by their own account and name; the shared key is nobody, and is said so. */
function readerOf(actor: IntrospectionResult): StaffRead['by'] {
  if (isStaffAccount(actor)) {
    const staffId = actor.revocationKey!.slice(actor.revocationKey!.indexOf(':') + 1);
    return { kind: 'staff', name: actor.actorName?.trim() || staffId, staffId };
  }
  return { kind: 'key', name: 'the shared key' };
}

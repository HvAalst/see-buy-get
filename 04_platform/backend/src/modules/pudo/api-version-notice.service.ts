import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EntityService } from '../../foundation/entity/entity.service';
import { API_VERSIONS, LAST_NOTICE_DAYS, type ApiVersion } from '../../foundation/http/api-versions';
import { MailService } from '../../foundation/mail/mail.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { BusinessService } from './business.service';
import { CompanyKeyService } from './company-key.service';
import type { CompanyKind } from './company-key.types';
import { FleetManagerService } from './fleet-manager.service';
import { NotificationService } from './notification.service';

/** How often it looks: a notice a day late is still a year's notice. */
const SWEEP_MS = 6 * 3_600_000;

/**
 * A VERSION OF THE API STOPS ONLY WITH NOTICE (the user, round 12: "A year, with notice"). Every company holding a working
 * live key is told when a version is announced as stopping, and again a month before it stops — by email (a business's
 * owners, a fleet's contact email) and in its bell. Each notice once per company; a company whose first live key comes
 * after the announcement is told then.
 */
@Injectable()
export class ApiVersionNoticeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiVersionNoticeService.name);
  /** Which notice each company has had: `version:stage:kind:id`. */
  private readonly sent = new PersistentMap<string, { at: string }>('api-version-notices');
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly keys: CompanyKeyService,
    private readonly entities: EntityService,
    private readonly businesses: BusinessService,
    private readonly managers: FleetManagerService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Send every notice that is due and not yet sent. How many went. */
  async sweep(now: number = Date.now(), versions: readonly ApiVersion[] = API_VERSIONS): Promise<number> {
    let told = 0;
    for (const v of versions) {
      if (!v.announcedAt || !v.retiresAt) continue;
      const announced = Date.parse(v.announcedAt);
      const retires = Date.parse(v.retiresAt);
      if (now < announced || now >= retires) continue;
      // In the last month, the month's notice — and only that, for a company first told now: not two in one day.
      const stage: 'announced' | 'month' = now >= retires - LAST_NOTICE_DAYS * 86_400_000 ? 'month' : 'announced';
      for (const owner of this.keys.holders()) {
        const key = `${v.version}:${stage}:${owner.kind}:${owner.id}`;
        if (this.sent.has(key)) continue;
        if (await this.tell(owner, v, stage)) {
          this.sent.set(key, { at: new Date(now).toISOString() });
          told += 1;
        }
      }
    }
    return told;
  }

  private async tell(owner: { kind: CompanyKind; id: string }, v: ApiVersion, stage: 'announced' | 'month'): Promise<boolean> {
    const company = this.company(owner);
    if (!company) return false;
    const params = { company: company.name, version: v.version, retiresAt: v.retiresAt!, stage, app: owner.kind };
    try {
      await this.notifications?.notify(company.did, {
        kind: 'api_version',
        title: stage === 'month' ? `Version ${v.version} of the API stops in a month` : `Version ${v.version} of the API will stop`,
        body: `Your system's key calls version ${v.version}. It keeps working until ${v.retiresAt!.slice(0, 10)}; the developer guide says what changed.`,
        link: '/',
        data: { version: v.version, retiresAt: v.retiresAt, stage },
      });
    } catch (err) {
      this.logger.warn(`api_version notice failed for ${owner.kind} ${owner.id}: ${(err as Error).message}`);
    }
    for (const to of company.addresses) void this.mail?.send('api-version-retiring', to, params);
    return true;
  }

  /** Who the company is, its DID for the bell, and where it is emailed. */
  private company(owner: { kind: CompanyKind; id: string }): { name: string; did: string; addresses: Array<{ address: string; name: string }> } | undefined {
    if (owner.kind === 'business') {
      const entity = this.entities.find(owner.id);
      if (!entity?.business) return undefined;
      return { name: entity.name, did: entity.did, addresses: this.businesses.ownerAddresses(owner.id) };
    }
    try {
      const fleet = this.managers.get(owner.id);
      return { name: fleet.companyName, did: fleet.did, addresses: fleet.contactEmail ? [{ address: fleet.contactEmail, name: fleet.companyName }] : [] };
    } catch {
      return undefined;
    }
  }
}

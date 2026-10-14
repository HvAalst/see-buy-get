import { Body, Controller, Get, Header, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { recordKeeper } from '../../foundation/entity/company-declarations.service';
import { CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { CompanyPaperReportService, PaperCaseView, type Reporter } from '../../foundation/entity/company-paper-reports.service';
import { lapsesAt } from '../../foundation/entity/company-record.types';
import { EntityService } from '../../foundation/entity/entity.service';
import type { Entity } from '../../foundation/entity/entity.types';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { AnswerPaperReportDto, ContractCompanyView, ContractPaperView, DecidePaperReportDto, PaperCaseList, ReportContractPaperDto, ReportPaperDto } from './pudo.dto';
import { staffOf } from './staff-of';
import { VendorService } from './vendor.service';

const same = (a: unknown, b: unknown) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();

/**
 * A COMPANY'S PAPER, REPORTED (company-paper-reports.service.ts). Four kinds of caller, four doors:
 *
 *  - SOMEBODY WHO CAN OPEN THE COMPANY'S RECORD reports a paper on it: network staff, and the administrators of the
 *    company and of the company above it.
 *  - SOMEBODY WHO CONTRACTS WITH THE COMPANY — a shop, a hub, a fleet, a driver, a store, a business in its country —
 *    is shown its licences and insurance policies with their numbers, and reports one from there (the user,
 *    2026-10-09: "the number is enough and can be verified"). Never a bank account, never who may sign, never a file.
 *  - THE COMPANY answers: one of its own administrators, and never staff in its place.
 *  - STAFF read the reports and what was attached, dismiss one, or strike the paper — proposed by one of them and
 *    approved by another.
 *
 * `@Roles` keeps everybody BUT staff out of a route (a staff token passes every labelled one), so the doors that are
 * not staff's say so themselves.
 */
@Controller('sbg')
export class CompanyPaperReportController {
  constructor(
    private readonly reports: CompanyPaperReportService,
    private readonly entities: EntityService,
    private readonly documents: CompanyDocumentService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly managers: FleetManagerService,
    private readonly drivers: DriverService,
    private readonly vendors: VendorService,
  ) {}

  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/documents/:documentId/report')
  async report(@Param('entityId') entityId: string, @Param('documentId') documentId: string, @Body() dto: ReportPaperDto, @Actor() actor: IntrospectionResult) {
    const reporter = this.connected(actor, entityId, dto.by);
    const made = await this.reports.report({ entityId, documentId, category: dto.category, note: dto.note, evidenceDataUrl: dto.evidenceDataUrl, reporter });
    // Not who was told, and nothing of the case: the reporter learns that it was taken, and until when the company may answer.
    return { caseId: made.caseId, reportId: made.reportId, answerBy: made.answerBy };
  }

  /* ------------------------------------------------- whoever contracts with the company -- */

  /**
   * WHO YOU CONTRACT WITH, AND THE PAPERS IT TRADES ON. The company of ours behind this sign-in, with its licences
   * and insurance policies: what each is, who issued it, its NUMBER, and until when it is good — enough to check
   * against the issuer's own register. And, for a paper this reader reported, what became of that.
   *
   * Nothing where no company of ours contracts with them, and nothing but licences and policies: a bank account, the
   * people who may sign and the files themselves are the company's and staff's.
   */
  @Roles('agent', 'mdp', 'fleet_manager', 'driver', 'genesis', 'business')
  @Get('contract/company')
  contractCompany(@Actor() actor: IntrospectionResult): ContractCompanyView {
    const contract = this.contracted(actor);
    if (!contract) return { papers: [] };
    const { entity, reporter } = contract;
    const record = this.entities.recordOf(entity.entityId);
    const mine = this.reports.byReporter(entity.entityId, reporter.key);
    const now = Date.now();
    const paper = (source: 'licence' | 'insurance', kind: string, issuer: string, number: string, expiresAt: string): ContractPaperView => {
      const paperKind = source === 'licence' ? 'licence' : 'insurance_policy';
      const behind = this.documents.currentOf(entity.entityId, paperKind, number);
      const yours = mine.find((m) => m.kind === paperKind && same(m.relatesTo, number));
      return {
        source,
        kind,
        issuer,
        number,
        expiresAt,
        lapsed: lapsesAt(expiresAt) <= now,
        // Reported through the paper behind it: with none on record that counts, there is nothing a report could strike.
        reportable: Boolean(behind && this.documents.counts(behind)),
        ...(yours ? { yourReport: { at: yours.at, state: yours.state, ...(yours.reason ? { reason: yours.reason } : {}) } } : {}),
      };
    };
    return {
      company: { name: entity.name, ...(entity.jurisdiction ? { jurisdiction: entity.jurisdiction } : {}) },
      papers: [...record.licences.map((l) => paper('licence', l.kind, l.issuer, l.number, l.expiresAt)), ...record.insurance.map((p) => paper('insurance', p.kind, p.insurer, p.policyNumber, p.expiresAt))],
    };
  }

  /**
   * REPORT ONE OF THEM. What is reported is worked out HERE, from what this reader was shown: the company from their
   * own record, the paper from the licence or policy they name on that company's record. Never a company or a
   * document id from the request — a report could otherwise be aimed at any company's paper.
   */
  @Roles('agent', 'mdp', 'fleet_manager', 'driver', 'genesis', 'business')
  @Post('contract/company/papers/report')
  async reportContractPaper(@Body() dto: ReportContractPaperDto, @Actor() actor: IntrospectionResult) {
    const contract = this.contracted(actor);
    if (!contract) throw new GlosError('NOT_FOUND', 'No company of ours contracts with you here');
    const { entity, reporter } = contract;
    const record = this.entities.recordOf(entity.entityId);
    const onRecord = dto.source === 'licence' ? record.licences.some((l) => same(l.number, dto.number)) : dto.source === 'insurance' ? record.insurance.some((p) => same(p.policyNumber, dto.number)) : false;
    if (!onRecord) throw new GlosError('NOT_FOUND', `There is no such licence or policy on ${entity.name}’s record`);
    const behind = this.documents.currentOf(entity.entityId, dto.source === 'licence' ? 'licence' : 'insurance_policy', dto.number);
    if (!behind) throw new GlosError('INVALID_STATE', `There is no paper on ${entity.name}’s record behind this one, so there is nothing a report could strike`);
    const made = await this.reports.report({ entityId: entity.entityId, documentId: behind.documentId, category: dto.category, note: dto.note, evidenceDataUrl: dto.evidenceDataUrl, reporter });
    return { reportId: made.reportId, answerBy: made.answerBy };
  }

  /* --------------------------------------------------------------------- the company -- */

  @Roles('entity_admin')
  @Post('paper-reports/:caseId/answer')
  @HttpCode(200)
  answer(@Param('caseId') caseId: string, @Body() dto: AnswerPaperReportDto, @Actor() actor: IntrospectionResult): PaperCaseView {
    // The company answers for itself. Staff answering in its place would be staff deciding both sides.
    if (actor?.role !== 'entity_admin' || !this.entities.mayAdminister(actor.tenant, this.reports.entityOf(caseId))) throw new GlosError('NOT_FOUND', 'No such report');
    return this.reports.answer({ caseId, note: dto.note, evidenceDataUrl: dto.evidenceDataUrl, by: actor.actorName });
  }

  /* ----------------------------------------------------------------------- staff -- */

  @Roles('operator')
  @Get('paper-reports')
  list(@Actor() actor: IntrospectionResult): PaperCaseList {
    return { items: this.reports.list(this.keyOf(actor)), waiting: this.reports.waiting() };
  }

  @Roles('operator')
  @Get('paper-reports/:caseId')
  one(@Param('caseId') caseId: string, @Actor() actor: IntrospectionResult): PaperCaseView {
    return this.reports.one(caseId, this.keyOf(actor));
  }

  /** What a reporter, or the company, attached — with the fingerprint it arrived under and whether the bytes still match it. */
  @Roles('operator')
  @Get('paper-reports/:caseId/evidence/:evidenceId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  evidence(@Param('caseId') caseId: string, @Param('evidenceId') evidenceId: string, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = this.reports.evidenceFile(caseId, evidenceId);
    res.setHeader('X-Fingerprint', file.fingerprint);
    res.setHeader('X-Fingerprint-Intact', String(file.intact));
    res.setHeader('Access-Control-Expose-Headers', 'X-Fingerprint, X-Fingerprint-Intact');
    return new StreamableFile(file.bytes, { type: file.contentType });
  }

  @Roles('operator')
  @Post('paper-reports/:caseId/dismiss')
  @HttpCode(200)
  dismiss(@Param('caseId') caseId: string, @Body() dto: DecidePaperReportDto, @Actor() actor: IntrospectionResult): Promise<PaperCaseView> {
    return this.reports.dismiss(caseId, dto.reason, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('paper-reports/:caseId/strike/propose')
  @HttpCode(200)
  proposeStrike(@Param('caseId') caseId: string, @Body() dto: DecidePaperReportDto, @Actor() actor: IntrospectionResult): PaperCaseView {
    return this.reports.proposeStrike(caseId, dto.reason, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('paper-reports/:caseId/strike/approve')
  @HttpCode(200)
  approveStrike(@Param('caseId') caseId: string, @Body() dto: DecidePaperReportDto, @Actor() actor: IntrospectionResult): Promise<PaperCaseView> {
    return this.reports.approveStrike(caseId, staffOf(actor, dto.by));
  }

  /* ----------------------------------------------------------------- who is connected -- */

  /**
   * WHO MAY REPORT FROM A COMPANY'S RECORD: somebody signed in and CONNECTED to the company (the user, 2026-10-09).
   * A member of staff; or an administrator of the company itself or of the company above it. A stranger is told
   * there is no such company — not that there is one they may not report.
   */
  private connected(actor: IntrospectionResult, entityId: string, typed?: string): Reporter {
    if (actor?.role === 'operator') {
      const staff = staffOf(actor, typed);
      return { key: staff.key, name: staff.name, role: 'SeeBuyGet staff' };
    }
    if (actor?.role === 'entity_admin' && actor.actorName && this.entities.mayAdminister(actor.tenant, entityId)) {
      return { key: actor.revocationKey ?? `administrator:${actor.actorName}`, name: actor.actorName, role: actor.tenant === entityId ? 'an administrator of the company' : 'an administrator of the company above it' };
    }
    throw new GlosError('NOT_FOUND', `No such company: ${entityId}`);
  }

  /**
   * WHO THIS SIGN-IN CONTRACTS WITH: the company of ours behind a shop, a hub, a fleet, a driver or a store, and the
   * one in a business's own country. Read off the sign-in's OWN record, by the same lookups that decide who pays them
   * — never from anything the request says. Nothing where no company of ours is there (a country we only match), and
   * nothing for a company that does not keep its own record. The reporter is the SHOP, the FLEET, the DRIVER: one
   * voice each, by the name on their record.
   */
  private contracted(actor: IntrospectionResult): { entity: Entity; reporter: Reporter } | undefined {
    const did = actor?.did;
    if (!did) return undefined;
    let entityId: string | undefined;
    let name: string | undefined;
    let role = '';
    try {
      if (actor.role === 'agent') {
        const shop = this.agents.find(did);
        if (shop) [entityId, name, role] = [this.agents.entityIdOrNone(shop), shop.shopName, 'a shop that contracts with the company'];
      } else if (actor.role === 'mdp') {
        const hub = this.mdps.list().find((m) => m.did === did);
        if (hub) [entityId, name, role] = [this.mdps.entityIdOrNone(hub), hub.name, 'a hub that contracts with the company'];
      } else if (actor.role === 'fleet_manager') {
        const fleet = this.managers.list().find((m) => m.did === did);
        if (fleet) [entityId, name, role] = [this.managers.entityIdOrNone(fleet), fleet.companyName, 'a fleet that contracts with the company'];
      } else if (actor.role === 'driver') {
        [entityId, name, role] = [this.drivers.payeeOrNone(did).entityId, this.drivers.get(did).displayName, 'a driver who works under the company'];
      } else if (actor.role === 'genesis') {
        const store = this.vendors.byDid(did);
        if (store) [entityId, name, role] = [this.vendors.entityIdOrNone(store), store.name, 'a store that ships through the company'];
      } else if (actor.role === 'business') {
        const business = this.entities.find(actor.tenant ?? '');
        if (business?.kind === 'business') [entityId, name, role] = [this.entities.forJurisdiction(business.jurisdiction)?.entityId, business.name, 'a business in the company’s country'];
      }
    } catch {
      return undefined; // a sign-in whose own record is gone contracts with nobody
    }
    const entity = entityId ? this.entities.find(entityId) : undefined;
    if (!entity || !name || recordKeeper(entity) !== 'company') return undefined;
    return { entity, reporter: { key: `${actor.role}:${actor.role === 'business' ? actor.tenant : did}`, name, role } };
  }

  /** Which member of staff is reading, where the sign-in can say: it is what "you proposed this" is told from. */
  private keyOf(actor: IntrospectionResult): string | undefined {
    try {
      return staffOf(actor).key;
    } catch {
      return undefined;
    }
  }
}

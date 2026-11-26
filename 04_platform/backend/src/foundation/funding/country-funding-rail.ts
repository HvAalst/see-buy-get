import type { CallbackMeta, FundingInstruction, FundingRail, RailCallback, RailCheckAnswer, RailOpening, RailPayment } from './funding.types';

/**
 * 2026-11-24 — THE PAYMENT HUB CHOOSES BY COUNTRY (the owner: "the system will choose the right method depending on the country
 * without the user noticing it"). One rail per country's money, where one is set up there — euros through Mollie, shillings
 * through M-Pesa — and the rail this server always had for everything else. Nobody is asked which: the money they pay in says it.
 * Each provider's notices reach its own rail (`forProvider`).
 */
export class CountryFundingRail implements FundingRail {
  readonly provider: string;
  /** The sandbox's own stand-in, and M-Pesa's answers: the rail this server always had. */
  readonly simulate?: FundingRail['simulate'];
  readonly readAnswer?: (headers: Record<string, string | undefined>, body: unknown, meta?: CallbackMeta) => Promise<RailCheckAnswer>;

  constructor(
    private readonly byCurrency: Record<string, FundingRail>,
    private readonly fallback: FundingRail,
  ) {
    this.provider = fallback.provider;
    if (fallback.simulate) this.simulate = fallback.simulate.bind(fallback);
    if (fallback.readAnswer) this.readAnswer = fallback.readAnswer.bind(fallback);
  }

  /** The rail for a payment in this money. */
  railFor(currency: string): FundingRail {
    return this.byCurrency[currency.toUpperCase()] ?? this.fallback;
  }

  async open(instruction: FundingInstruction): Promise<RailOpening> {
    const rail = this.railFor(instruction.currency);
    const opened = await rail.open(instruction);
    return { ...opened, provider: rail.provider };
  }

  verify(headers: Record<string, string | undefined>, body: unknown, meta?: CallbackMeta): Promise<RailCallback> {
    return this.fallback.verify(headers, body, meta);
  }

  forProvider(provider: string): FundingRail | undefined {
    return [this.fallback, ...Object.values(this.byCurrency)].find((r) => r.provider === provider);
  }

  needsPhone(currency: string): boolean {
    return this.railFor(currency).needsPhone?.(currency) ?? this.railFor(currency).provider !== 'mollie';
  }

  providerFor(currency: string): string {
    return this.railFor(currency).provider;
  }

  canAsk(): boolean {
    return this.fallback.canAsk?.() ?? false;
  }

  askAbout(payment: RailPayment): Promise<{ askedRef: string }> {
    const rail = this.forProvider(payment.provider) ?? this.fallback;
    if (!rail.askAbout) return Promise.reject(new Error(`${rail.provider} cannot be asked about a payment`));
    return rail.askAbout(payment);
  }
}

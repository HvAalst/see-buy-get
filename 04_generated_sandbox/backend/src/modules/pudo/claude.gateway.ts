import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

/** What the adviser sends, and what comes back: the SDK's own types, so nothing about a message is redefined here. */
export type ClaudeRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type ClaudeReply = Anthropic.Beta.Messages.BetaMessage;

/**
 * P5 — THE ONE PLACE THIS BACKEND TALKS TO CLAUDE.
 *
 * A seam, not an abstraction: it adds nothing to the SDK call but two facts the rest of the code needs to be honest —
 * whether a credential is configured at all, and a client built once. The adviser's logic (what is sent, what a tool
 * call does, when to stop) lives in PlanAdviserService and is tested against a scripted stand-in for this class, so
 * the tests need no key and spend nothing.
 *
 * Credentials come from the environment the way the SDK reads them (ANTHROPIC_API_KEY, or ANTHROPIC_AUTH_TOKEN).
 * Nothing is hardcoded and no key is ever logged.
 */
@Injectable()
export class ClaudeGateway {
  private client: Anthropic | null = null;

  /** Is there a credential to call with? Without one the adviser says it is not set up — it never pretends. */
  configured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
  }

  create(request: ClaudeRequest): Promise<ClaudeReply> {
    // One minute a call and one retry: a dispatcher is waiting at a screen, and a plan that takes longer than that to
    // talk about is better answered with "try again" than with a spinner.
    this.client ??= new Anthropic({ timeout: 60_000, maxRetries: 1 });
    return this.client.beta.messages.create(request);
  }
}

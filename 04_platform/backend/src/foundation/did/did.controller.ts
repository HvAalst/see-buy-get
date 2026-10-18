import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { DidService } from './did.service';
import { DidDocument, PublicDidDocument, publicDidDocument } from './did.types';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/scopes.decorator';
import { isSandbox } from '../runtime/sandbox';

interface GenerateDidDto {
  controller: string;
  metadata?: Record<string, unknown>;
}

@Controller('did')
export class DidController {
  constructor(private readonly didService: DidService) {}

  /**
   * Bootstrap a DID. In a sandbox only, so a client can obtain a DID and then a DID-bound token; outside one this is
   * internal to the M1 verification flow, and nobody mints an identity by asking.
   */
  @Public()
  @Post()
  generate(@Body() body: GenerateDidDto): DidDocument {
    if (!isSandbox()) throw new NotFoundException('Not found');
    return this.didService.generate(body?.controller, body?.metadata);
  }

  /** Resolve a DID document: public, because DIDs are meant to be resolvable — but never with a phone number in it. */
  @Public()
  @Get(':id')
  resolve(@Param('id') id: string): PublicDidDocument {
    const doc = this.didService.resolve(id);
    if (!doc) throw new NotFoundException(`DID not found: ${id}`);
    return publicDidDocument(doc);
  }

  /** The controller as it was registered — for a shop, a driver or a fleet, its mobile number. Network staff only. */
  @Roles('operator')
  @Get(':id/controller')
  controller(@Param('id') id: string): { did: string; controller: string } {
    const doc = this.didService.resolve(id);
    if (!doc) throw new NotFoundException(`DID not found: ${id}`);
    return { did: doc.id, controller: doc.controller };
  }
}

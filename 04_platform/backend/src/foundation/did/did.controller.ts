import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { DidService } from './did.service';
import { DidDocument } from './did.types';
import { Public } from '../auth/public.decorator';

interface GenerateDidDto {
  controller: string;
  metadata?: Record<string, unknown>;
}

@Controller('did')
export class DidController {
  constructor(private readonly didService: DidService) {}

  /**
   * Bootstrap a DID. Public in the sandbox so a client can obtain a DID and then a
   * DID-bound token; in production this is internal to the M1 verification flow.
   */
  @Public()
  @Post()
  generate(@Body() body: GenerateDidDto): DidDocument {
    return this.didService.generate(body?.controller, body?.metadata);
  }

  /** Resolve a DID document (public — DIDs are designed to be resolvable). */
  @Public()
  @Get(':id')
  resolve(@Param('id') id: string): DidDocument {
    const doc = this.didService.resolve(id);
    if (!doc) throw new NotFoundException(`DID not found: ${id}`);
    return doc;
  }
}

import { Controller, Get } from '@nestjs/common';
import { Public } from '../foundation/auth/public.decorator';

interface HealthStatus {
  status: 'ok';
  service: string;
  modules: string[];
  timestamp: string;
}

@Controller('health')
export class HealthController {
  /** Liveness check — public (no auth required). */
  @Public()
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      service: 'glos-backend',
      modules: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'pudo', 'sse'],
      timestamp: new Date().toISOString(),
    };
  }
}

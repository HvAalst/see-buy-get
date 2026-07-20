import { Controller, Get } from '@nestjs/common';

interface ModuleInfo {
  module: string;
  name: string;
  epic: string;
  status: 'scaffold';
}

@Controller('gateway')
export class M6Controller {
  @Get('module-info')
  info(): ModuleInfo {
    return {
      module: 'M6',
      name: 'Open API Gateway & Developer Ecosystem (APIG)',
      epic: '02_epic_domains/epic_m6_api_gateway.md',
      status: 'scaffold',
    };
  }
}

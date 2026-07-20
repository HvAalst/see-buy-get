import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok with the Phase-1 modules', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('glos-backend');
    expect(result.modules).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'pudo', 'sse']);
    expect(typeof result.timestamp).toBe('string');
  });
});

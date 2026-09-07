import { Controller, ExecutionContext, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import 'reflect-metadata';
import { ResponseCode } from '../enums/response-code.enum';
import { ResponseMessage } from '../enums/response-message.enum';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { ResponseInterceptor } from '../interceptors/response.interceptor';
import { EnvelopeThrottlerGuard, StrictThrottle, platformThrottlerOptions } from './throttler';

@Controller('probe')
class ProbeController {
  @Get('open')
  open(): { ok: boolean } {
    return { ok: true };
  }

  @Get('strict')
  @StrictThrottle()
  strict(): { ok: boolean } {
    return { ok: true };
  }
}

describe('rate limiting', () => {
  let app: INestApplication;
  let http: request.Agent;

  beforeAll(async () => {
    // The strict budget is read from the environment on every request, so the
    // suite states it here rather than depending on the deployment default.
    process.env.RATE_LIMIT_STRICT_LIMIT = '1';
    process.env.RATE_LIMIT_TTL_MS = '60000';

    // Two requests per window: enough to see the third refused, short enough
    // that the suite never waits on a clock.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot(
          platformThrottlerOptions({
            ttlMs: 60_000,
            limit: 2,
            strictLimit: 1,
            internalLimit: 50,
          }),
        ),
      ],
      controllers: [ProbeController],
      providers: [
        EnvelopeThrottlerGuard,
        { provide: APP_GUARD, useExisting: EnvelopeThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // The suite speaks to the app from one socket, so it stands in for the
    // proxied deployment: `trust proxy` is what makes X-Forwarded-For the
    // identity, and the guard is only as good as that setting.
    (app as unknown as { set(k: string, v: unknown): void }).set('trust proxy', true);
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    delete process.env.RATE_LIMIT_STRICT_LIMIT;
    delete process.env.RATE_LIMIT_TTL_MS;
    await app?.close();
  });

  const from = (address: string) => http.get('/probe/open').set('x-forwarded-for', address);

  it('serves a caller inside its budget', async () => {
    const response = await from('10.0.0.1').expect(200);
    expect(response.body.data).toEqual({ ok: true });
  });

  it('refuses the request that goes over, through the platform envelope', async () => {
    const caller = '10.0.0.2';
    await from(caller).expect(200);
    await from(caller).expect(200);

    const refused = await from(caller).expect(429);

    // The same shape as every other failure: a client parses one response type.
    expect(refused.body).toMatchObject({
      code: ResponseCode.RATE_LIMIT_EXCEEDED,
      message: ResponseMessage.RATE_LIMIT_EXCEEDED,
      data: null,
    });
    // And it is told when to come back, rather than left to guess.
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts each caller separately', async () => {
    await from('10.0.0.3').expect(200);
    await from('10.0.0.3').expect(200);
    await from('10.0.0.3').expect(429);

    // A neighbour's burst must not spend someone else's budget.
    await from('10.0.0.4').expect(200);
  });

  it('gives an internal caller its own bucket, keyed on the credential', async () => {
    const shared = '10.0.0.5';
    const withKey = (key: string) =>
      http.get('/probe/open').set('x-forwarded-for', shared).set('x-api-key', key);

    await withKey('key-alpha').expect(200);
    await withKey('key-alpha').expect(200);
    await withKey('key-alpha').expect(429);

    // Same address, different credential: the platform's own traffic is not
    // throttled by whatever else shares its egress.
    await withKey('key-beta').expect(200);
  });

  it('lets a broker delivery through, because it is not an HTTP caller', async () => {
    const guard = app.get(EnvelopeThrottlerGuard, { strict: false });
    const rpcContext = {
      getType: () => 'rpc',
      switchToHttp: () => {
        throw new Error('a queue delivery has no HTTP context');
      },
    } as unknown as ExecutionContext;

    // `transactions` consumes RabbitMQ through the same application: a global
    // guard that assumed HTTP would take the consumer down on every message.
    await expect(guard.canActivate(rpcContext)).resolves.toBe(true);
  });

  it('holds a route that creates something to a tighter budget', async () => {
    const strict = (address: string) =>
      http.get('/probe/strict').set('x-forwarded-for', address);

    await strict('10.0.0.6').expect(200);
    await strict('10.0.0.6').expect(429);
  });
});

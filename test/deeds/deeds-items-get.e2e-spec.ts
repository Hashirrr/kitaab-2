import request from 'supertest';
import { App } from 'supertest/types';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app/app.module';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '../../src/logger/logger.service';
import { JwtAuthGuard } from '../../src/auth/auth.guard';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { RedisService } from '../../src/database/redis/redis.service';
import { EncryptionService } from '../../src/encryption/encryption.service';
import { PostgresService } from '../../src/database/postgres/postgres.service';

describe('DeedsController (e2e) - GET /deeds/:category/items', () => {
  let app: INestApplication<App>;

  const postgresQueryMock = jest.fn();
  const jwtVerifyAsyncMock = jest.fn();
  const configGetMock = jest.fn();

  const accessTokenPayload = {
    sub: 1,
    email: 'muhammad@example.com',
    type: 'access',
    email_verified: true,
  };

  beforeEach(async () => {
    postgresQueryMock.mockReset();
    jwtVerifyAsyncMock.mockReset();
    configGetMock.mockReset();

    configGetMock.mockImplementation((key: string) => {
      const table: Record<string, string> = {
        JWT_PUBLIC_KEY: 'test-public',
      };
      return table[key];
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PostgresService)
      .useValue({
        query: postgresQueryMock,
        transaction: jest.fn(),
        ping: jest.fn(),
      })
      .overrideProvider(RedisService)
      .useValue({
        set: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        ping: jest.fn(),
      })
      .overrideProvider(JwtService)
      .useValue({
        signAsync: jest.fn(),
        verifyAsync: jwtVerifyAsyncMock,
      })
      .overrideProvider(ConfigService)
      .useValue({
        get: configGetMock,
      })
      .overrideProvider(EncryptionService)
      .useValue({
        hmacEmail: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    const logger = app.get(Logger);
    app.useGlobalGuards(
      new JwtAuthGuard(logger, app.get(JwtService), app.get(ConfigService)),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('-> 401, not 500, when Authorization header missing', async () => {
    const response = await request(app.getHttpServer())
      .get('/deeds/hasanaat/items')
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 401, not 500, when token invalid', async () => {
    jwtVerifyAsyncMock.mockRejectedValueOnce(new Error('jwt malformed'));

    const response = await request(app.getHttpServer())
      .get('/deeds/hasanaat/items')
      .set('Authorization', 'Bearer bad-token')
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when category invalid', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .get('/deeds/invalid/items')
      .set('Authorization', 'Bearer access-token')
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 404, not 500, when deed category not found', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock.mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .get('/deeds/hasanaat/items')
      .set('Authorization', 'Bearer access-token')
      .expect(404);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).toHaveBeenCalledTimes(1);
  });

  it('-> 200 returns an empty array when category has no items', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_id: 5 }])
      .mockResolvedValueOnce([]);

    await request(app.getHttpServer())
      .get('/deeds/hasanaat/items')
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([]);
      });

    expect(postgresQueryMock).toHaveBeenCalledTimes(2);
  });

  it('-> 200 returns deed items as a nested tree', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_id: 5 }])
      .mockResolvedValueOnce([
        {
          deed_item_id: 10,
          deed_id: 5,
          parent_deed_item_id: null,
          name: 'encrypted-parent',
          description: 'encrypted-parent-description',
          display_order: 1,
          hide_type: 'none',
          created_at: createdAt,
          type: null,
          last_recorded_at: null,
        },
        {
          deed_item_id: 11,
          deed_id: 5,
          parent_deed_item_id: 10,
          name: 'encrypted-child',
          description: null,
          display_order: 1,
          hide_type: 'none',
          created_at: createdAt,
          type: null,
          last_recorded_at: null,
        },
        {
          deed_item_id: 12,
          deed_id: 5,
          parent_deed_item_id: 11,
          name: 'encrypted-grand-child',
          description: null,
          display_order: 1,
          hide_type: 'none',
          created_at: createdAt,
          type: null,
          last_recorded_at: null,
        },
      ]);

    await request(app.getHttpServer())
      .get('/deeds/hasanaat/items')
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([
          {
            deed_item_id: 10,
            deed_id: 5,
            parent_deed_item_id: null,
            name: 'encrypted-parent',
            description: 'encrypted-parent-description',
            display_order: 1,
            hide_type: 'none',
            created_at: createdAt.toISOString(),
            type: null,
            last_recorded_at: null,
            children: [
              {
                deed_item_id: 11,
                deed_id: 5,
                parent_deed_item_id: 10,
                name: 'encrypted-child',
                description: null,
                display_order: 1,
                hide_type: 'none',
                created_at: createdAt.toISOString(),
                type: null,
                last_recorded_at: null,
                children: [
                  {
                    deed_item_id: 12,
                    deed_id: 5,
                    parent_deed_item_id: 11,
                    name: 'encrypted-grand-child',
                    description: null,
                    display_order: 1,
                    hide_type: 'none',
                    created_at: createdAt.toISOString(),
                    type: null,
                    last_recorded_at: null,
                  },
                ],
              },
            ],
          },
        ]);
      });

    expect(postgresQueryMock).toHaveBeenCalledTimes(2);
    const [, queryParams] = postgresQueryMock.mock.calls[1];
    expect(queryParams).toEqual([5, 1]);
  });

  it('-> 200 returns deed items with scale and count types and last_recorded_at', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const lastRecordedAtScale = new Date('2026-03-10T15:30:00.000Z');
    const lastRecordedAtCount = new Date('2026-03-12T18:00:00.000Z');

    postgresQueryMock
      .mockResolvedValueOnce([{ deed_id: 5 }])
      .mockResolvedValueOnce([
        {
          deed_item_id: 10,
          deed_id: 5,
          parent_deed_item_id: null,
          name: 'Scale Deed',
          description: 'Scale Deed description',
          display_order: 1,
          hide_type: 'none',
          created_at: createdAt,
          type: 'scale',
          last_recorded_at: lastRecordedAtScale,
        },
        {
          deed_item_id: 20,
          deed_id: 5,
          parent_deed_item_id: null,
          name: 'Count Deed',
          description: null,
          display_order: 2,
          hide_type: 'none',
          created_at: createdAt,
          type: 'count',
          last_recorded_at: lastRecordedAtCount,
        },
        {
          deed_item_id: 30,
          deed_id: 5,
          parent_deed_item_id: null,
          name: 'Unrecorded Deed',
          description: null,
          display_order: 3,
          hide_type: 'none',
          created_at: createdAt,
          type: null,
          last_recorded_at: null,
        },
      ]);

    await request(app.getHttpServer())
      .get('/deeds/hasanaat/items')
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([
          {
            deed_item_id: 10,
            deed_id: 5,
            parent_deed_item_id: null,
            name: 'Scale Deed',
            description: 'Scale Deed description',
            display_order: 1,
            hide_type: 'none',
            created_at: createdAt.toISOString(),
            type: 'scale',
            last_recorded_at: lastRecordedAtScale.toISOString(),
          },
          {
            deed_item_id: 20,
            deed_id: 5,
            parent_deed_item_id: null,
            name: 'Count Deed',
            description: null,
            display_order: 2,
            hide_type: 'none',
            created_at: createdAt.toISOString(),
            type: 'count',
            last_recorded_at: lastRecordedAtCount.toISOString(),
          },
          {
            deed_item_id: 30,
            deed_id: 5,
            parent_deed_item_id: null,
            name: 'Unrecorded Deed',
            description: null,
            display_order: 3,
            hide_type: 'none',
            created_at: createdAt.toISOString(),
            type: null,
            last_recorded_at: null,
          },
        ]);
      });

    expect(postgresQueryMock).toHaveBeenCalledTimes(2);
  });
});

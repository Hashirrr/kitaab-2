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

describe('RecordsController (e2e) - GET /records/:date', () => {
  let app: INestApplication<App>;

  const postgresQueryMock = jest.fn();
  const jwtVerifyAsyncMock = jest.fn();
  const configGetMock = jest.fn();

  const targetDate = '2026-03-15';
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
      .get(`/records/${targetDate}`)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 401, not 500, when token invalid', async () => {
    jwtVerifyAsyncMock.mockRejectedValueOnce(new Error('jwt malformed'));

    const response = await request(app.getHttpServer())
      .get(`/records/${targetDate}`)
      .set('Authorization', 'Bearer bad-token')
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 401, not 500, when token type is not access', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce({
      ...accessTokenPayload,
      type: 'refresh',
    });

    const response = await request(app.getHttpServer())
      .get(`/records/${targetDate}`)
      .set('Authorization', 'Bearer refresh-token')
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when date format is not YYYY-MM-DD', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .get('/records/15-03-2026')
      .set('Authorization', 'Bearer access-token')
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when date string is invalid date like 2026-99-99', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .get('/records/2026-99-99')
      .set('Authorization', 'Bearer access-token')
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 200 returns an empty array when no records exist for date', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock.mockResolvedValueOnce([]);

    await request(app.getHttpServer())
      .get(`/records/${targetDate}`)
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([]);
      });

    expect(postgresQueryMock).toHaveBeenCalledTimes(1);

    const [, queryParams] = postgresQueryMock.mock.calls[0];
    expect(queryParams).toEqual([1, targetDate]);
  });

  it('-> 200 returns records for date on happy path', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const createdAt = new Date('2026-03-15T12:00:00.000Z');
    const mockRecords = [
      {
        record_id: 1,
        user_id: 1,
        deed_item_id: 10,
        date: targetDate,
        scale_item_id: 3,
        count_value: null,
        created_at: createdAt,
      },
      {
        record_id: 2,
        user_id: 1,
        deed_item_id: 20,
        date: targetDate,
        scale_item_id: null,
        count_value: 5,
        created_at: createdAt,
      },
    ];

    postgresQueryMock.mockResolvedValueOnce(mockRecords);

    await request(app.getHttpServer())
      .get(`/records/${targetDate}`)
      .set('Authorization', 'Bearer access-token')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual([
          {
            record_id: 1,
            user_id: 1,
            deed_item_id: 10,
            date: targetDate,
            scale_item_id: 3,
            count_value: null,
            created_at: createdAt.toISOString(),
          },
          {
            record_id: 2,
            user_id: 1,
            deed_item_id: 20,
            date: targetDate,
            scale_item_id: null,
            count_value: 5,
            created_at: createdAt.toISOString(),
          },
        ]);
      });

    expect(postgresQueryMock).toHaveBeenCalledTimes(1);
  });
});

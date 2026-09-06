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
import { TransactionClient } from '../../src/database/postgres/postgres.interface';

describe('RecordsController (e2e) - POST /records', () => {
  let app: INestApplication<App>;

  const postgresQueryMock = jest.fn();
  const postgresTransactionMock = jest.fn();
  const jwtVerifyAsyncMock = jest.fn();
  const configGetMock = jest.fn();

  const accessTokenPayload = {
    sub: 1,
    email: 'muhammad@example.com',
    type: 'access',
    email_verified: true,
  };

  const validScalePayload = {
    records: [
      {
        deed_item_id: 10,
        date: '2026-03-15',
        scale_item_id: 3,
      },
    ],
  };

  const validCountPayload = {
    records: [
      {
        deed_item_id: 10,
        date: '2026-03-15',
        count_value: 5,
      },
    ],
  };

  beforeEach(async () => {
    postgresQueryMock.mockReset();
    postgresTransactionMock.mockReset();
    jwtVerifyAsyncMock.mockReset();
    configGetMock.mockReset();

    configGetMock.mockImplementation((key: string) => {
      const table: Record<string, string> = {
        JWT_PUBLIC_KEY: 'test-public',
      };
      return table[key];
    });

    postgresTransactionMock.mockImplementation(async (callback: (client: TransactionClient) => Promise<unknown>) =>
      callback({ query: postgresQueryMock }),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PostgresService)
      .useValue({
        query: postgresQueryMock,
        transaction: postgresTransactionMock,
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
      .post('/records')
      .send(validScalePayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 401, not 500, when token invalid', async () => {
    jwtVerifyAsyncMock.mockRejectedValueOnce(new Error('jwt malformed'));

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer bad-token')
      .send(validScalePayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 401, not 500, when token type is not access', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce({
      ...accessTokenPayload,
      type: 'refresh',
    });

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer refresh-token')
      .send(validScalePayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when records array is empty', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send({ records: [] })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when date is invalid in record', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send({
        records: [
          {
            deed_item_id: 10,
            date: 'not-a-date',
            count_value: 3,
          },
        ],
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when payload contains unknown properties', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send({
        records: [
          {
            deed_item_id: 10,
            date: '2026-03-15',
            count_value: 3,
            unexpected_field: true,
          },
        ],
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when record has both scale_item_id and count_value', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send({
        records: [
          {
            deed_item_id: 10,
            date: '2026-03-15',
            scale_item_id: 3,
            count_value: 5,
          },
        ],
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when record has neither scale_item_id nor count_value', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send({
        records: [
          {
            deed_item_id: 10,
            date: '2026-03-15',
          },
        ],
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 404, not 500, when one or more deed items not found', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock.mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send(validScalePayload)
      .expect(404);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(1);
  });

  it('-> 404, not 500, when one or more scale items not found', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_item_id: 10 }])
      .mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send(validScalePayload)
      .expect(404);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(2);
  });

  it('-> 204 creates record with scale_item_id on happy path', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_item_id: 10 }])
      .mockResolvedValueOnce([{ scale_items_id: 3 }])
      .mockResolvedValueOnce([]);

    await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send(validScalePayload)
      .expect(204);

    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(3);

    const [, deedCheckParams] = postgresQueryMock.mock.calls[0];
    expect(deedCheckParams).toEqual([1, [10]]);

    const [, scaleCheckParams] = postgresQueryMock.mock.calls[1];
    expect(scaleCheckParams).toEqual([[3]]);

    const [, insertParams] = postgresQueryMock.mock.calls[2];
    expect(insertParams).toEqual([1, [10], ['2026-03-15'], [3], [null]]);
  });

  it('-> 204 creates record with count_value on happy path', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_item_id: 10 }])
      .mockResolvedValueOnce([]);

    await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send(validCountPayload)
      .expect(204);

    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(2);

    const [, insertParams] = postgresQueryMock.mock.calls[1];
    expect(insertParams).toEqual([1, [10], ['2026-03-15'], [null], [5]]);
  });

  it('-> 204 creates multiple records in a batch', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_item_id: 10 }, { deed_item_id: 20 }])
      .mockResolvedValueOnce([{ scale_items_id: 3 }])
      .mockResolvedValueOnce([]);

    const batchPayload = {
      records: [
        {
          deed_item_id: 10,
          date: '2026-03-15',
          scale_item_id: 3,
        },
        {
          deed_item_id: 20,
          date: '2026-03-15',
          count_value: 10,
        },
      ],
    };

    await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', 'Bearer access-token')
      .send(batchPayload)
      .expect(204);

    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(3);

    const [, insertParams] = postgresQueryMock.mock.calls[2];
    expect(insertParams).toEqual([
      1,
      [10, 20],
      ['2026-03-15', '2026-03-15'],
      [3, null],
      [null, 10],
    ]);
  });
});

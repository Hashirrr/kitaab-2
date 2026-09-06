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

describe('RecordsController (e2e) - DELETE /records', () => {
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

  const validPayload = {
    record_ids: [10, 20],
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
      .delete('/records')
      .send(validPayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 401, not 500, when token invalid', async () => {
    jwtVerifyAsyncMock.mockRejectedValueOnce(new Error('jwt malformed'));

    const response = await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer bad-token')
      .send(validPayload)
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
      .delete('/records')
      .set('Authorization', 'Bearer refresh-token')
      .send(validPayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when record_ids array is empty', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer access-token')
      .send({ record_ids: [] })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when record_ids contains non-numeric values', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer access-token')
      .send({ record_ids: ['abc'] })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when record_ids contains non-positive numbers', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer access-token')
      .send({ record_ids: [0] })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when duplicate record_ids are sent', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer access-token')
      .send({ record_ids: [10, 10] })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when payload contains unknown properties', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer access-token')
      .send({ record_ids: [10], unexpected_field: true })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 404, not 500, when one or more records not found', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock.mockResolvedValueOnce([{ record_id: 10 }]);

    const response = await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(404);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(1);
  });

  it('-> 204 deletes single record via bulk delete on happy path', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock.mockResolvedValueOnce([{ record_id: 10 }]);

    await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer access-token')
      .send({ record_ids: [10] })
      .expect(204);

    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(1);

    const [, deleteParams] = postgresQueryMock.mock.calls[0];
    expect(deleteParams).toEqual([1, [10]]);
  });

  it('-> 204 deletes multiple records in bulk on happy path', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock.mockResolvedValueOnce([{ record_id: 10 }, { record_id: 20 }]);

    await request(app.getHttpServer())
      .delete('/records')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(204);

    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(1);

    const [, deleteParams] = postgresQueryMock.mock.calls[0];
    expect(deleteParams).toEqual([1, [10, 20]]);
  });
});

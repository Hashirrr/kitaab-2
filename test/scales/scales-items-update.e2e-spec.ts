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

describe('ScalesController (e2e) - PATCH /scales/:deed_item_id/items/:scale_item_id', () => {
  let app: INestApplication<App>;

  const postgresQueryMock = jest.fn();
  const postgresTransactionMock = jest.fn();
  const jwtVerifyAsyncMock = jest.fn();
  const configGetMock = jest.fn();

  const deedItemId = 10;
  const scaleItemId = 5;
  const accessTokenPayload = {
    sub: 1,
    email: 'muhammad@example.com',
    type: 'access',
    email_verified: true,
  };

  const validPayload = {
    name: 'Updated Scale Name',
    description: 'Updated scale description',
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
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .send(validPayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 401, not 500, when token invalid', async () => {
    jwtVerifyAsyncMock.mockRejectedValueOnce(new Error('jwt malformed'));

    const response = await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
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
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .set('Authorization', 'Bearer refresh-token')
      .send(validPayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when deed_item_id is not numeric', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .patch(`/scales/not-a-number/items/${scaleItemId}`)
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when scale_item_id is not numeric', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/not-a-number`)
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when payload has no fields to update', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .set('Authorization', 'Bearer access-token')
      .send({})
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when payload contains unknown fields', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);

    const response = await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .set('Authorization', 'Bearer access-token')
      .send({ ...validPayload, extra_field: 123 })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when deed item is not a root item', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ deed_item_id: deedItemId }]);

    const response = await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(2);
  });

  it('-> 404, not 500, when root deed item not found', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(404);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(2);
  });

  it('-> 404, not 500, when scale item not found', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_item_id: deedItemId }])
      .mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(404);

    expect(response.status).not.toBe(500);
    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(2);
  });

  it('-> 204 updates scale item on happy path with name and description', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_item_id: deedItemId }])
      .mockResolvedValueOnce([{ scale_items_id: scaleItemId }]);

    await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(204);

    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(2);

    const [updateSql, updateParams] = postgresQueryMock.mock.calls[1];
    expect(updateSql).toContain('name = $1');
    expect(updateSql).toContain('description = $2');
    expect(updateParams).toEqual([validPayload.name, validPayload.description, scaleItemId, deedItemId]);
  });

  it('-> 204 updates scale item with name only', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(accessTokenPayload);
    postgresQueryMock
      .mockResolvedValueOnce([{ deed_item_id: deedItemId }])
      .mockResolvedValueOnce([{ scale_items_id: scaleItemId }]);

    await request(app.getHttpServer())
      .patch(`/scales/${deedItemId}/items/${scaleItemId}`)
      .set('Authorization', 'Bearer access-token')
      .send({ name: 'Only Name' })
      .expect(204);

    expect(postgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(postgresQueryMock).toHaveBeenCalledTimes(2);

    const [updateSql, updateParams] = postgresQueryMock.mock.calls[1];
    expect(updateSql).toContain('name = $1');
    expect(updateSql).not.toContain('description =');
    expect(updateParams).toEqual(['Only Name', scaleItemId, deedItemId]);
  });
});

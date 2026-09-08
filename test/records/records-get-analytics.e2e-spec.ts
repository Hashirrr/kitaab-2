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

describe('RecordsController (e2e) - POST /records/analytics', () => {
  let app: INestApplication<App>;

  const postgresQueryMock = jest.fn();
  const jwtVerifyAsyncMock = jest.fn();
  const configGetMock = jest.fn();

  const startDate = '2026-03-01';
  const endDate = '2026-03-15';

  const accessTokenPayload = {
    sub: 1,
    email: 'muhammad@example.com',
    type: 'access',
    email_verified: true,
  };

  const validPayload = {
    start_date: startDate,
    end_date: endDate,
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

    const moduleFixture: TestingModule =
      await Test.createTestingModule({
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
      new JwtAuthGuard(
        logger,
        app.get(JwtService),
        app.get(ConfigService),
      ),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------

  it('-> 401, not 500, when Authorization header is missing', async () => {
    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .send(validPayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 401, not 500, when token is invalid', async () => {
    jwtVerifyAsyncMock.mockRejectedValueOnce(
      new Error('jwt malformed'),
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer bad-token')
      .send(validPayload)
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
      .post('/records/analytics')
      .set('Authorization', 'Bearer refresh-token')
      .send(validPayload)
      .expect(401);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------
  // VALIDATION
  // ---------------------------------------------------------

  it('-> 400, not 500, when start_date is missing', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({
        end_date: endDate,
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when end_date is missing', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({
        start_date: startDate,
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when both dates are missing', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({})
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when start_date has invalid format', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({
        start_date: '01-03-2026',
        end_date: endDate,
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when end_date has invalid format', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({
        start_date: startDate,
        end_date: '15-03-2026',
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when start_date is invalid date', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({
        start_date: '2026-99-99',
        end_date: endDate,
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when end_date is invalid date', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({
        start_date: startDate,
        end_date: '2026-99-99',
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when start_date is greater than end_date', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({
        start_date: '2026-03-20',
        end_date: '2026-03-01',
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  it('-> 400, not 500, when unknown fields are provided', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send({
        ...validPayload,
        invalid_field: 'test',
      })
      .expect(400);

    expect(response.status).not.toBe(500);
    expect(postgresQueryMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------
  // EMPTY RESULT
  // ---------------------------------------------------------

  it('-> 200, not 500, when no deeds exist', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    postgresQueryMock.mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(200);

    expect(response.status).not.toBe(500);
    expect(response.body).toEqual([]);
    expect(postgresQueryMock).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------
  // COUNT DEED
  // ---------------------------------------------------------

  it('-> 200, not 500, for count deed', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    postgresQueryMock.mockResolvedValueOnce([
      {
        deed_item_id: 10,
        deed_name: 'Tasbeeh',
        deed_type: 'count',
        date: '2026-03-01',
        count_value: 343,
        scale_item_id: null,
        scale_name: null,
      },
      {
        deed_item_id: 10,
        deed_name: 'Tasbeeh',
        deed_type: 'count',
        date: '2026-03-02',
        count_value: 109,
        scale_item_id: null,
        scale_name: null,
      },
      {
        deed_item_id: 10,
        deed_name: 'Tasbeeh',
        deed_type: 'count',
        date: '2026-03-03',
        count_value: 34,
        scale_item_id: null,
        scale_name: null,
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(200);

    expect(response.status).not.toBe(500);

    expect(response.body).toEqual([
      {
        deed_item_id: 10,
        name: 'Tasbeeh',
        type: 'count',
        data: [
          {
            date: '2026-03-01',
            count: 343,
          },
          {
            date: '2026-03-02',
            count: 109,
          },
          {
            date: '2026-03-03',
            count: 34,
          },
        ],
      },
    ]);
  });

  // ---------------------------------------------------------
  // COUNT DEED WITH NULL RECORD
  // ---------------------------------------------------------

  it('-> 200, not 500, when count deed has no record in date range', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    postgresQueryMock.mockResolvedValueOnce([
      {
        deed_item_id: 10,
        deed_name: 'Tasbeeh',
        deed_type: 'count',
        date: null,
        count_value: null,
        scale_item_id: null,
        scale_name: null,
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(200);

    expect(response.status).not.toBe(500);

    expect(response.body).toEqual([
      {
        deed_item_id: 10,
        name: 'Tasbeeh',
        type: 'count',
        data: [],
      },
    ]);
  });

  // ---------------------------------------------------------
  // SCALE DEED
  // ---------------------------------------------------------

  it('-> 200, not 500, for scale deed', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    postgresQueryMock.mockResolvedValueOnce([
      {
        deed_item_id: 20,
        deed_name: 'Sadaqah',
        deed_type: 'scale',
        date: '2026-03-01',
        count_value: null,
        scale_item_id: 1,
        scale_name: 'Yes',
      },
      {
        deed_item_id: 20,
        deed_name: 'Sadaqah',
        deed_type: 'scale',
        date: '2026-03-02',
        count_value: null,
        scale_item_id: 2,
        scale_name: 'No',
      },
      {
        deed_item_id: 20,
        deed_name: 'Sadaqah',
        deed_type: 'scale',
        date: '2026-03-03',
        count_value: null,
        scale_item_id: 2,
        scale_name: 'No',
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(200);

    expect(response.status).not.toBe(500);

    expect(response.body).toEqual([
      {
        deed_item_id: 20,
        name: 'Sadaqah',
        type: 'scale',
        data: [
          {
            name: 'Yes',
            percentage: 33.33,
          },
          {
            name: 'No',
            percentage: 66.67,
          },
        ],
      },
    ]);
  });

  // ---------------------------------------------------------
  // MIXED COUNT + SCALE
  // ---------------------------------------------------------

  it('-> 200, not 500, for count and scale deeds together', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    postgresQueryMock.mockResolvedValueOnce([
      {
        deed_item_id: 10,
        deed_name: 'Tasbeeh',
        deed_type: 'count',
        date: '2026-03-01',
        count_value: 343,
        scale_item_id: null,
        scale_name: null,
      },
      {
        deed_item_id: 10,
        deed_name: 'Tasbeeh',
        deed_type: 'count',
        date: '2026-03-02',
        count_value: 109,
        scale_item_id: null,
        scale_name: null,
      },
      {
        deed_item_id: 20,
        deed_name: 'Sadaqah',
        deed_type: 'scale',
        date: '2026-03-01',
        count_value: null,
        scale_item_id: 1,
        scale_name: 'Yes',
      },
      {
        deed_item_id: 20,
        deed_name: 'Sadaqah',
        deed_type: 'scale',
        date: '2026-03-02',
        count_value: null,
        scale_item_id: 2,
        scale_name: 'No',
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(200);

    expect(response.status).not.toBe(500);

    expect(response.body).toEqual([
      {
        deed_item_id: 10,
        name: 'Tasbeeh',
        type: 'count',
        data: [
          {
            date: '2026-03-01',
            count: 343,
          },
          {
            date: '2026-03-02',
            count: 109,
          },
        ],
      },
      {
        deed_item_id: 20,
        name: 'Sadaqah',
        type: 'scale',
        data: [
          {
            name: 'Yes',
            percentage: 50,
          },
          {
            name: 'No',
            percentage: 50,
          },
        ],
      },
    ]);
  });

  // ---------------------------------------------------------
  // SCALE WITH NULL SCALE
  // ---------------------------------------------------------

  it('-> 200, not 500, when scale deed has null scale item', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    postgresQueryMock.mockResolvedValueOnce([
      {
        deed_item_id: 20,
        deed_name: 'Sadaqah',
        deed_type: 'scale',
        date: '2026-03-01',
        count_value: null,
        scale_item_id: null,
        scale_name: null,
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(200);

    expect(response.status).not.toBe(500);

    expect(response.body).toEqual([
      {
        deed_item_id: 20,
        name: 'Sadaqah',
        type: 'scale',
        data: [],
      },
    ]);
  });

  // ---------------------------------------------------------
  // DATABASE ERROR
  // ---------------------------------------------------------

  it('-> 500 when database query fails', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    postgresQueryMock.mockRejectedValueOnce(
      new Error('database connection failed'),
    );

    const response = await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(500);

    expect(response.status).toBe(500);
  });

  // ---------------------------------------------------------
  // DATE RANGE PASSED CORRECTLY
  // ---------------------------------------------------------

  it('-> sends user id, start date and end date to database', async () => {
    jwtVerifyAsyncMock.mockResolvedValueOnce(
      accessTokenPayload,
    );

    postgresQueryMock.mockResolvedValueOnce([]);

    await request(app.getHttpServer())
      .post('/records/analytics')
      .set('Authorization', 'Bearer access-token')
      .send(validPayload)
      .expect(200);

    expect(postgresQueryMock).toHaveBeenCalledTimes(1);

    const [, queryParams] =
      postgresQueryMock.mock.calls[0];

    expect(queryParams).toEqual([
      1,
      startDate,
      endDate,
    ]);
  });
});
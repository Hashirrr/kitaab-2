import { Logger } from '../logger/logger.service';
import { CreateRecordsDto, DeleteRecordsDto } from './records.dto';
import type { AuthenticatedRequest } from '../auth/auth.interface';
import { PostgresService } from '../database/postgres/postgres.service';
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DeedItemOwnerQueryInterface, RecordResult, ScaleItemOwnerQueryInterface } from './records.interface';

@Injectable()
export class RecordsService {

  constructor(
    private readonly loggerService: Logger,
    private readonly postgresService: PostgresService
  ) { }

  async createRecords(payload: CreateRecordsDto, req: AuthenticatedRequest): Promise<void> {
    try {
      this.loggerService.log('createRecords {controller}');
      const { sub: user_id, type: token_type } = req.user;
      if (token_type !== 'access') {
        this.loggerService.error('Invalid token type', HttpStatus.UNAUTHORIZED);
        throw new HttpException('Invalid token type', HttpStatus.UNAUTHORIZED);
      }

      const { records } = payload;
      for (const record of records) {
        const hasScale = record.scale_item_id !== undefined && record.scale_item_id !== null;
        const hasCount = record.count_value !== undefined && record.count_value !== null;
        if ((hasScale && hasCount) || (!hasScale && !hasCount)) {
          this.loggerService.error('Record must contain either scale_item_id or count_value', HttpStatus.BAD_REQUEST);
          throw new HttpException('Record must contain either scale_item_id or count_value', HttpStatus.BAD_REQUEST);
        }
      }

      const deedItemIds = [...new Set(records.map((r) => r.deed_item_id))];
      const scaleItemIds = [...new Set(records.map((r) => r.scale_item_id).filter((id): id is number => id !== undefined && id !== null))];

      await this.postgresService.transaction(async (client) => {
        const deedRows = await client.query<DeedItemOwnerQueryInterface>(`
          SELECT di.deed_item_id
          FROM deed_items di
          INNER JOIN deeds d ON d.deed_id = di.deed_id
          WHERE d.user_id = $1
            AND di.deed_item_id = ANY($2::bigint[])
        `, [user_id, deedItemIds]);

        if (deedRows.length !== deedItemIds.length) {
          this.loggerService.error('One or more deed items not found', HttpStatus.NOT_FOUND);
          throw new HttpException('One or more deed items not found', HttpStatus.NOT_FOUND);
        }

        if (scaleItemIds.length > 0) {
          const scaleRows = await client.query<ScaleItemOwnerQueryInterface>(`
            SELECT si.scale_items_id
            FROM scale_items si
            WHERE si.scale_items_id = ANY($1::bigint[])
          `, [scaleItemIds]);

          if (scaleRows.length !== scaleItemIds.length) {
            this.loggerService.error('One or more scale items not found', HttpStatus.NOT_FOUND);
            throw new HttpException('One or more scale items not found', HttpStatus.NOT_FOUND);
          }
        }

        await client.query(`
          INSERT INTO records (user_id, deed_item_id, date, scale_item_id, count_value)
          SELECT
            $1,
            rows.deed_item_id,
            rows.date,
            rows.scale_item_id,
            rows.count_value
          FROM unnest(
            $2::bigint[],
            $3::date[],
            $4::bigint[],
            $5::numeric[]
          ) AS rows(deed_item_id, date, scale_item_id, count_value)
          ON CONFLICT (user_id, deed_item_id, date)
          DO UPDATE SET
            scale_item_id = EXCLUDED.scale_item_id,
            count_value = EXCLUDED.count_value
        `, [
          user_id,
          records.map((r) => r.deed_item_id),
          records.map((r) => r.date),
          records.map((r) => r.scale_item_id ?? null),
          records.map((r) => r.count_value ?? null)
        ]);
      });
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getRecordsByDate(date: string, req: AuthenticatedRequest): Promise<RecordResult[]> {
    try {
      this.loggerService.log('getRecordsByDate {controller}');
      const { sub: user_id, type: token_type } = req.user;
      if (token_type !== 'access') {
        this.loggerService.error('Invalid token type', HttpStatus.UNAUTHORIZED);
        throw new HttpException('Invalid token type', HttpStatus.UNAUTHORIZED);
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
        this.loggerService.error('Invalid date format', HttpStatus.BAD_REQUEST);
        throw new HttpException('Invalid date format', HttpStatus.BAD_REQUEST);
      }

      return await this.postgresService.query<RecordResult>(`
        SELECT record_id, user_id, deed_item_id, date, scale_item_id, count_value, created_at
        FROM records
        WHERE user_id = $1
          AND date = $2::date
        ORDER BY record_id ASC
      `, [user_id, date]);
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteRecords(payload: DeleteRecordsDto, req: AuthenticatedRequest): Promise<void> {
    try {
      this.loggerService.log('deleteRecords {controller}');
      const { sub: user_id, type: token_type } = req.user;
      if (token_type !== 'access') {
        this.loggerService.error('Invalid token type', HttpStatus.UNAUTHORIZED);
        throw new HttpException('Invalid token type', HttpStatus.UNAUTHORIZED);
      }

      const { record_ids } = payload;
      if (new Set(record_ids).size !== record_ids.length) {
        this.loggerService.error('Duplicate record ids in payload', HttpStatus.BAD_REQUEST);
        throw new HttpException('Duplicate record ids in payload', HttpStatus.BAD_REQUEST);
      }

      await this.postgresService.transaction(async (client) => {
        const rows = await client.query<{ record_id: number }>(`
          DELETE FROM records
          WHERE user_id = $1
            AND record_id = ANY($2::bigint[])
          RETURNING record_id
        `, [user_id, record_ids]);

        if (rows.length !== record_ids.length) {
          this.loggerService.error('One or more records not found', HttpStatus.NOT_FOUND);
          throw new HttpException('One or more records not found', HttpStatus.NOT_FOUND);
        }
      });
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
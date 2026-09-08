import { Logger } from '../logger/logger.service';
import { RedisService } from '../database/redis/redis.service';
import type { AuthenticatedRequest } from '../auth/auth.interface';
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PostgresService } from '../database/postgres/postgres.service';
import { TransactionClient } from '../database/postgres/postgres.interface';
import { UserTableRow, VisitorAssociationRow } from '../users/users.interface';
import { CreateDeedItemDto, DeedAnalyticsDto, ReorderDeedItemsDto, UpdateDeedItemDto } from './deeds.dto';
import { DeedCategoryType, DeedItemQueryInterface, DeedItemResult, DeedQueryInterface, DeedRatioResponse, DeedTableResponse, DeedTableRow, FlatDeedItemNode, ParentDeedAssociationResponse, UsersAssociationResponse, VisitorsAssociationResponse } from './deeds.interface';

@Injectable()
export class DeedsService {

  constructor(
    private readonly loggerService: Logger,
    private readonly redisService: RedisService,
    private readonly postgresService: PostgresService
  ) {}

  async createDeedItem(category: string, payload: CreateDeedItemDto, req: AuthenticatedRequest): Promise<void> {
    try {
      this.loggerService.log('createDeedItem {controller}');
      const { sub: user_id, type: token_type } = req.user;
      if (token_type !== 'access') {
        this.loggerService.error('Invalid token type', HttpStatus.UNAUTHORIZED);
        throw new HttpException('Invalid token type', HttpStatus.UNAUTHORIZED);
      }
      if (!(category === 'hasanaat' || category === 'saiyyiaat')) {
        this.loggerService.error('Invalid deed category', HttpStatus.BAD_REQUEST);
        throw new HttpException('Invalid deed category', HttpStatus.BAD_REQUEST);
      }
      const flat = this.flattenDeedItemTree(payload, null);
      await this.postgresService.transaction(async (client) => {
        const deed_id = await this.getUserDeedId(client, user_id, category);
        const parent_deed_item_id = payload.parent_deed_item_id ?? null;
        if (parent_deed_item_id !== null) {
          const rows = await client.query<DeedItemQueryInterface>(`
            SELECT deed_item_id
            FROM deed_items
            WHERE deed_item_id = $1
              AND deed_id = $2
          `, [parent_deed_item_id, deed_id]);
          if (!rows?.length) {
            this.loggerService.error('Parent deed item not found', HttpStatus.NOT_FOUND);
            throw new HttpException('Parent deed item not found', HttpStatus.NOT_FOUND);
          }
        }
        await this.bulkInsertDeedItemTree(client, deed_id, parent_deed_item_id, flat);
        this.redisService.incrementBy('report:new_deeds', 1)
          .catch((error) => this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR));
        this.redisService.incrementInHash('report:deed_categories', category, 1)
          .catch((error) => this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR));  
      });
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async reorderDeedItems(category: string, payload: ReorderDeedItemsDto, req: AuthenticatedRequest): Promise<void> {
    try {
      this.loggerService.log('reorderDeedItems {controller}');
      const { sub: user_id, type: token_type } = req.user;
      if (token_type !== 'access') {
        this.loggerService.error('Invalid token type', HttpStatus.UNAUTHORIZED);
        throw new HttpException('Invalid token type', HttpStatus.UNAUTHORIZED);
      }
      if (!(category === 'hasanaat' || category === 'saiyyiaat')) {
        this.loggerService.error('Invalid deed category', HttpStatus.BAD_REQUEST);
        throw new HttpException('Invalid deed category', HttpStatus.BAD_REQUEST);
      }
      const { display_order: ids, parent_deed_item_id } = payload;
      if (new Set(ids).size !== ids.length) {
        this.loggerService.error('Duplicate deed item ids in display_order', HttpStatus.BAD_REQUEST);
        throw new HttpException('Duplicate deed item ids in display_order', HttpStatus.BAD_REQUEST);
      }
      return await this.postgresService.transaction(async (client) => {
        const deed_id = await this.getUserDeedId(client, user_id, category);
        const rows = await client.query<DeedItemQueryInterface>(`
          SELECT deed_item_id
          FROM deed_items
          WHERE deed_id = $1
            AND parent_deed_item_id IS NOT DISTINCT FROM $3
            AND deed_item_id = ANY($2::bigint[])
        `, [deed_id, ids, parent_deed_item_id]);
        if (rows.length !== ids.length) {
          this.loggerService.error('One or more level-1 deed items not found', HttpStatus.NOT_FOUND);
          throw new HttpException('One or more level-1 deed items not found', HttpStatus.NOT_FOUND);
        }
        await client.query(`
          UPDATE deed_items di
          SET display_order = array_position($2::bigint[], di.deed_item_id)
          WHERE di.deed_id = $1
            AND di.parent_deed_item_id IS NOT DISTINCT FROM $3
            AND di.deed_item_id = ANY($2::bigint[])
        `, [deed_id, ids, parent_deed_item_id]);
      });
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteDeedItem(category: string, deed_item_id: number, req: AuthenticatedRequest): Promise<void> {
    try {
      this.loggerService.log('deleteDeedItem {controller}');
      const { sub: user_id, type: token_type } = req.user;
      if (token_type !== 'access') {
        this.loggerService.error('Invalid token type', HttpStatus.UNAUTHORIZED);
        throw new HttpException('Invalid token type', HttpStatus.UNAUTHORIZED);
      }
      if (!(category === 'hasanaat' || category === 'saiyyiaat')) {
        this.loggerService.error('Invalid deed category', HttpStatus.BAD_REQUEST);
        throw new HttpException('Invalid deed category', HttpStatus.BAD_REQUEST);
      }
      await this.postgresService.transaction(async (client) => {
        const deed_id = await this.getUserDeedId(client, user_id, category);
        const rows = await client.query<DeedItemQueryInterface>(`
          DELETE FROM deed_items
          WHERE deed_item_id = $1
            AND deed_id = $2
          RETURNING deed_item_id
        `, [deed_item_id, deed_id]);
        if (!rows?.length) {
          this.loggerService.error('Deed item not found', HttpStatus.NOT_FOUND);
          throw new HttpException('Deed item not found', HttpStatus.NOT_FOUND);
        }
      });
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDeedItems(category: string, req: AuthenticatedRequest): Promise<DeedItemResult[]> {
    try {
      this.loggerService.log('getDeedItems {controller}');
      const { sub: user_id, type: token_type } = req.user;
      if (token_type !== 'access') {
        this.loggerService.error('Invalid token type', HttpStatus.UNAUTHORIZED);
        throw new HttpException('Invalid token type', HttpStatus.UNAUTHORIZED);
      }
      if (!(category === 'hasanaat' || category === 'saiyyiaat')) {
        this.loggerService.error('Invalid deed category', HttpStatus.BAD_REQUEST);
        throw new HttpException('Invalid deed category', HttpStatus.BAD_REQUEST);
      }
      const deed_id = await this.getUserDeedId(this.postgresService, user_id, category);
      const rows = await this.postgresService.query<DeedItemResult>(`
        SELECT di.deed_item_id, di.deed_id, di.parent_deed_item_id, di.name, di.description, di.display_order, di.hide_type, di.created_at, lr.last_recorded_at, lr.type
        FROM deed_items di
        LEFT JOIN LATERAL (
          SELECT
            r.created_at AS last_recorded_at,
            CASE
              WHEN r.scale_item_id IS NOT NULL THEN 'scale'
              WHEN r.count_value IS NOT NULL THEN 'count'
              ELSE NULL
            END AS type
          FROM records r
          WHERE r.deed_item_id = di.deed_item_id
            AND r.user_id = $2
          ORDER BY r.date DESC, r.created_at DESC, r.record_id DESC
          LIMIT 1
        ) lr ON true
        WHERE di.deed_id = $1
        ORDER BY di.display_order ASC, di.deed_item_id ASC
      `, [deed_id, user_id]);
      const itemsById = new Map<number, DeedItemResult>();
      for (const row of rows)
        itemsById.set(row.deed_item_id, { ...row, children: undefined });
  
      const roots: DeedItemResult[] = [];
      for (const row of rows) {
        itemsById.set(row.deed_item_id, { ...row });
      }
      for (const item of itemsById.values()) {
        if (item.parent_deed_item_id === null) {
          roots.push(item);
          continue;
        }
        const parent = itemsById.get(item.parent_deed_item_id);
        if (!parent) {
          roots.push(item);
          continue;
        }
        parent.children ??= [];
        parent.children.push(item);
      }
      
      const populateParentData = (item: DeedItemResult): void => {
        if (!item.children?.length) return;
      
        for (const child of item.children)
          populateParentData(child);
      
        const latestChild = item.children
          .filter((child) => child.last_recorded_at)
          .sort((a, b) =>
            new Date(b.last_recorded_at!).getTime() - new Date(a.last_recorded_at!).getTime()
          )[0];
      
        item.last_recorded_at = latestChild?.last_recorded_at ?? null;
      
        const childTypes = new Set(item.children.map((child) => child.type).filter((type) => type !== null));
      
        if (childTypes.has('scale')) {
          item.type = 'scale';
        } else if (childTypes.has('count')) {
          item.type = 'count';
        }
      
        for (const child of item.children) delete child.type;
      };
  
      for (const root of roots) {
        populateParentData(root);
  
        if (root.children?.length)
          for (const child of root.children) delete child.type;
      }

      return roots;
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateDeedItem(category: string, deed_item_id: number, payload: UpdateDeedItemDto, req: AuthenticatedRequest): Promise<void> {
    try {
      this.loggerService.log('updateDeedItem {controller}');
      const { name, description, hide_type } = payload;
      const { sub: user_id, type: token_type } = req.user;
      if (token_type !== 'access') {
        this.loggerService.error('Invalid token type', HttpStatus.UNAUTHORIZED);
        throw new HttpException('Invalid token type', HttpStatus.UNAUTHORIZED);
      }
      if (!(category === 'hasanaat' || category === 'saiyyiaat')) {
        this.loggerService.error('Invalid deed category', HttpStatus.BAD_REQUEST);
        throw new HttpException('Invalid deed category', HttpStatus.BAD_REQUEST);
      }
      if (name === undefined && description === undefined && hide_type === undefined) {
        this.loggerService.error('Nothing to update', HttpStatus.BAD_REQUEST);
        throw new HttpException('Nothing to update', HttpStatus.BAD_REQUEST);
      }
      await this.postgresService.transaction(async (client) => {
        const deed_id = await this.getUserDeedId(client, user_id, category as DeedCategoryType);
        const updates: string[] = [];
        const params: any[] = [];
        let index = 1;
        if (name !== undefined) {
          updates.push(`name = $${index++}`);
          params.push(name);
        }
        if (description !== undefined) {
          updates.push(`description = $${index++}`);
          params.push(description);
        }
        if (hide_type !== undefined) {
          updates.push(`hide_type = $${index++}`);
          params.push(hide_type);
        }
        params.push(deed_item_id);
        params.push(deed_id);
        const rows = await client.query<{ deed_item_id: number }>(`
          UPDATE deed_items
          SET ${updates.join(', ')}
          WHERE deed_item_id = $${index++}
            AND deed_id = $${index}
          RETURNING deed_item_id
        `, params);
        if (!rows.length) {
          this.loggerService.error('Deed item not found', HttpStatus.NOT_FOUND);
          throw new HttpException('Deed item not found', HttpStatus.NOT_FOUND);
        }
      });
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deedAnalytics(query: DeedAnalyticsDto): Promise<DeedTableResponse | DeedRatioResponse | UsersAssociationResponse | VisitorsAssociationResponse | ParentDeedAssociationResponse> {
    try {
      this.loggerService.log('deedAnalytics {controller}');
      const { type, id, page = 1, limit = 20 } = query;
      if (type === 'deeds_table') {
        const offset = (page - 1) * limit;
        const [rows, [totals]] = await Promise.all([
          this.postgresService.query<DeedTableRow>(`
            SELECT deed_item_id, deed_id, parent_deed_item_id, display_order, hide_type, created_at
            FROM deed_items
            ORDER BY created_at DESC, deed_item_id DESC
            LIMIT $1 OFFSET $2;
          `, [limit, offset]),
          this.postgresService.query<{ total: number }>(`
            SELECT COUNT(*)::int AS total FROM deed_items;
          `)
        ]);
        return { rows, total: Number(totals?.total ?? 0), page, limit };
      }
      if (type === 'category') {
        const rows = await this.postgresService.query<{ category_type: string; count: number }>(`
          SELECT
          category_type,
          COUNT(*)::int AS count
            FROM deeds
            GROUP BY category_type
            ORDER BY count DESC, category_type ASC;
        `);
        const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
        return {
          total,
          distribution: rows.map((row) => ({
            category_type: row.category_type,
            count: Number(row.count),
            percentage: total === 0 ? 0 : Number(((Number(row.count) / total) * 100).toFixed(2))
          }))
        };
      }
      if (type === 'users_association') {
        if (!id) {
          this.loggerService.error('id is required for users_association', HttpStatus.BAD_REQUEST);
          throw new HttpException('id is required for users_association', HttpStatus.BAD_REQUEST);
        }
        const rows = await this.postgresService.query<UserTableRow>(`
          SELECT u.id, u.visitor_id, u.gender, u.dob, u.email_verified, u.two_factor_enabled, u.last_login_at, u.created_at
          FROM users u
          JOIN deeds d ON d.user_id = u.id
          JOIN deed_items di ON di.deed_id = d.deed_id
          WHERE di.deed_item_id = $1;
        `, [id]);
        return { id: Number(id), details: rows };
      }
      if (type === 'visitors_association') {
        if (!id) {
          this.loggerService.error('id is required for visitors_association', HttpStatus.BAD_REQUEST);
          throw new HttpException('id is required for visitors_association', HttpStatus.BAD_REQUEST);
        }
        const rows = await this.postgresService.query<VisitorAssociationRow>(`
          SELECT v.id, v.anonymous_id, v.timezone, v.device_type, v.clicks, v.navigations, v.number_of_visits, v.last_visited
          FROM visitors v
          JOIN users u ON u.visitor_id = v.id
          JOIN deeds d ON d.user_id = u.id
          JOIN deed_items di ON di.deed_id = d.deed_id
          WHERE di.deed_item_id = $1;
        `, [id]);
        return { id: Number(id), details: rows };
      }
      if (type === 'parent_deed_association') {
        if (!id) {
          this.loggerService.error('id is required for parent_deed_association', HttpStatus.BAD_REQUEST);
          throw new HttpException('id is required for parent_deed_association', HttpStatus.BAD_REQUEST);
        }
        const rows = await this.postgresService.query<DeedTableRow>(`
          SELECT parent.deed_item_id, parent.deed_id, parent.parent_deed_item_id, parent.display_order, parent.hide_type, parent.created_at
          FROM deed_items child
          JOIN deed_items parent ON parent.deed_item_id = child.parent_deed_item_id
          WHERE child.deed_item_id = $1;
        `, [id]);
        return { id: Number(id), details: rows };
      }
      this.loggerService.error('Invalid deed analytics type', HttpStatus.BAD_REQUEST);
      throw new HttpException('Invalid deed analytics type', HttpStatus.BAD_REQUEST);
    } catch (error) {
      this.loggerService.error(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
      throw new HttpException(error.message, error.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // helper functions

  private async getUserDeedId(client: TransactionClient, user_id: number, category: DeedCategoryType): Promise<number> {
    const rows = await client.query<DeedQueryInterface>(`
      SELECT deed_id
      FROM deeds
      WHERE user_id = $1
        AND category_type = $2::deed_category_type
    `, [user_id, category]);
    if (!rows?.length) {
      this.loggerService.error('Deed category not found', HttpStatus.NOT_FOUND);
      throw new HttpException('Deed category not found', HttpStatus.NOT_FOUND);
    }
    return rows[0].deed_id;
  }

  private flattenDeedItemTree(payload: CreateDeedItemDto, parent_index: number | null, flat: Omit<FlatDeedItemNode, 'index'>[] = []): FlatDeedItemNode[] {
    if (parent_index !== null && payload.parent_deed_item_id !== undefined) {
      this.loggerService.error('Nested children must not include parent_deed_item_id', HttpStatus.BAD_REQUEST);
      throw new HttpException('Nested children must not include parent_deed_item_id', HttpStatus.BAD_REQUEST);
    }

    const { name, description, display_order, hide_type } = payload;
    const current_index = flat.length;
    flat.push({
      parent_index,
      name,
      description: description ?? null,
      display_order: display_order ?? 0,
      hide_type: hide_type ?? 'none',
    });

    for (const child of payload.children ?? []) {
      this.flattenDeedItemTree(child, current_index, flat);
    }

    return flat.map((node, index) => ({ ...node, index }));
  }

  private async bulkInsertDeedItemTree(client: TransactionClient, deed_id: number, root_parent_id: number | null, flat: FlatDeedItemNode[]): Promise<void> {
    const depth_by_index = new Map<number, number>();
    const levels: FlatDeedItemNode[][] = [];

    for (const node of flat) {
      const depth = node.parent_index === null ? 0 : depth_by_index.get(node.parent_index)! + 1;
      depth_by_index.set(node.index, depth);
      (levels[depth] ??= []).push(node);
    }

    if (!levels.length) {
      return;
    }

    const params: unknown[] = [deed_id];
    let param_index = 2;
    const next_param = (value: unknown): string => {
      params.push(value);
      return `$${param_index++}`;
    };

    const ctes: string[] = [];

    for (let depth = 0; depth < levels.length; depth++) {
      const level = levels[depth];
      const level_cte = `level_${depth}`;
      const map_cte = `level_${depth}_map`;

      if (depth === 0) {
        const root = level[0];
        const parent_param = next_param(root_parent_id);
        const name_param = next_param(root.name);
        const description_param = next_param(root.description);
        const display_order_param = next_param(root.display_order);
        const hide_type_param = next_param(root.hide_type);

        ctes.push(`
          ${level_cte} AS (
            INSERT INTO deed_items (deed_id, parent_deed_item_id, name, description, display_order, hide_type)
            VALUES ($1, ${parent_param}, ${name_param}, ${description_param}, ${display_order_param}, ${hide_type_param}::hide_type_enum)
            RETURNING deed_item_id
          ),
          ${map_cte} AS (
            SELECT deed_item_id, ${root.index}::int AS node_index
            FROM ${level_cte}
          )
        `);
        continue;
      }

      const parent_indices_param = next_param(level.map((node) => node.parent_index));
      const names_param = next_param(level.map((node) => node.name));
      const descriptions_param = next_param(level.map((node) => node.description));
      const display_orders_param = next_param(level.map((node) => node.display_order));
      const hide_types_param = next_param(level.map((node) => node.hide_type));
      const node_indices_param = next_param(level.map((node) => node.index));
      const parent_map_cte = `level_${depth - 1}_map`;

      ctes.push(`
        ${level_cte} AS (
          INSERT INTO deed_items (deed_id, parent_deed_item_id, name, description, display_order, hide_type)
          SELECT
            $1,
            parents.deed_item_id,
            rows.name,
            rows.description,
            rows.display_order,
            rows.hide_type::hide_type_enum
          FROM unnest(
            ${parent_indices_param}::int[],
            ${names_param}::text[],
            ${descriptions_param}::text[],
            ${display_orders_param}::int[],
            ${hide_types_param}::text[]
          ) AS rows(parent_index, name, description, display_order, hide_type)
          INNER JOIN ${parent_map_cte} parents ON parents.node_index = rows.parent_index
          RETURNING deed_item_id
        ),
        ${map_cte} AS (
          SELECT inserted.deed_item_id, indices.node_index
          FROM (
            SELECT deed_item_id, row_number() OVER () AS rn
            FROM ${level_cte}
          ) inserted
          INNER JOIN (
            SELECT node_index, row_number() OVER () AS rn
            FROM unnest(${node_indices_param}::int[]) AS t(node_index)
          ) indices ON indices.rn = inserted.rn
        )
      `);
    }

    await client.query(`WITH ${ctes.join(',\n')} SELECT 1`, params);
  }
}
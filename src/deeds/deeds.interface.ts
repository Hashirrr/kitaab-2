import type { UserTableRow, VisitorAssociationRow } from '../users/users.interface';

export type DeedCategoryType = 'hasanaat' | 'saiyyiaat';

export type DeedType = 'scale' | 'count';
export type HideType = 'none' | 'hide_from_all' | 'hide_from_graphs';
export type DeedAnalyticsType = 'deeds_table' | 'category' | 'users_association' | 'visitors_association' | 'parent_deed_association';

export interface DeedQueryInterface {
  deed_id: number;
}

export interface DeedItemQueryInterface {
  deed_item_id: number;
}

export interface DeedItemResult {
  name: string;
  deed_id: number;
  created_at: Date;
  hide_type: HideType;
  deed_item_id: number;
  display_order: number;
  type?: DeedType | null;
  description: string | null;
  children?: DeedItemResult[];
  last_recorded_at: Date | null;
  parent_deed_item_id: number | null;
}

export interface FlatDeedItemNode {
  name: string;
  index: number;
  hide_type: HideType;
  display_order: number;
  description: string | null;
  parent_index: number | null;
}

export interface DeedTableRow {
  deed_id: number;
  created_at: Date;
  hide_type: HideType;
  deed_item_id: number;
  display_order: number;
  parent_deed_item_id: number | null;
}

export interface DeedTableResponse {
  page: number;
  limit: number;
  total: number;
  rows: DeedTableRow[];
}

export interface DeedRatioResponse {
  total: number;
  distribution: Array<{ category_type: string; count: number; percentage: number }>;
}

export interface UsersAssociationResponse {
  id: number;
  details: UserTableRow[];
}

export interface VisitorsAssociationResponse {
  id: number;
  details: VisitorAssociationRow[];
}

export interface ParentDeedAssociationResponse {
  id: number;
  details: DeedTableRow[];
}
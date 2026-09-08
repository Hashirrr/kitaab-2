export interface RecordResult {
  date: string;
  user_id: number;
  created_at: Date;
  record_id: number;
  deed_item_id: number;
  count_value: number | null;
  scale_item_id: number | null;
}

export interface DeedItemOwnerQueryInterface {
  deed_item_id: number;
}

export interface ScaleItemOwnerQueryInterface {
  scale_items_id: number;
}

export interface DeedAnalyticsQueryInterface {
  deed_name: string;
  date: string | null;
  deed_item_id: number;
  scale_name: string | null;
  count_value: number | null;
  scale_item_id: number | null;
  deed_type: 'count' | 'scale';
}

export interface CountAnalytics {
  date: string;
  count: number;
}

export interface ScaleAnalytics {
  name: string;
  percentage: number;
}

export interface DeedAnalyticsResult {
  name: string;
  deed_item_id: number;
  type: 'count' | 'scale';
  data: CountAnalytics[] | ScaleAnalytics[];
}
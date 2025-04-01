export interface OpenSeaUser {
  username: string | null;
}

export interface OpenSeaAccount {
  address: string;
  user?: OpenSeaUser;
}

export interface RawOpenSeaEvent {
  id?: string;
  event_type: string;
  order_hash?: string | null;
  event_timestamp: string;
  transaction: string | null;
  nft?: {
    identifier: string;
    collection: string;
    contract: string;
    name: string | null;
    display_image_url: string | null;
    image_url: string | null;
  };
  payment_token?: {
    address: string;
    decimals: number;
    symbol: string;
    quantity?: string;
  };
  maker?: OpenSeaAccount;
  taker?: OpenSeaAccount;
  from_account?: OpenSeaAccount;
  to_account?: OpenSeaAccount;
  seller?: OpenSeaAccount;
  quantity?: string;
}

export interface ActivityEvent {
  event_type: string;
  created_date: string;
  transaction: string;
  nft: {
    display_image_url: string;
    identifier: string;
    name: string | null;
    image_url: string;
    collection: string;
    contract: string;
  };
  payment?: {
    quantity: string;
    token_address: string;
    decimals: string;
    symbol: string;
  };
  from_account: {
    address: string;
    user?: {
      username: string;
    };
  };
  to_account: {
    address: string;
    user?: {
      username: string;
    };
  };
  quantity: number;
}

export interface ProgressStreamMessage {
  type: 'progress';
  message: string;
  currentPage: number;
  totalPages: number;
  percentage: number;
  totalEventsSoFar?: number;
  isRateLimited?: boolean;
  retryCount?: number;
  elapsedTime?: number;
}

export interface ChunkStreamMessage {
  type: 'chunk';
  events: ActivityEvent[];
  pageCount: number;
  totalEvents: number;
  currentPage: number;
  totalPages: number;
  percentage: number;
  elapsedTime?: number;
}

export interface CompleteStreamMessage {
  type: 'complete';
  totalPages: number;
  totalEvents: number;
  percentage: 100;
  elapsedTime?: number;
}

export interface ErrorStreamMessage {
  type: 'error';
  error: string;
  status?: number;
  details?: any;
}

export type StreamMessage =
  | ProgressStreamMessage
  | ChunkStreamMessage
  | CompleteStreamMessage
  | ErrorStreamMessage;

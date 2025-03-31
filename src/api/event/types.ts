interface OpenSeaUser {
  username: string | null;
}

export interface OpenSeaAccount {
  address: string;
  user?: OpenSeaUser;
}

export interface EventNftDetail {
  identifier: string;
  collection: string;
  contract: string;
  name: string | null;
  display_image_url: string | null;
  image_url: string | null;
}

export interface EventPaymentDetail {
  quantity: string | null;
  token_address: string | null;
  decimals: number | null;
  symbol: string | null;
}

export interface RawOpenSeaEvent {
  id?: string;
  event_type: string;
  event_timestamp: string;
  transaction?: { hash: string };
  nft?: EventNftDetail;
  payment_token?: {
    address: string;
    decimals: number;
    symbol: string;
  };
  payment?: EventPaymentDetail;
  maker?: OpenSeaAccount;
  taker?: OpenSeaAccount;
  from_account?: OpenSeaAccount;
  to_account?: OpenSeaAccount;
  seller?: OpenSeaAccount;
  quantity?: string;
}

export interface NFTEvent {
  id: string;
  event_type: string;
  created_date: string;
  transactionHash: string | null;
  nft: EventNftDetail | null;
  payment: EventPaymentDetail | null;
  from_account: OpenSeaAccount | null;
  to_account: OpenSeaAccount | null;
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
  events: NFTEvent[];
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
  hasMore: boolean;
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

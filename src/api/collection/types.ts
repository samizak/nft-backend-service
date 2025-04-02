// Import the definitive BasicCollectionInfo from the utils module
import { BasicCollectionInfo } from '../../utils/collectionApi';

export interface CollectionInfo {
  name: string;
  description: string;
  image_url: string;
  external_url: string;
  twitter_username: string;
  discord_url: string;
  telegram_url: string;
  instagram_username: string;
  wiki_url: string;
  is_nsfw: boolean;
  fees: {
    seller_fees: Record<string, number>;
    opensea_fees: Record<string, number>;
  };
  primary_asset_contracts: Array<{
    address: string;
    name: string;
    symbol: string;
    image_url: string;
    description: string;
    external_link: string;
    nft_version: string;
    schema_name: string;
    owner: number;
    payout_address: string;
  }>;
  traits: Record<string, Record<string, number>>;
  stats: {
    one_day_volume: number;
    one_day_change: number;
    one_day_sales: number;
    one_day_average_price: number;
    seven_day_volume: number;
    seven_day_change: number;
    seven_day_sales: number;
    seven_day_average_price: number;
    thirty_day_volume: number;
    thirty_day_change: number;
    thirty_day_sales: number;
    thirty_day_average_price: number;
    total_volume: number;
    total_sales: number;
    total_supply: number;
    count: number;
    num_owners: number;
    average_price: number;
    num_reports: number;
    market_cap: number;
    floor_price: number;
  };
}

export interface PriceData {
  collection: string;
  floor_price: number;
}

export interface CollectionResult {
  collection: string;
  floor_price: number;
  total_supply: number;
  owner_count: number;
  total_volume: number;
  market_cap: number;
}

// Uses the imported BasicCollectionInfo now
export interface CollectionResponseItem {
  info: BasicCollectionInfo | null;
  price: { floor_price: number } | null;
}

export interface BatchCollectionsResponse {
  data: Record<string, CollectionResponseItem | Record<string, never>>;
}

export interface BatchCollectionsRequestBody {
  collection_slugs: string[];
  contract_addresses: string[];
}

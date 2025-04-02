export interface CollectionInfo {
  collection: string;
  name: string;
  description: string | null;
  image_url: string | null;
  safelist_status: string | null;
}

export interface PriceData {
  collection: string;
  floor_price: number;
}

export interface CollectionResult {
  info?: CollectionInfo;
  price?: PriceData;
}

export interface BatchCollectionsResponse {
  data: {
    [collectionSlug: string]: CollectionResult;
  };
}

export interface BatchCollectionsRequestBody {
  collection_slugs: string[];
}

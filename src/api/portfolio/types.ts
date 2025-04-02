export interface PortfolioCollectionBreakdown {
  slug: string;
  contractAddress: string;
  name: string | null;
  imageUrl: string | null;
  nftCount: number;
  floorPriceEth: number;
  totalValueEth: number;
  // Add optional USD value if ETH price is available
  floorPriceUsd?: number;
  totalValueUsd?: number;
  safelistStatus: string | null;
}

export interface PortfolioSummaryData {
  totalValueEth: number;
  totalValueUsd?: number; // Optional based on ETH price availability
  nftCount: number;
  collectionCount: number;
  breakdown: PortfolioCollectionBreakdown[];
  calculatedAt: string; // ISO timestamp of calculation
  ethPriceUsd?: number; // ETH price used for USD calculation
}

// Response type for the API endpoint
export interface CachedPortfolioResponse {
  status: 'ready' | 'calculating' | 'error';
  data: PortfolioSummaryData | null;
  message?: string; // Optional message (e.g., for errors)
}

# NFT Backend Service - Technical Overview

## 1. Introduction

This backend service provides APIs for tracking NFT portfolio values, fetching market data (ETH price, gas), retrieving NFT/collection information, and managing user activity events related to NFT transactions. It aggregates data from multiple sources like OpenSea, Alchemy, CoinGecko, and Infura, handles background processing for computationally intensive tasks, and implements caching strategies for improved performance and reduced reliance on external APIs. This service powers the frontend application available at [https://github.com/samizak/nftportfolio.app](https://github.com/samizak/nftportfolio.app).

## 2. Technology Stack

- **Runtime:** Node.js - Standard platform for building scalable JavaScript/TypeScript backend applications.
- **Framework:** Fastify - Chosen for its high performance, low overhead, and developer-friendly plugin architecture, making it suitable for building efficient APIs.
- **Language:** TypeScript - Provides static typing for better code maintainability, easier refactoring, and reduced runtime errors.
- **Database (Primary):** MongoDB (via Mongoose ODM) - Used for storing persistent data like user activity events and caching collection metadata. Chosen for its flexible schema, suitable for evolving data structures common in the NFT space.
- **Cache / Job Queue:** Redis (via `ioredis`) - Used for:
  - Caching frequently accessed data (final portfolio summaries, collection data).
  - As the backend for the BullMQ job queue system.
    Chosen for its high performance in-memory data storage.
- **Job Queue System:** BullMQ - Built on Redis, used to manage background jobs like portfolio summary calculations, providing persistence, retries, and progress tracking.
- **External APIs:**
  - **OpenSea API v2:** Used for fetching basic NFT collection metadata (`/collections/{slug}`) and historical account events (`/events/accounts/{address}`).
  - **Alchemy NFT API:** Used for fetching aggregated floor prices (`/getFloorPrice`). Chosen as a replacement for NFTGO due to cost/reliability concerns.
  - **CoinGecko API:** Used for fetching the current ETH price (`/simple/price`).
  - **Infura API:** Used for fetching current Ethereum gas prices (`eth_gasPrice` JSON-RPC method).
- **HTTP Client:** Axios - Used for making requests to external APIs, integrated with custom retry logic.
- **Concurrency Control:** `p-limit` - Used in background workers (portfolio calculator) to limit concurrent requests to external APIs, preventing rate limit errors.
- **Linting/Formatting:** ESLint & Prettier - Used to enforce code style consistency and catch potential errors.

## 3. Project Structure

```
/src
├── api/                # API route definitions, controllers, services per feature
│   ├── collection/
│   ├── ens/
│   ├── event/
│   ├── market/
│   ├── nft/
│   ├── portfolio/
│   ├── user/
│   └── admin/
├── lib/                # Shared library configurations (e.g., redis client)
├── models/             # Mongoose schema definitions (e.g., ActivityEvent, CollectionMetadata)
├── services/           # Background services & workers (e.g., priceFetcher, gasFetcher, portfolioCalculator)
├── utils/              # Utility functions (e.g., collectionApi, axiosWithRetry)
├── server.ts           # Fastify server setup, plugin registration, startup logic
└── types/              # Shared TypeScript types/interfaces (if any)
.env                    # Environment variables (ignored by git)
.env.example            # Example environment variables
.eslintrc.js            # (Deprecated) ESLint configuration
eslint.config.mjs       # ESLint v9+ configuration
prettier.config.js      # Prettier configuration
package.json
tsconfig.json
Dockerfile
README.md
```

## 4. Configuration (.env)

Environment variables are managed via a `.env` file in the project root for local development (especially when running via Docker). Create one based on `.env.example`.

- `PORT`: Port the Fastify server listens on (e.g., 3001 for `npm run dev`, or 8080 to match Dockerfile `EXPOSE` when using `docker run`).
- `MONGODB_URI`: Connection string for your MongoDB database (e.g., MongoDB Atlas).
- `REDIS_URL`: **TLS connection string** for your Redis instance (e.g., Upstash `rediss://...`).
- `OPENSEA_API_KEY`: Required for OpenSea API.
- `ALCHEMY_API_KEY`: Required for Alchemy NFT API.
- `COINGECKO_API_KEY`: (Optional but Recommended) API key for CoinGecko.
- `INFURA_API_KEY`: Required for Infura (Gas price, ENS).
- `ETH_RPC_URL`: Full RPC URL (e.g., Infura mainnet URL including API key).
- `JWT_SECRET`: Strong secret key for signing authentication tokens.
- `JWT_EXPIRES_IN`: Validity period for JWTs (e.g., `1d`).
- `NODE_ENV`: Set to `development` or `production`.

** VERY IMPORTANT Configuration Note:**
When setting values in the `.env` file (for local Docker testing) or in Google Secret Manager (for deployment), ensure that **URI/API Key values DO NOT contain surrounding quotes (`"` or `'`) and have NO leading/trailing whitespace or newline characters.** Incorrect formatting will cause connection errors or API authentication failures (e.g., `Invalid character in header`, `Invalid scheme`).

## 5. Background Services

These services run independently of direct API requests, fetching and processing data periodically or via jobs.

- **Price Fetcher (`priceFetcher.ts`):**
  - Fetches ETH price (USD, etc.) from CoinGecko API periodically (e.g., every minute).
  - Uses `setInterval` for polling.
  - Includes robust retry logic with exponential backoff for API errors/rate limits.
  - Provides a fallback mechanism using a default price if fetches fail repeatedly.
  - Stores the latest price in memory for quick access by other services/APIs.
- **Gas Fetcher (`gasFetcher.ts`):**
  - Fetches current Ethereum gas price (Wei) from Infura (`eth_gasPrice`) periodically (e.g., every 15 seconds).
  - Uses `setInterval` for polling.
  - Includes retry logic with exponential backoff.
  - Provides a fallback mechanism using a default gas price.
  - Stores the latest price in memory.
- **Portfolio Calculator Service (`portfolioCalculatorService.ts`):**
  - Acts as a BullMQ **Worker** processing jobs added to the `portfolio-calculator-queue`.
  - **Job Trigger:** Jobs are added by the `/api/portfolio/summary/:address` endpoint when a cache miss occurs.
  - **Process:**
    1.  Fetches all NFTs for the given address (handling pagination via `nft/service.ts`).
    2.  Groups NFTs by collection.
    3.  For each unique collection, calls `fetchCollectionData` (from `utils/collectionApi.ts`) to get metadata and floor price.
    4.  Uses `p-limit` to control concurrency when fetching collection data, reducing rate limit issues.
    5.  Calculates total portfolio value (ETH, USD) and a breakdown by collection.
    6.  Reports progress back to BullMQ (`job.updateProgress`) at various stages.
    7.  Saves the final `PortfolioSummaryData` to the **Redis cache** (key: `portfolio:summary:<address>`) with a TTL (e.g., 4 hours).
- **Event Service (`eventService.ts` - Sync Logic):**
  - Contains `syncAccountEventsInBackground(address)` function.
  - **Trigger:** Called by `POST /api/event/:address/sync`.
  - **Process:**
    1.  Checks for an existing sync for the address (in-memory lock).
    2.  Checks for `OPENSEA_API_KEY`.
    3.  Finds the timestamp of the latest event stored in MongoDB for the address.
    4.  Calls the OpenSea `/events/accounts/{address}` API, using the `occurred_after` parameter to fetch only newer events.
    5.  Handles pagination using the `next` cursor.
    6.  Maps raw OpenSea events to the internal `ActivityEvent` format.
    7.  Uses Mongoose `bulkWrite` with `upsert: true` to efficiently save new/updated events to the MongoDB `activityEvents` collection.
    8.  Includes retry logic for OpenSea API rate limits/errors.
  - **Note:** The in-memory sync lock (`isSyncing`) is suitable for single-instance deployments but would need a Redis-based lock for horizontal scaling.

## 6. Caching Strategy

Multiple caching layers are used to improve performance and reduce external API load:

1.  **MongoDB (`collectionMetadataCache` collection):**
    - **Purpose:** Caches static collection metadata fetched from OpenSea (`/collections/{slug}`).
    - **Mechanism:** The `fetchSingleCollectionInfo` utility checks MongoDB before calling OpenSea. Successful OpenSea results are saved back to MongoDB with `upsert: true`.
    - **Invalidation:** Uses a MongoDB TTL index on the `updatedAt` field (e.g., 24 hours) for automatic cache expiration.
    - **Benefit:** Significantly reduces calls to the rate-limited OpenSea collections endpoint.
2.  **Redis (`portfolio:summary:<address>` key prefix):**
    - **Purpose:** Caches the final, fully calculated portfolio summary object.
    - **Mechanism:** The `portfolioCalculatorService` worker writes the result to Redis upon successful calculation.
    - **Invalidation:** Uses Redis key TTL (e.g., 4 hours). The `/api/portfolio/summary` controller reads from this cache first.
    - **Benefit:** Provides near-instant responses for previously calculated portfolios.
3.  **Redis (`collection:<slug>` key prefix):**
    - **Purpose:** Caches collection data (info + floor price) fetched via the `/api/collection/batch-collections` endpoint's service.
    - **Mechanism:** The `processCollection` function within `collection/service.ts` performs a write-through cache operation after fetching fresh data.
    - **Invalidation:** Uses Redis key TTL (e.g., 4 hours).
    - **Benefit:** Speeds up repeated requests for the same collections via the batch endpoint.

## 7. API Endpoint Documentation

All endpoints are prefixed with `/api`.

### `/market`

- **`GET /market/ethereum-prices`**
  - **Description:** Returns the latest cached Ethereum price information.
  - **Logic:** Reads directly from the in-memory state maintained by the `priceFetcher` service.
  - **Response:** `{ "lastUpdated": "...ISO String...", "isDefault": boolean, "ethPrice": { "usd": number, "btc": number, ... } }`
- **`GET /market/gas-price`**
  - **Description:** Returns the latest cached Ethereum gas price information.
  - **Logic:** Reads directly from the in-memory state maintained by the `gasFetcher` service.
  - **Response:** `{ "lastUpdated": "...ISO String...", "isDefault": boolean, "gasPriceWei": string | null, "gasPriceGwei": string | null }`

### `/collection`

- **`POST /collection/batch-collections`**
  - **Description:** Fetches metadata and floor price for multiple collections.
  - **Request Body:** `{ "collection_slugs": ["slug1", ...], "contract_addresses": ["0xContract1", ...] }` (Arrays must correspond and be equal length).
  - **Logic:** Reads from Redis cache first (`collection:<slug>`). For misses, calls `fetchCollectionData` utility (which uses MongoDB cache for info, Alchemy for floor price) and caches the result in Redis.
  - **Response:** `{ "data": { "0xContract1": { "slug": ..., "name": ..., "floor_price": ..., ... }, ... } }`
- **`GET /collection/alchemy-floor-price/:contract_address`**
  - **Description:** Fetches the current floor price for a single collection directly using Alchemy.
  - **Logic:** Calls the `fetchAlchemyFloorPriceInternal` utility.
  - **Response:** `{ "contractAddress": "...", "floorPriceEth": number, "source": "Alchemy" }` (Returns `floorPriceEth: 0` if not found).

### `/portfolio`

- **`GET /portfolio/summary/:address`**
  - **Description:** Retrieves the calculated portfolio summary for a wallet address.
  - **Logic:**
    1.  Checks Redis cache (`portfolio:summary:<address>`). If HIT, returns `{ status: 'ready', data: PortfolioSummaryData }`.
    2.  If MISS, checks if a job for this address is active/waiting in the BullMQ queue using `getPortfolioJob`.
    3.  If job active/waiting, returns `202 Accepted` with `{ status: 'calculating', progress: JobProgressData }`.
    4.  If no active job, triggers a new background job via `addPortfolioJob` (which handles deduplication) and returns `202 Accepted` with `{ status: 'calculating', progress: InitialJobProgressData }`.
  - **Response (Success):** `{ "status": "ready", "data": { "totalValueEth": ..., "totalValueUsd": ..., "nftCount": ..., "collectionCount": ..., "breakdown": [...], "calculatedAt": "...", "ethPriceUsd": ... } }`
  - **Response (In Progress):** `202 Accepted` with `{ "status": "calculating", "data": null, "message": "...", "progress": { "step": "...", "nftCount": ..., ... } }`

### `/event`

- **`GET /event/:address`**
  - **Description:** Fetches paginated activity events stored in the database for an address.
  - **Query Params:** `page` (number, default 1), `limit` (number, default 20, max 100).
  - **Logic:** Reads directly from the MongoDB `activityEvents` collection via `getPaginatedAccountEvents` and `getAccountEventCount`.
  - **Response:** `{ "address": "...", "pagination": { "currentPage": ..., "limit": ..., "totalPages": ..., "totalItems": ... }, "events": [ActivityEvent, ...] }`
- **`POST /event/:address/sync`**
  - **Description:** Triggers a background synchronization process to fetch the latest events from OpenSea and update the database.
  - **Logic:** Calls `syncAccountEventsInBackground` asynchronously (fire-and-forget).
  - **Response:** `202 Accepted` with `{ "status": "sync_triggered", "message": "..." }`.
- **`GET /event/:address/sync-status`**
  - **Description:** Checks if a background sync is currently running for the address.
  - **Logic:** Calls `checkSyncStatus` which checks the in-memory `isSyncing` set.
  - **Response:** `200 OK` with `{ "address": "...", "status": "syncing" | "idle" }`.

### `/nft`

- (Endpoints like `/nft/by-account` likely exist, fetching data from OpenSea or similar APIs, potentially with caching. Details depend on specific implementation.)

### `/ens`

- (Endpoints like `/ens/resolve` and `/ens/lookup` likely exist for ENS name resolution. Details depend on implementation.)

### `/user`

- (Endpoints like `GET /user/profile` and `PUT /user/profile` likely exist for user data management, potentially interacting with MongoDB. Details depend on implementation.)

### `/admin`

- (Admin-specific endpoints. Purpose and implementation details would be defined here if implemented.)

## 8. Setup & Running Locally

1.  **Clone:** `git clone <repository-url>`
2.  **Install:** `cd nft-backend-service && npm install`
3.  **Configure Local `.env`:**
    - Copy `.env.example` to `.env`.
    - Populate it with your local/development credentials (e.g., local MongoDB/Redis if used, or dev API keys).
    - **Heed the formatting warning in Section 4!** No quotes or extra whitespace.
4.  **Choose Running Method:**
    - **A) Development Mode (Hot-Reloading):**
      - Requires Node.js installed locally.
      - `npm run dev` (Uses `ts-node-dev` for auto-reloading)
      - Server typically available at `http://localhost:3001` (or `PORT` in `.env`).
    - **B) Docker Container (Production-like Environment):**
      - Requires Docker Desktop installed and running.
      - Ensure the `.env` file is configured correctly (especially `PORT=8080` to match Dockerfile `EXPOSE`, and correct DB/Redis/API credentials accessible from Docker).
      - **Build the image:** `docker build -t nft-backend-service .`
      - **Run the container:** `docker run -d -p 3001:8080 --env-file .env --name nft-backend-container nft-backend-service`
        - `-d`: Run detached (background).
        - `-p 3001:8080`: Map port 3001 on your host to port 8080 in the container.
        - `--env-file .env`: Load environment variables from your local `.env` file.
        - `--name ...`: Assign a name for easy management.
      - Server available at `http://localhost:3001` (host port).
      - **View Logs:** `docker logs nft-backend-container`
      - **Stop/Remove:** `docker stop nft-backend-container`, `docker rm nft-backend-container`

## 9. Deployment (Google Cloud Run)

This service is designed for deployment as a Docker container, typically hosted on Google Cloud Run.

1.  **Prerequisites:**
    - Google Cloud Platform (GCP) project set up with Billing enabled.
    - `gcloud` CLI installed and authenticated (`gcloud init`, `gcloud auth login`).
    - APIs enabled: Artifact Registry (`artifactregistry.googleapis.com`), Cloud Run (`run.googleapis.com`), Secret Manager (`secretmanager.googleapis.com`).
2.  **Store Secrets:** Store ALL sensitive configuration values (`MONGODB_URI`, `REDIS_URL`, `OPENSEA_API_KEY`, `ALCHEMY_API_KEY`, `INFURA_API_KEY`, `COINGECKO_API_KEY`, `ETH_RPC_URL`, `JWT_SECRET`) securely in **Google Secret Manager**. Ensure the stored values are clean (no quotes/whitespace). Create secrets like `MONGODB_URI_SECRET`, `OPENSEA_API_KEY_SECRET`, etc.
3.  **Create Artifact Registry Repo:** Create a Docker repository in Artifact Registry (e.g., `nftportfolio` in `us-central1`).
    ```bash
    gcloud artifacts repositories create nftportfolio \
        --repository-format=docker \
        --location=us-central1
    ```
4.  **Configure Docker Auth:** Allow Docker to push to your registry.
    ```bash
    gcloud auth configure-docker us-central1-docker.pkg.dev
    ```
5.  **Build Docker Image:** Ensure your local code is up-to-date.
    ```bash
    docker build -t nft-backend-service .
    ```
6.  **Tag Image:** Tag the image with the full registry path (replace `YOUR_GCP_PROJECT_ID`).
    ```bash
    docker tag nft-backend-service us-central1-docker.pkg.dev/YOUR_GCP_PROJECT_ID/nftportfolio/nft-backend-service:latest
    ```
7.  **Push Image:** Push the tagged image to Artifact Registry.
    ```bash
    docker push us-central1-docker.pkg.dev/YOUR_GCP_PROJECT_ID/nftportfolio/nft-backend-service:latest
    ```
8.  **Deploy to Cloud Run:**
    - Use the Google Cloud Console or `gcloud run deploy`.
    - Select the image pushed in the previous step.
    - Set **Container Port** to `8080`.
    - Configure **Environment Variables**: Map the secrets created in Step 2 to the environment variables the application expects (e.g., Env Var Name `MONGODB_URI` references Secret `MONGODB_URI_SECRET`, version `latest`). Set non-secret variables like `NODE_ENV=production`, `PORT=8080` directly.
    - Grant Cloud Run Service Account Permissions: The Cloud Run service's service account (e.g., `PROJECT_NUMBER-compute@developer.gserviceaccount.com`) needs the **`Secret Manager Secret Accessor`** IAM role at the project level to read the secrets.
    - Configure Ingress (Allow all) and Authentication (Allow unauthenticated).
    - Deploy the service.
9.  **Configure Frontend & CORS:** Update the frontend's API base URL environment variable (`NEXT_PUBLIC_API_BASE_URL`) to the deployed Cloud Run URL. Ensure the backend's CORS configuration (e.g., `CORS_ORIGIN` environment variable in Cloud Run) allows requests from the deployed frontend's domain.

## 10. Linting & Formatting

- Run `npm run lint` to check for code style issues using ESLint.
- Run `npm run format` to automatically format code using Prettier.

## 11. Future Considerations

- **Scalable Sync Lock:** Replace the in-memory `isSyncing` set for event syncs with a Redis-based distributed lock if scaling to multiple server instances.
- **Real-time Progress:** Implement Server-Sent Events (SSE) for portfolio calculation progress instead of relying on frontend polling for a better UX.
- **Advanced Analytics:** Implement backend logic for historical data tracking, P&L calculations, trade analysis (total trades, win rate, avg hold time) to enable richer dashboard features.
- **Error Reporting:** Integrate a dedicated error reporting service (e.g., Sentry).
- **API Documentation:** Generate formal API documentation (e.g., using Swagger/OpenAPI with `fastify-swagger`).

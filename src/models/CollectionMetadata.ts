import mongoose, { Schema, Document } from 'mongoose';

// Corresponds to BasicCollectionInfo interface but for DB storage
export interface ICollectionMetadata extends Document {
  slug: string; // Use slug as the primary ID
  name: string | null;
  description: string | null;
  imageUrl: string | null; // Field name consistency
  safelistStatus: string | null;
  totalSupply: number;
  numOwners: number;
  totalVolume: number;
  marketCap: number;
  // Timestamps will be added automatically by Mongoose
  createdAt?: Date;
  updatedAt?: Date;
}

const CollectionMetadataSchema: Schema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: null },
    description: { type: String, default: null },
    imageUrl: { type: String, default: null }, // Match interface field name
    safelistStatus: { type: String, default: null }, // Match interface field name
    totalSupply: { type: Number, default: 0 }, // Match interface field name
    numOwners: { type: Number, default: 0 }, // Match interface field name
    totalVolume: { type: Number, default: 0 }, // Match interface field name
    marketCap: { type: Number, default: 0 }, // Match interface field name
  },
  {
    timestamps: true, // Automatically add createdAt and updatedAt
    // Mongoose will automatically create _id, but we use slug as main identifier
  }
);

// Add TTL index on updatedAt field - expire documents after 24 hours
// Note: MongoDB TTL index cleanup runs periodically (usually every 60 seconds),
// so deletion is not instantaneous after expiry.
CollectionMetadataSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 }
); // 24 hours TTL

// Prevent Mongoose from creating a default 'collectionmetadatas' collection name
const collectionName = 'collectionMetadataCache';

export default mongoose.model<ICollectionMetadata>(
  'CollectionMetadata',
  CollectionMetadataSchema,
  collectionName
);

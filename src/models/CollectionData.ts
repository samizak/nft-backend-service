import { Schema, model, Document, Model, Types } from 'mongoose';
import { CollectionInfo, PriceData } from '../api/collection/types'; // Import existing types

// Interface extending Mongoose Document for type safety
export interface ICollectionData extends Document {
  slug: string; // OpenSea collection slug (unique identifier)
  info: CollectionInfo | null;
  price: PriceData | null;
  dataLastFetchedAt: Date | null; // Timestamp when data was last fetched from OpenSea by worker
  dbLastUpdatedAt: Date; // Timestamp when this MongoDB document was last updated
}

// Mongoose Schema definition
const CollectionDataSchema: Schema<ICollectionData> = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true, // Ensure slugs are unique
      index: true, // Index for faster lookups
    },
    info: {
      type: Schema.Types.Mixed, // Store the whole CollectionInfo object
      default: null,
    },
    price: {
      type: Schema.Types.Mixed, // Store the whole PriceData object
      default: null,
    },
    dataLastFetchedAt: {
      type: Date,
      default: null,
    },
    // Mongoose timestamps automatically add createdAt and updatedAt
  },
  {
    timestamps: { createdAt: false, updatedAt: 'dbLastUpdatedAt' }, // Use dbLastUpdatedAt for updates
  }
);

// Create and export the Mongoose model
// Use model registry to prevent OverwriteModelError during hot-reloading
const CollectionDataModel: Model<ICollectionData> = model<ICollectionData>(
  'CollectionData',
  CollectionDataSchema
);

export default CollectionDataModel;

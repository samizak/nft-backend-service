import mongoose, { Schema, Document } from 'mongoose';

// Interface matching the structure in src/api/event/types.ts
export interface IActivityEvent extends Document {
  event_type: string;
  created_date: number; // Stored as Unix timestamp (number)
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
    // user?: { username: string; }; // Storing nested optional user object can be complex, keeping it simple for now
  };
  to_account: {
    address: string;
    // user?: { username: string; };
  };
  quantity: number;
}

const ActivityEventSchema: Schema = new Schema<IActivityEvent>(
  {
    event_type: { type: String, required: true, index: true },
    created_date: { type: Number, required: true, index: true }, // Indexed for sorting
    transaction: { type: String, required: true, index: true }, // Indexed for lookups, allow duplicates
    nft: {
      display_image_url: { type: String, required: false, default: null },
      identifier: { type: String, required: true },
      name: { type: String, required: false, default: null },
      image_url: { type: String, required: false, default: null },
      collection: { type: String, required: true, index: true },
      contract: { type: String, required: true, index: true },
    },
    payment: {
      quantity: { type: String },
      token_address: { type: String },
      decimals: { type: String },
      symbol: { type: String },
      required: false, // Make the whole payment object optional
    },
    from_account: {
      address: { type: String, required: true, index: true, lowercase: true }, // Indexed and lowercase for queries
    },
    to_account: {
      address: { type: String, required: true, index: true, lowercase: true }, // Indexed and lowercase for queries
    },
    quantity: { type: Number, required: true },
  },
  {
    timestamps: true, // Add createdAt and updatedAt timestamps managed by Mongoose
    collection: 'activityEvents', // Explicitly set the collection name
  }
);

// Compound index for common NFT lookup
ActivityEventSchema.index({ 'nft.contract': 1, 'nft.identifier': 1 });

// Ensure addresses are stored lowercase for consistent querying
ActivityEventSchema.pre<IActivityEvent>('save', function (next) {
  if (this.from_account && this.from_account.address) {
    this.from_account.address = this.from_account.address.toLowerCase();
  }
  if (this.to_account && this.to_account.address) {
    this.to_account.address = this.to_account.address.toLowerCase();
  }
  next();
});

const ActivityEventModel = mongoose.model<IActivityEvent>(
  'ActivityEvent',
  ActivityEventSchema
);

export default ActivityEventModel;

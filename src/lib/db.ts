import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'nft_activity'; // Default DB name if not set

if (!MONGODB_URI) {
  console.error(
    'FATAL ERROR: MONGODB_URI is not defined in the environment variables.'
  );
  process.exit(1); // Exit if DB URI is missing
}

let db: Db;
let client: MongoClient;

export async function connectToDatabase(): Promise<Db> {
  if (db) {
    return db;
  }
  try {
    client = new MongoClient(MONGODB_URI!);
    await client.connect();
    console.log('Successfully connected to MongoDB Atlas.');
    db = client.db(DB_NAME);

    // Optional: Create indexes for common queries
    await setupIndexes(db);

    return db;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1); // Exit on connection failure
  }
}

export async function disconnectFromDatabase(): Promise<void> {
  if (client) {
    await client.close();
    console.log('Disconnected from MongoDB Atlas.');
  }
}

// Optional: Add function to set up indexes
async function setupIndexes(database: Db): Promise<void> {
  try {
    const collection = database.collection('activityEvents');
    // Index for efficient querying by account address
    await collection.createIndex({ 'from_account.address': 1 });
    await collection.createIndex({ 'to_account.address': 1 });
    // Index for sorting by date
    await collection.createIndex({ created_date: -1 });
    // Index for querying by transaction hash
    await collection.createIndex({ transaction: 1 }, { unique: true }); // Transaction hash should be unique
    // Index for querying NFT contract + identifier
    await collection.createIndex({ 'nft.contract': 1, 'nft.identifier': 1 });

    console.log('Ensured indexes exist for activityEvents collection.');
  } catch (error) {
    console.error('Error creating indexes:', error);
    // Don't exit, but log the error
  }
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectToDatabase first.');
  }
  return db;
}

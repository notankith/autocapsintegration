import { MongoClient, Db } from "mongodb"

const options = {}

let client: MongoClient | undefined
let clientPromise: Promise<MongoClient> | undefined

function ensureClientPromise() {
  const uri = process.env.MONGODB_URI
  if (!clientPromise) {
    if (!uri) {
      throw new Error("Missing required environment variable: MONGODB_URI")
    }

    if (process.env.NODE_ENV === "development") {
      const globalWithMongo = global as typeof globalThis & {
        _mongoClientPromise?: Promise<MongoClient>
      }
      if (!globalWithMongo._mongoClientPromise) {
        client = new MongoClient(uri, options)
        globalWithMongo._mongoClientPromise = client.connect()
      }
      clientPromise = globalWithMongo._mongoClientPromise
    } else {
      client = new MongoClient(uri, options)
      clientPromise = client.connect()
    }
  }

  return clientPromise
}

export default async function connectToDatabase() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error("Missing required environment variable: MONGODB_URI")
  const p = ensureClientPromise()
  const c = await p
  return c
}

/**
 * Get the database instance
 */
export async function getDb(): Promise<Db> {
  const client = await ensureClientPromise()
  return client.db(process.env.MONGODB_DB || "autocaps")
}

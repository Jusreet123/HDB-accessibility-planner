
const { MongoClient } = require("mongodb");
require("dotenv").config();

let client;
let database;

async function connectMongoDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.log("MongoDB URI not configured. Skipping MongoDB connection.");
    return null;
  }

  if (database) {
    return database;
  }

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });

    database = client.db("hdb");

    console.log("MongoDB Atlas connected successfully.");
    return database;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    await client.close();
    client = null;
    return null;
  }
}

function getMongoDB() {
  if (!database) {
    throw new Error("MongoDB is not connected.");
  }

  return database;
}

module.exports = {
  connectMongoDB,
  getMongoDB,
};
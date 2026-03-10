import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import * as Minio from 'minio';
import assetRoutes from './routes/assets.js';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware for security and JSON parsing
app.use(helmet());
app.use(cors());
app.use(express.json());


// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/user', userRoutes);
// -------------------------------------------------
// 1. Initialize Prisma 7 (PostgreSQL with Adapter)
// -------------------------------------------------
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter }); // <-- This fixes the crash!

// -------------------------------------------------
// 2. Initialize Redis (Task Queue)
// -------------------------------------------------
export const redisClient = createClient({
  url: process.env.REDIS_URL
});
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// -------------------------------------------------
// 3. Initialize Minio (Object Storage)
// -------------------------------------------------
export const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
  secretKey: process.env.MINIO_SECRET_KEY || 'password123',
});

// -------------------------------------------------
// Boot Sequence: Connect to everything before listening
// -------------------------------------------------
async function startServer() {
  try {
    // Connect to MongoDB
   // --- START THE DATABASES & SERVER ---
  mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB securely connected for AI logs');

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 API Gateway running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('❌ CRITICAL: Failed to connect to MongoDB', error);
  });

  
    // Connect to Redis
    await redisClient.connect();
    console.log(' Redis Connected (Task Queue)');

    // Test Postgres connection via Prisma
    await prisma.$connect();
    console.log(' PostgreSQL Connected (Users & Auth)');

    // Basic Health Check Route
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'OK', message: 'AssetFlow API Gateway is running' });
    });

  } catch (error) {
    console.error(' Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
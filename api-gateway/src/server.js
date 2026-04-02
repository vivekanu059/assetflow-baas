import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import * as Minio from 'minio';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import authRoutes from './routes/auth.js';
import assetRoutes from './routes/assets.js';
import userRoutes from './routes/user.js';

dotenv.config();

// -------------------------------------------------
// 1. Initialize Prisma (PostgreSQL with Adapter)
// -------------------------------------------------
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

// -------------------------------------------------
// 2. Initialize Redis (Task Queue)
// -------------------------------------------------
export const redisClient = createClient({ 
  url: process.env.REDIS_URL,
  pingInterval: 1000 * 60 * 2, 
  disableOfflineQueue: true, // 🛡️ CRITICAL: Prevents silent freezing!
  socket: {
    connectTimeout: 10000, // 🛡️ Drop dead connections after 10 seconds
    reconnectStrategy: (retries) => {
      console.log(`⚠️ Redis reconnecting... (Attempt ${retries})`);
      return Math.min(retries * 100, 3000); 
    }
  }
});

// When Upstash drops the connection, DO NOT ignore it. 
// Kill the process so Render can instantly restart it with a fresh connection.
redisClient.on('error', (err) => {
  console.error('❌ Redis Connection Severed:', err.message);
  console.log('🔄 Forcing container restart to recover TCP socket...');
  process.exit(1); 
});

redisClient.on('end', () => {
  console.error('❌ Redis Socket Closed.');
  process.exit(1);
});

// -------------------------------------------------
// 3. Initialize Minio (Object Storage)
// -------------------------------------------------
export const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_PORT === '443',
  accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
  secretKey: process.env.MINIO_SECRET_KEY || 'password123',
});

// -------------------------------------------------
// 4. Express App Setup & Routes
// -------------------------------------------------
const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:3000', // Keep local for your own testing
    'https://assetflow-baas.vercel.app' // Add your exact Vercel URL here!
  ],
  credentials: true
}));
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/user', userRoutes);

// Basic Health Check Route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'AssetFlow API Gateway is running' });
});

// -------------------------------------------------
// 5. Strict Boot Sequence (No Race Conditions)
// -------------------------------------------------
async function startServer() {
  try {
    // 1. Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB securely connected for AI logs');

    // 2. Connect to Redis
    await redisClient.connect();
    // (The success log is handled by the .on('connect') event above)

    // 3. Connect to PostgreSQL
    await prisma.$connect();
    console.log('✅ PostgreSQL Connected (Users & Auth)');

    // 4. ONLY start listening once ALL databases are secured
    app.listen(PORT, () => {
      console.log(`🚀 API Gateway running on port ${PORT}`);
    });

  } catch (error) {
    console.error('❌ CRITICAL: Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

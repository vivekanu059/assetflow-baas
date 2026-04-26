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

// --- NEW ENTERPRISE IMPORTS ---
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

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
// 2. Initialize Redis (Task Queue & Rate Limiter)
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
// 4. Enterprise Observability (Winston Logger)
// -------------------------------------------------
export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      ),
    })
  ],
});

// -------------------------------------------------
// 5. Express App Setup & Routes
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

// --- DISTRIBUTED TRACING MIDDLEWARE ---
// Generates a unique UUID for every incoming request and attaches it to req.traceId
app.use((req, res, next) => {
  req.traceId = uuidv4();
  logger.info(`[${req.traceId}] Incoming ${req.method} request to ${req.url}`);
  next();
});

// --- API RATE LIMITER (Token Bucket via Redis) ---
// Protects your backend and AI billing from DDOS or accidental infinite loops
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 60, // Limit each IP to 60 requests per window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  store: new RedisStore({
    // Send the command directly to your existing Upstash Redis instance
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  message: { 
    error: "Too many requests from this IP. Please slow down to protect system resources.",
    status: 429
  },
  handler: (req, res, next, options) => {
    logger.warn(`[${req.traceId}] RATE LIMIT TRIGGERED for IP: ${req.ip}`);
    res.status(options.statusCode).send(options.message);
  }
});

// Apply the rate limiter strictly to all /api routes
app.use('/api', apiLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/user', userRoutes);

// Basic Health Check Route (Un-metered so Ping services don't hit the rate limit)
app.get('/health', (req, res) => {
  logger.info(`[${req.traceId}] Health check pinged.`);
  res.status(200).json({ status: 'OK', message: 'AssetFlow API Gateway is running' });
});

// -------------------------------------------------
// 6. Strict Boot Sequence (No Race Conditions)
// -------------------------------------------------
async function startServer() {
  try {
    // 1. Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('✅ MongoDB securely connected for AI logs');

    // 2. Connect to Redis
    await redisClient.connect();
    logger.info('✅ Upstash Redis task queue active');

    // 3. Connect to PostgreSQL
    await prisma.$connect();
    logger.info('✅ PostgreSQL Connected (Users & Auth)');

    // 4. ONLY start listening once ALL databases are secured
    app.listen(PORT, () => {
      logger.info(`🚀 API Gateway running on port ${PORT}`);
    });

  } catch (error) {
    logger.error(`❌ CRITICAL: Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

startServer();
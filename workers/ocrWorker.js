import http from 'http';
import { createClient } from 'redis';
import * as Minio from 'minio';
import dotenv from 'dotenv';
import pg from 'pg';
import pkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import mongoose from 'mongoose'; 
import { GoogleGenerativeAI } from '@google/generative-ai'; // 🆕 The new AI Engine

dotenv.config();
const { PrismaClient } = pkg;

// 1. Initialize Connections
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Initialize Google AI Studio Client
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ FATAL: GEMINI_API_KEY is missing from environment variables.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const redisClient = createClient({ 
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
redisClient.on('error', (err) => {
  console.error('❌ Redis Connection Severed:', err.message);
  console.log('🔄 Forcing container restart to recover TCP socket...');
  process.exit(1); 
});

redisClient.on('end', () => {
  console.error('❌ Redis Socket Closed.');
  process.exit(1);
});

// Bulletproof the endpoint
const cleanEndpoint = process.env.MINIO_ENDPOINT 
  ? process.env.MINIO_ENDPOINT.replace(/^https?:\/\//, '') 
  : '127.0.0.1';

// Initialize MinIO
const minioClient = new Minio.Client({
  endPoint: cleanEndpoint,
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_PORT === '443', 
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

// --- Define MongoDB Schema ---
const extractedDataSchema = new mongoose.Schema({
  assetId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  originalName: String,
  extractedText: String, 
  processedAt: { type: Date, default: Date.now }
});
const ExtractedData = mongoose.models.ExtractedData || mongoose.model('ExtractedData', extractedDataSchema);

// 2. The Main Worker Loop
async function startWorker() {
  await redisClient.connect();

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, 
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB Connected with Anti-Freeze enabled');
  }

  while (true) {
    let jobString;
    try {
      // NON-BLOCKING POP
      jobString = await redisClient.rPop('ocr_processing_queue');
      
      if (jobString) {
        const job = JSON.parse(jobString);
        
        // Extract the traceId, fallback if it somehow missing
        const traceId = job.traceId || 'NO-TRACE';

        console.log(`\n[${traceId}] 📦 Picked up job for Asset ID: ${job.assetId}`);
        console.log(`[${traceId}] ⬇️ Downloading ${job.originalName} from storage...`);
        
        const dataStream = await minioClient.getObject('raw-assets', job.minioUrl);
        
        const chunks = [];
        for await (const chunk of dataStream) {
          chunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(chunks);

        // --- THE NEW MULTIMODAL AI ROUTER ---
        const extension = job.originalName.split('.').pop().toLowerCase();
        let extractedText = "";

        console.log(`[${traceId}] 🔍 Detected file type: .${extension}`);

        // Keep a fast-path for standard text documents to save AI costs
        if (['txt', 'csv'].includes(extension)) {
          console.log(`[${traceId}] 📝 Reading raw text file directly...`);
          extractedText = fileBuffer.toString('utf-8');
        } 
        // Route Images and PDFs to Gemini 1.5 Flash
        else {
          console.log(`[${traceId}] 🧠 Sending ${job.originalName} to Google AI Studio...`);
          
          let mimeType = 'image/jpeg';
          if (extension === 'pdf') mimeType = 'application/pdf';
          else if (extension === 'png') mimeType = 'image/png';
          else if (extension === 'webp') mimeType = 'image/webp';

          const fileBase64 = fileBuffer.toString('base64');
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          
          const prompt = `You are an enterprise data extraction engine. Extract all text, tabular data, and key-value pairs from this document accurately. Format the output as clean, structured text. Do not add any conversational filler.`;
          
          const documentPart = {
              inlineData: {
                  data: fileBase64,
                  mimeType: mimeType
              }
          };

          const result = await model.generateContent([prompt, documentPart]);
          extractedText = result.response.text();
        }

        console.log(`[${traceId}] ✅ AI Extraction complete! Extracted ${extractedText.length} characters.`);

        // --- Save the FULL text to MongoDB ---
        await ExtractedData.create({
          assetId: job.assetId,
          userId: job.userId,
          originalName: job.originalName,
          extractedText: extractedText 
        });
        
        console.log(`[${traceId}] 💾 Full document text securely saved to MongoDB.`);
        
        console.log(`[${traceId}] 🔔 Notifying Webhook Worker...`);
        await redisClient.lPush('webhook_queue', JSON.stringify({
            assetId: job.assetId,
            status: 'COMPLETED',
            attempt: 1,
            traceId: traceId // 👈 Passing the trace baton to the Webhook Worker!
        }));

        // Update Postgres to COMPLETED
        await prisma.asset.update({
          where: { id: job.assetId },
          data: { status: 'COMPLETED' }
        });
        console.log(`[${traceId}] 📻 BROADCASTING TO REDIS: asset_updates for user ${job.userId}`);
        console.log(`------------------------------\n`);
     } else {
        // QUEUE IS EMPTY: Sleep for 2 seconds to let Upstash breathe
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } catch (error) {
      if (jobString) {
        try {
          const failedJob = JSON.parse(jobString);
          const traceId = failedJob.traceId || 'NO-TRACE';
          console.error(`[${traceId}] ❌ Error processing job:`, error.message);
          
          await prisma.asset.update({
            where: { id: failedJob.assetId },
            data: { status: 'FAILED' }
          });
        } catch (e) {
          console.error('❌ Could not update database to FAILED state');
        }
      } else {
        console.error('❌ Error processing job (No Job Data):', error.message);
      }
      // Wait before retrying after an error
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

startWorker();

// -------------------------------------------------
// Render Free Tier Hack (Cron-Job.org Safe)
// -------------------------------------------------
const PORT = process.env.PORT || 10001; 
http.createServer((req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'text/plain',
    'Content-Length': '2'
  });
  res.end('OK');
}).listen(PORT, '0.0.0.0', () => console.log(`🛡️ Worker awake on port ${PORT}`));
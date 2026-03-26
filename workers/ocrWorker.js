import http from 'http';
import Tesseract from 'tesseract.js';
import { createClient } from 'redis';
import * as Minio from 'minio';
import dotenv from 'dotenv';
import pg from 'pg';
import pkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import mongoose from 'mongoose'; 
import extractPdf from 'pdf-extraction'; 

dotenv.config();
const { PrismaClient } = pkg;

// 1. Initialize Connections
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// OLDER ONE :
// const redisClient = createClient({ 
//   url: process.env.REDIS_URL,
//   pingInterval: 1000 * 60 * 2, // 🛡️ Ping every 2 minutes to keep Upstash awake
//   socket: {
//     reconnectStrategy: (retries) => {
//       console.log(`⚠️ Redis connection dropped. Reconnecting... (Attempt ${retries})`);
//       return Math.min(retries * 100, 3000); 
//     }
//   }
// });


//NEW ONE 
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

redisClient.on('error', (err) => {
  const errorString = String(err);
  if (errorString.includes('Socket closed unexpectedly') || errorString.includes('SocketClosedUnexpectedlyError')) {
    return; 
  }
  console.error('❌ Redis Error:', err);
});

// 1. Bulletproof the endpoint by automatically stripping https:// or http://
const cleanEndpoint = process.env.MINIO_ENDPOINT 
  ? process.env.MINIO_ENDPOINT.replace(/^https?:\/\//, '') 
  : '127.0.0.1';

// 2. Initialize MinIO
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
  
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB Connected for data storage');
  console.log('👷 Multi-Format Worker started. Listening for jobs on Redis...');

  while (true) {
    let jobString;
    try {
      // NON-BLOCKING POP: Safely pull from Upstash without freezing
      jobString = await redisClient.rPop('ocr_processing_queue');
      
      if (jobString) {
        const job = JSON.parse(jobString);
        console.log(`\n📦 Picked up job for Asset ID: ${job.assetId}`);

        console.log(`⬇️ Downloading ${job.originalName} from storage...`);
        const dataStream = await minioClient.getObject('raw-assets', job.minioUrl);
        
        const chunks = [];
        for await (const chunk of dataStream) {
          chunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(chunks);

        // --- THE MULTI-FORMAT ROUTER ---
        const extension = job.originalName.split('.').pop().toLowerCase();
        let extractedText = "";

        console.log(`🔍 Detected file type: .${extension}`);

        if (['png', 'jpg', 'jpeg'].includes(extension)) {
          console.log(`🖼️ Running Tesseract OCR engine on ${job.originalName}...`);
          const { data: { text } } = await Tesseract.recognize(fileBuffer, 'eng');
          extractedText = text;

        } else if (extension === 'pdf') {
          console.log(`📄 Parsing PDF Document: ${job.originalName}...`);
          const pdfData = await extractPdf(fileBuffer);
          extractedText = pdfData.text;

        } else if (['txt', 'csv'].includes(extension)) {
          console.log(`📝 Reading raw text file: ${job.originalName}...`);
          extractedText = fileBuffer.toString('utf-8');

        } else {
          throw new Error(`Unsupported file format: .${extension}`);
        }

        console.log(`✅ Scan complete! Extracted ${extractedText.length} characters.`);

        // --- Save the FULL text to MongoDB ---
        await ExtractedData.create({
          assetId: job.assetId,
          userId: job.userId,
          originalName: job.originalName,
          extractedText: extractedText 
        });
        
        console.log(`💾 Full document text securely saved to MongoDB.`);
        
        console.log(`🔔 Notifying Webhook Worker...`);
        await redisClient.lPush('webhook_queue', JSON.stringify({
            assetId: job.assetId,
            status: 'COMPLETED',
            attempt: 1
        }));

        // Update Postgres to COMPLETED
        await prisma.asset.update({
          where: { id: job.assetId },
          data: { status: 'COMPLETED' }
        });
        console.log(`📻 BROADCASTING TO REDIS: asset_updates for user ${job.userId}`);
        console.log(`------------------------------\n`);
      } else {
        // QUEUE IS EMPTY: Sleep for 2 seconds to let Upstash breathe
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('❌ Error processing job:', error);
      if (jobString) {
        try {
          const failedJob = JSON.parse(jobString);
          await prisma.asset.update({
            where: { id: failedJob.assetId },
            data: { status: 'FAILED' }
          });
        } catch (e) {
          console.error('Could not update database to FAILED state');
        }
      }
      // Wait before retrying after an error
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

startWorker();

// -------------------------------------------------
// Render Free Tier Hack
// -------------------------------------------------
// const PORT = process.env.PORT || 10000;
// http.createServer((req, res) => {
//   res.writeHead(200);
//   res.end('OCR Worker is actively listening to Redis!');
// }).listen(PORT, () => console.log(`🛡️ Render Free Tier Hack active on port ${PORT}`));

// -------------------------------------------------
// Render Free Tier Hack (Cron-Job.org Safe)
// -------------------------------------------------
const PORT = process.env.PORT || 10001; // 
http.createServer((req, res) => {
  // Send a perfectly formatted, tiny response so cron-job doesn't hang
  res.writeHead(200, { 
    'Content-Type': 'text/plain',
    'Content-Length': '2'
  });
  res.end('OK');
}).listen(PORT, '0.0.0.0', () => console.log(`🛡️ Worker awake on port ${PORT}`));

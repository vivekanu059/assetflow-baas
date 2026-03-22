import http from 'http';

import Tesseract from 'tesseract.js';
import { createClient } from 'redis';
import * as Minio from 'minio';
import dotenv from 'dotenv';
import pg from 'pg';
import pkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import mongoose from 'mongoose'; 
import extractPdf from 'pdf-extraction'; // <-- THE MODERN, WORKING LIBRARY

dotenv.config();
const { PrismaClient } = pkg;

// 1. Initialize Connections
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Error', err));

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
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
    let response;
    try {
      response = await redisClient.brPop('ocr_processing_queue', 0);
      
      if (response) {
        const job = JSON.parse(response.element);
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
          const { data: { text } } = await Tesseract.recognize(fileBuffer, 'eng', {
            logger: m => {
              if (m.status === 'recognizing text' && m.progress % 0.25 === 0) {
                  console.log(`   Progress: ${Math.round(m.progress * 100)}%`);
              }
            }
          });
          extractedText = text;

        } else if (extension === 'pdf') {
          console.log(`📄 Parsing PDF Document: ${job.originalName}...`);
          
          // Modern, clean, and actually works in Node 22!
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
      }
    } catch (error) {
      console.error('❌ Error processing job:', error);
      if (response) {
        try {
          const failedJob = JSON.parse(response.element);
          await prisma.asset.update({
            where: { id: failedJob.assetId },
            data: { status: 'FAILED' }
          });

        } catch (e) {
          console.error('Could not update database to FAILED state');
        }
      }
    }
  }
}

startWorker();


// -------------------------------------------------
// Render Free Tier Hack: Bind to a port so Render 
// thinks this is a website and doesn't kill it!
// -------------------------------------------------
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OCR Worker is actively listening to Redis!');
}).listen(PORT, () => console.log(`🛡️ Render Free Tier Hack active on port ${PORT}`));

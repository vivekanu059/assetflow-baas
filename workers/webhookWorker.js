import http from 'http';
import { createClient } from 'redis';
import crypto from 'crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import pkg from '@prisma/client';
dotenv.config();

const { PrismaClient } = pkg;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const redisClient = createClient({ 
  url: process.env.REDIS_URL,
  pingInterval: 1000 * 60 * 2, 
  disableOfflineQueue: true, 
  socket: {
    connectTimeout: 10000, 
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

// --- SCHEMA ---
const extractedDataSchema = new mongoose.Schema({
  assetId: String,
  userId: String,
  originalName: String,
  extractedText: String,
}, { collection: 'extracteddatas' }); 
const ExtractedData = mongoose.models.ExtractedDataWebhook || mongoose.model('ExtractedDataWebhook', extractedDataSchema);

// --- DEAD LETTER QUEUE (DLQ) SCHEMA ---
const dlqSchema = new mongoose.Schema({
  assetId: { type: String, required: true },
  userId: { type: String, required: true },
  payload: { type: Object, required: true },
  errorReason: String,
  failedAt: { type: Date, default: Date.now }
}, { collection: 'deadletterqueues' });
const DLQ = mongoose.models.DLQ || mongoose.model('DLQ', dlqSchema);

async function startWebhookDispatcher() {
  await redisClient.connect();
  
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, 
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB Connected with Anti-Freeze enabled');
  }
  
  console.log('📡 Advanced Webhook Dispatcher (DLQ Enabled) online...');

  while (true) {
    let jobString;
    try {
      jobString = await redisClient.rPop('webhook_queue');
      
      if (jobString) {
        const job = JSON.parse(jobString);
        console.log(`\n📤 Attempting webhook for Asset: ${job.assetId} (Attempt ${job.attempt})`);

        const documentData = await ExtractedData.findOne({ assetId: job.assetId });
        
        if (!documentData) {
            console.error(`❌ Data not found in Mongo. Skipping.`);
            continue; 
        }

        console.log(`🔍 DEBUG: Looking up Webhook for User ID: "${documentData.userId}"`);
        const user = await prisma.user.findUnique({ where: { id: documentData.userId }});
        
        if (!user || !user.webhookUrl || !user.webhookSecret) {
             console.log(`⚠️ User ${documentData.userId} does not have a webhook configured. Skipping.`);
             continue; 
        }

        // 1. CREATE THE PAYLOAD
        const payload = {
          event: 'asset.processed',
          assetId: job.assetId,
          status: job.status,
          data: {
            fileName: documentData.originalName,
            textPreview: documentData.extractedText.substring(0, 500) 
          },
          timestamp: new Date().toISOString()
        };

        // 2. STRINGIFY IT
        const payloadString = JSON.stringify(payload);
        
        // 3. SIGN IT WITH THE USER'S SECRET
        const signature = crypto.createHmac('sha256', user.webhookSecret).update(payloadString).digest('hex');
        const idempotencyKey = `evt_${job.assetId}_completed`;

        // 4. SEND IT TO THE USER'S URL
        const fetchResponse = await fetch(user.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'AssetFlow-Signature': `t=${Date.now()},v1=${signature}`,
            'X-AssetFlow-Idempotency-Key': idempotencyKey
          },
          body: payloadString
        });

        if (fetchResponse.ok) {
          console.log(`✅ Webhook delivered! Status: ${fetchResponse.status}`);
          await DLQ.deleteOne({ assetId: job.assetId });
        } else {
          throw new Error(`Target rejected with status ${fetchResponse.status}`);
        }
      } else {
        // QUEUE IS EMPTY: Sleep for 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
        console.error(`⚠️ Delivery failed: ${error.message}`);
        
        if (jobString) {
            const failedJob = JSON.parse(jobString);
            
            if (failedJob.attempt < 3) {
                failedJob.attempt += 1;
                const delayInSeconds = Math.pow(3, failedJob.attempt - 1) * 5; 
                console.log(`⏳ Re-queuing job. Retrying in ${delayInSeconds}s...`);
                
                setTimeout(async () => {
                    try {
                        await redisClient.lPush('webhook_queue', JSON.stringify(failedJob));
                        console.log(`♻️ Job re-queued successfully.`);
                    } catch (e) {
                        console.error(`❌ CRITICAL: Failed to re-queue job!`, e.message);
                    }
                }, delayInSeconds * 1000);
                
            } else {
                console.log(`💀 Webhook permanently failed. Moving to Dead Letter Queue.`);
                const documentData = await ExtractedData.findOne({ assetId: failedJob.assetId });
                
                if (documentData) {
                  await DLQ.findOneAndUpdate(
                    { assetId: failedJob.assetId },
                    { 
                      userId: documentData.userId,
                      payload: failedJob, 
                      errorReason: error.message,
                      failedAt: new Date()
                    },
                    { upsert: true, new: true }
                  );
                }
            }
        }
    }
  }
}

startWebhookDispatcher();

// -------------------------------------------------
// Render Free Tier Hack
// -------------------------------------------------
const PORT = process.env.PORT || 10000; 
http.createServer((req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'text/plain',
    'Content-Length': '2'
  });
  res.end('OK');
}).listen(PORT, '0.0.0.0', () => console.log(`🛡️ Webhook Worker awake on port ${PORT}`));

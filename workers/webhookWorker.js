import http from 'http';

import { createClient } from 'redis';
import crypto from 'crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const TARGET_WEBHOOK_URL = process.env.TEST_WEBHOOK_URL || "https://webhook.site/your-unique-id";

// for generating fake connection just to test the dead letter queue functionality. In production, this should be a real URL provided by the user.   use this target_webhook_url
// const TARGET_WEBHOOK_URL = "https://httpstat.us/500"

const WEBHOOK_SECRET = process.env.JWT_SECRET || "default_secret"; 

const redisClient = createClient({ 
  url: process.env.REDIS_URL,
  pingInterval: 1000 * 60 * 2, // Keep Upstash awake
  socket: {
    reconnectStrategy: (retries) => {
      console.log(`⚠️ Webhook Redis reconnecting... (Attempt ${retries})`);
      return Math.min(retries * 100, 3000); 
    }
  }
});

// The aggressive log silencer
redisClient.on('error', (err) => {
  const errorString = String(err);
  if (errorString.includes('Socket closed unexpectedly') || errorString.includes('SocketClosedUnexpectedlyError')) return;
  console.error('❌ Webhook Redis Error:', err);
});
// --- EXISTING SCHEMA ---
const extractedDataSchema = new mongoose.Schema({
  assetId: String,
  userId: String,
  originalName: String,
  extractedText: String,
}, { collection: 'extracteddatas' }); 
const ExtractedData = mongoose.models.ExtractedDataWebhook || mongoose.model('ExtractedDataWebhook', extractedDataSchema);

// --- NEW: DEAD LETTER QUEUE (DLQ) SCHEMA ---
const dlqSchema = new mongoose.Schema({
  assetId: { type: String, required: true },
  userId: { type: String, required: true },
  payload: { type: Object, required: true },
  errorReason: String,
  failedAt: { type: Date, default: Date.now }
}, { collection: 'deadletterqueues' });
const DLQ = mongoose.models.DLQ || mongoose.model('DLQ', dlqSchema);

const redisPublisher = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
const redisListener = redisPublisher.duplicate(); // Clones the connection strictly for listening

redisPublisher.on('error', (err) => console.error('Redis Publisher Error', err));
redisListener.on('error', (err) => console.error('Redis Listener Error', err));

async function startWebhookDispatcher() {
  // Connect BOTH clients
  await redisPublisher.connect();
  await redisListener.connect();
  
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
  
  console.log('📡 Advanced Webhook Dispatcher (DLQ Enabled) online...');

  while (true) {
    let response;
    try {
      // 2. Use the LISTENER specifically for the blocking pop
      response = await redisListener.brPop('webhook_queue', 0);
      
      if (response) {
        const job = JSON.parse(response.element);
        console.log(`\n📤 Attempting webhook for Asset: ${job.assetId} (Attempt ${job.attempt})`);

        const documentData = await ExtractedData.findOne({ assetId: job.assetId });
        
        if (!documentData) {
            console.error(`❌ Data not found in Mongo. Skipping.`);
            continue;
        }

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

        const payloadString = JSON.stringify(payload);
        const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadString).digest('hex');
        const idempotencyKey = `evt_${job.assetId}_completed`;

        const fetchResponse = await fetch(TARGET_WEBHOOK_URL, {
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
      }
    } catch (error) {
        console.error(`⚠️ Delivery failed: ${error.message}`);
        
        if (response && response.element) {
            const failedJob = JSON.parse(response.element);
            
            if (failedJob.attempt < 3) {
                failedJob.attempt += 1;
                const delayInSeconds = Math.pow(3, failedJob.attempt - 1) * 5; 
                console.log(`⏳ Re-queuing job. Retrying in ${delayInSeconds}s...`);
                
                setTimeout(async () => {
                    // 3. Use the PUBLISHER to push the message back in. No deadlocks!
                    await redisPublisher.lPush('webhook_queue', JSON.stringify(failedJob));
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
const PORT = process.env.PORT || 10001; // Using 10001 to avoid local conflicts
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Webhook Worker is actively listening to Redis!');
}).listen(PORT, () => console.log(`🛡️ Webhook Worker Free Tier Hack active on port ${PORT}`));

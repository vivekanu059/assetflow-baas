import express from 'express';
import { prisma } from '../server.js';
import { requireAuth } from '../middleware/requireAuth.js';
import mongoose from 'mongoose';
import {createClient} from 'redis'; 
import crypto from 'crypto';

import jwt from 'jsonwebtoken';
const router = express.Router();

// Just define the schema, don't try to connect here!
const extractedDataSchema = new mongoose.Schema({
  assetId: String,
  userId: String,
  originalName: String,
  extractedText: String,
}, { collection: 'extracteddatas' });

const ExtractedData = mongoose.models.ExtractedData || mongoose.model('ExtractedData', extractedDataSchema);


// --- DLQ Schema for API Gateway ---
const dlqSchema = new mongoose.Schema({
  assetId: String,
  userId: String,
  payload: Object,
  errorReason: String,
  failedAt: Date
}, { collection: 'deadletterqueues' });

const DLQ = mongoose.models.DLQ || mongoose.model('DLQ', dlqSchema);

// --- UPDATED: Dashboard Route with Server-Side Pagination ---
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    // 1. Grab pagination params from the URL (default to page 1, 10 items per page)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 2. Count the TOTAL number of assets this user has for the frontend math
    const totalAssets = await prisma.asset.count({
      where: { userId: req.user.userId }
    });

    // 3. Fetch only the specific "slice" of assets for this page
    const paginatedAssets = await prisma.asset.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      skip: skip,
      take: limit 
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, tier: true,
        apiKeyHash: true
      } 
    });

    res.json({
      user: user,
      // If they have a hash in the DB, tell the frontend it exists, but DO NOT send the key!
      apiKey: user.apiKeyHash ? 'sk_live_********************************' : null,
      webhookUrl: "https://webhook.site/your-unique-id",
      assets: paginatedAssets,
      pagination: {
        total: totalAssets,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalAssets / limit)
      }
    });
  } catch (error) {
    console.error('Dashboard Fetch Error:', error);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// --- EXISTING: Fetch Specific Asset Data Route ---
router.get('/asset/:assetId', requireAuth, async (req, res) => {
  try {
    const { assetId } = req.params;
    
    // 1. Verify the user actually owns this asset in Postgres
    const pgAsset = await prisma.asset.findFirst({
      where: { id: assetId, userId: req.user.userId }
    });

    if (!pgAsset) {
      return res.status(404).json({ error: 'Asset not found or unauthorized' });
    }

    // 2. Fetch the massive text block from MongoDB
    const mongoData = await ExtractedData.findOne({ assetId: assetId });

    if (!mongoData) {
      return res.status(404).json({ error: 'Extraction data not found yet' });
    }

    // 3. Send it to the frontend!
    res.json(mongoData);
  } catch (error) {
    console.error('Asset Fetch Error:', error);
    res.status(500).json({ error: 'Failed to load asset data' });
  }
});

// --- GET /webhooks/failed (Fetch the DLQ) ---
// --- GET /webhooks/failed (Fetch the DLQ) ---
router.get('/webhooks/failed', requireAuth, async (req, res) => {
  try {
    const deadLetters = await DLQ.find({ userId: req.user.userId }).sort({ failedAt: -1 });
    res.json({ failedWebhooks: deadLetters });
  } catch (error) {
    console.error('DLQ Fetch Error:', error);
    res.status(500).json({ error: 'Failed to load dead letter queue' });
  }
});

// --- POST /webhooks/retry/:assetId (Manual Replay) ---
router.post('/webhooks/retry/:assetId', requireAuth, async (req, res) => {
  try {
    const { assetId } = req.params;

    // 1. Find the exact failed webhook in Mongo
    const deadLetter = await DLQ.findOne({ assetId: assetId, userId: req.user.userId });
    
    if (!deadLetter) {
      return res.status(404).json({ error: 'Failed webhook not found' });
    }

    // 2. Reset the attempt counter to 1
    const replayJob = deadLetter.payload;
    replayJob.attempt = 1;

    // 3. Push it back into the Redis Webhook Queue
    // Inline import for the manual trigger
    const redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
    
    await redisClient.lPush('webhook_queue', JSON.stringify(replayJob));
    await redisClient.disconnect();

    // 4. Temporarily remove it from DLQ (if it fails again, the worker will put it back)
    await DLQ.deleteOne({ assetId: assetId });

    res.json({ message: 'Webhook queued for manual replay', assetId });
  } catch (error) {
    console.error('Manual Replay Error:', error);
    res.status(500).json({ error: 'Failed to trigger manual replay' });
  }
});

router.post('/api-key/roll', requireAuth, async (req, res) => {
  try {
    // 1. Generate a massive, cryptographically random string
    const rawApiKey = 'sk_live_' + crypto.randomBytes(32).toString('hex');

    // 2. Hash it instantly using SHA-256 (Fast but irreversible)
    const hashedApiKey = crypto.createHash('sha256').update(rawApiKey).digest('hex');

    // 3. Save ONLY the hash to the database. The raw key is never saved!
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { apiKeyHash: hashedApiKey }
    });

    // 4. Return the RAW key to the user just this ONE time.
    res.json({ 
      message: 'API Key generated successfully. Save this, you will never see it again!',
      apiKey: rawApiKey 
    });
  } catch (error) {
    console.error('API Key Generation Error:', error);
    res.status(500).json({ error: 'Failed to generate API Key' });
  }
});

// Route to update webhook settings (Requires the user to be logged in)
router.put('/webhook', requireAuth, async (req, res) => {
  try {
    // 3. Your middleware securely attached the user data here!
    // Note: Use req.user.userId if that is how you named it when signing the JWT
    const userId = req.user.id || req.user.userId; 
    const { webhookUrl } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID missing from token payload' });
    }

    // Find the user in PostgreSQL
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Generate a Secret Key ONLY if they don't have one yet
    const newSecret = user.webhookSecret || crypto.randomBytes(32).toString('hex');

    // Save to database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { 
        webhookUrl: webhookUrl,
        webhookSecret: newSecret
      }
    });

    res.status(200).json({ 
      message: 'Webhook settings saved!',
      webhookUrl: updatedUser.webhookUrl,
      webhookSecret: updatedUser.webhookSecret
    });

  } catch (error) {
    console.error('❌ Error saving webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});





export default router;

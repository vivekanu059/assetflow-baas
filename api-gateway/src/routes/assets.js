import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { minioClient, prisma, redisClient } from '../server.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import * as Minio from 'minio'; 
const router = express.Router();

// -------------------------------------------------
// GENERATE PRESIGNED UPLOAD URL
// -------------------------------------------------

// ⏰ Wake up the background workers instantly from the browser!
// We use mode: 'no-cors' so the browser doesn't block the ping.
fetch('https://assetflow-ocr-worker.onrender.com', { mode: 'no-cors' }).catch(() => {});
fetch('https://assetflow-webhook-worker.onrender.com', { mode: 'no-cors' }).catch(() => {});

router.post('/upload-url', requireAuth, rateLimiter, async (req, res) => {
  try {
    const { fileName, fileSize, contentType } = req.body;
    const userId = req.user.userId; // 🔙 Reverted back to your original working code

    if (!fileName || !fileSize) {
      return res.status(400).json({ error: 'fileName and fileSize are required' });
    }

    const fileExtension = fileName.split('.').pop();
    const uniqueStorageKey = `${userId}/${uuidv4()}.${fileExtension}`;
    const expiryInSeconds = 15 * 60;

    const externalEndpoint = process.env.MINIO_ENDPOINT === 'minio' ? 'localhost' : process.env.MINIO_ENDPOINT;

    const frontendMinioClient = new Minio.Client({
      endPoint: externalEndpoint,
      port: parseInt(process.env.MINIO_PORT),
      useSSL: process.env.MINIO_PORT === '443',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      region: 'us-east-1' 
    });

    const presignedUrl = await frontendMinioClient.presignedPutObject(
      'raw-assets',        
      uniqueStorageKey,    
      expiryInSeconds
    );

    const newAsset = await prisma.asset.create({
      data: {
        originalName: fileName,
        minioUrl: uniqueStorageKey,
        fileSize: parseInt(fileSize),
        status: 'PENDING',
        userId: userId,
      }
    });

    res.status(200).json({
      message: 'Presigned URL generated successfully',
      assetId: newAsset.id,
      uploadUrl: presignedUrl,
      expiresIn: '15 minutes'
    });

  } catch (error) {
    console.error('Presigned URL Error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// -------------------------------------------------
// FINALIZE UPLOAD & QUEUE FOR PROCESSING
// -------------------------------------------------
router.post('/finalize', requireAuth, rateLimiter, async (req, res) => {
  try {
    const { assetId } = req.body;
    const userId = req.user.userId; // 🔙 Reverted back to your original working code

    if (!assetId) {
      return res.status(400).json({ error: 'assetId is required' });
    }

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, userId: userId, status: 'PENDING' }
    });

    if (!asset) {
      return res.status(404).json({ error: 'Asset not found or already processed' });
    }

    try {
      await minioClient.statObject('raw-assets', asset.minioUrl);
    } catch (err) {
      return res.status(400).json({ error: 'File not found in storage. Did you upload it?' });
    }

    const updatedAsset = await prisma.asset.update({
      where: { id: assetId },
      data: { status: 'PROCESSING' }
    });

    const jobPayload = {
      assetId: updatedAsset.id,
      minioUrl: updatedAsset.minioUrl,
      userId: userId,
      originalName: updatedAsset.originalName,
      timestamp: new Date().toISOString()
    };

    console.log("📦 Attempting to push job to Redis:", jobPayload);

    // 🔙 Backend fetch crash completely removed

    await redisClient.lPush('ocr_processing_queue', JSON.stringify(jobPayload));

    console.log("✅ Successfully pushed to Redis!");

    res.status(200).json({
      message: 'Upload finalized. Document queued for OCR processing.',
      assetId: updatedAsset.id,
      status: updatedAsset.status
    });

  } catch (error) {
    console.error('Finalize Error:', error);
    res.status(500).json({ error: 'Failed to finalize upload' });
  }
});

export default router;

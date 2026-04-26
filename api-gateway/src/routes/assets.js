import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { minioClient, prisma, redisClient, logger } from '../server.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import * as Minio from 'minio';

const router = express.Router();

// -------------------------------------------------
// GENERATE PRESIGNED UPLOAD URL
// -------------------------------------------------
router.post('/upload-url', requireAuth, rateLimiter, async (req, res) => {
  try {
    const { fileName, fileSize, contentType } = req.body;
    const userId = req.user.userId;

    logger.info(`[${req.traceId}] Requesting presigned URL for file: ${fileName} (User: ${userId})`);

    if (!fileName || !fileSize) {
      logger.warn(`[${req.traceId}] Rejected upload-url: Missing fileName or fileSize`);
      return res.status(400).json({ error: 'fileName and fileSize are required' });
    }

    const fileExtension = fileName.split('.').pop();
    const uniqueStorageKey = `${userId}/${uuidv4()}.${fileExtension}`;
    const expiryInSeconds = 15 * 60;

    // --- THE ENTERPRISE FIX: Internal vs External Client ---
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

    logger.info(`[${req.traceId}] ✅ Presigned URL generated successfully for Asset ID: ${newAsset.id}`);

    res.status(200).json({
      message: 'Presigned URL generated successfully',
      assetId: newAsset.id,
      uploadUrl: presignedUrl,
      expiresIn: '15 minutes'
    });

  } catch (error) {
    logger.error(`[${req.traceId}] ❌ Presigned URL Error: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// -------------------------------------------------
// FINALIZE UPLOAD & QUEUE FOR PROCESSING
// -------------------------------------------------
router.post('/finalize', requireAuth, rateLimiter, async (req, res) => {
  try {
    const { assetId } = req.body;
    const userId = req.user.userId;

    logger.info(`[${req.traceId}] Finalizing upload for Asset ID: ${assetId}`);

    if (!assetId) {
      logger.warn(`[${req.traceId}] Rejected finalize: Missing assetId`);
      return res.status(400).json({ error: 'assetId is required' });
    }

    // 1. Verify the asset belongs to this user and is PENDING
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, userId: userId, status: 'PENDING' }
    });

    if (!asset) {
      logger.warn(`[${req.traceId}] Asset not found or already processed: ${assetId}`);
      return res.status(404).json({ error: 'Asset not found or already processed' });
    }

    // 2. Verify the file actually exists in Minio (Security Check)
    try {
      await minioClient.statObject('raw-assets', asset.minioUrl);
    } catch (err) {
      logger.error(`[${req.traceId}] File missing in storage for Asset ID: ${assetId}`);
      return res.status(400).json({ error: 'File not found in storage. Did you upload it?' });
    }

    // 3. Update the database status to PROCESSING
    const updatedAsset = await prisma.asset.update({
      where: { id: assetId },
      data: { status: 'PROCESSING' }
    });
    
    // 4. Create the Job Payload (NOW INCLUDING TRACE ID)
    const jobPayload = {
      assetId: updatedAsset.id,
      minioUrl: updatedAsset.minioUrl,
      userId: userId,
      originalName: updatedAsset.originalName,
      timestamp: new Date().toISOString(),
      traceId: req.traceId // 👈 Passing the baton to the Redis Queue!
    };

    logger.info(`[${req.traceId}] 📦 Pushing job to Redis Queue: ${updatedAsset.id}`);

    // 5. Push the job to the Redis Queue
    await redisClient.lPush('ocr_processing_queue', JSON.stringify(jobPayload));

    logger.info(`[${req.traceId}] ✅ Successfully pushed to Redis!`);

    res.status(200).json({
      message: 'Upload finalized. Document queued for OCR processing.',
      assetId: updatedAsset.id,
      status: updatedAsset.status
    });

  } catch (error) {
    logger.error(`[${req.traceId}] ❌ Finalize Error: ${error.message}`);
    res.status(500).json({ error: 'Failed to finalize upload' });
  }
});

export default router;
import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../server.js';

const router = express.Router();

// -------------------------------------------------
// REGISTER (Create User & API Key)
// -------------------------------------------------
router.post('/register', async (req, res) => {
  // ... (Keep your existing register code here exactly as it was)
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const rawApiKey = `sk_live_${crypto.randomBytes(16).toString('hex')}`;
    const hashedApiKey = await bcrypt.hash(rawApiKey, saltRounds);
    const maskedKey = `sk_live_${'*'.repeat(28)}${rawApiKey.slice(-4)}`;

    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { email, password: hashedPassword, tier: 'FREE' },
      });
      const newKey = await tx.apiKey.create({
        data: { name: 'Default Project Key', keyHash: hashedApiKey, maskedKey, userId: newUser.id },
      });
      return { newUser, newKey };
    });

    res.status(201).json({
      message: 'User registered successfully',
      userId: result.newUser.id,
      tier: result.newUser.tier,
      apiKey: rawApiKey,
    });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// -------------------------------------------------
// LOGIN (Authenticate & Issue JWT)
// -------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // 1. Find the user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 2. Verify the password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 3. Generate a JWT valid for 24 hours
    const token = jwt.sign(
      { userId: user.id, tier: user.tier },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 4. Return the token to the client
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// -------------------------------------------------
// LOGOUT (Stateless JWT cleanup)
// -------------------------------------------------
router.post('/logout', (req, res) => {
  // Since we are using stateless JWTs, the server doesn't "destroy" a session.
  // We simply tell the React frontend to delete the token from localStorage/cookies.
  // (In a more complex setup, you could add the token to a Redis blocklist here).
  res.status(200).json({ message: 'Logout successful. Please clear the token on the client side.' });
});

export default router;
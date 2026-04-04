"use client";

import { useState } from 'react';
import { BookOpen, Key, UploadCloud, Webhook, ShieldCheck, ChevronRight, Terminal, Copy, Check } from 'lucide-react';
import { motion } from 'framer-motion';

// ------------------------------------------------------------------
// 1. SAFE COMPONENT EXTRACTION
// Defining this outside the main page prevents React re-render errors
// ------------------------------------------------------------------
const CodeBlock = ({ code, language, id, copiedCode, onCopy }) => (
  <div className="relative group rounded-md overflow-hidden border border-neutral-800 bg-[#050505] my-4">
    <div className="flex items-center justify-between px-4 py-2 bg-[#111] border-b border-neutral-800">
      <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">{language}</span>
      <button 
        onClick={() => onCopy(code, id)}
        className="text-neutral-500 hover:text-white transition-colors"
      >
        {copiedCode === id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
    <pre className="p-4 text-xs font-mono text-neutral-300 overflow-x-auto whitespace-pre-wrap">
      {code}
    </pre>
  </div>
);

// ------------------------------------------------------------------
// 2. SAFE STRING EXTRACTION
// Keeping multi-line strings out of JSX prevents compiler crashes
// ------------------------------------------------------------------
const SNIPPETS = {
  auth: `curl -X POST https://assetflow-api.onrender.com/api/upload-url \\
  -H "Authorization: Bearer sk_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json"`,
  
  req1: `{
  "fileName": "invoice_october.pdf",
  "fileSize": 1048576 
}`,

  res1: `{
  "message": "Presigned URL generated successfully",
  "assetId": "dceeb854-9d37-4d71-aac2...",
  "uploadUrl": "https://storage.assetflow.com/...",
  "expiresIn": "15 minutes"
}`,

  req2: `const fs = require('fs');

// Read the file as a buffer
const fileBuffer = fs.readFileSync('./invoice_october.pdf');

// PUT directly to the pre-signed URL (No API Key needed here)
await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/pdf', 
  },
  body: fileBuffer
});`,

  req3: `{
  "assetId": "dceeb854-9d37-4d71-aac2..." 
}`,

  res3: `{
  "message": "Upload finalized. Document queued for OCR processing.",
  "status": "PROCESSING",
  "assetId": "dceeb854-9d37-4d71-aac2..."
}`,

  webhookPayload: `{
  "event": "asset.processed",
  "assetId": "dceeb854-9d37-4d71...",
  "status": "COMPLETED",
  "data": {
    "fileName": "invoice_october.pdf",
    "textPreview": "EXTRACTED TEXT GOES HERE..."
  },
  "timestamp": "2026-04-04T10:00:00.000Z"
}`,

  webhookVerify: `const crypto = require('crypto');

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signatureHeader = req.headers['assetflow-signature'];
  // Parse out the signature: "t=12345,v1=abcdef..."
  const providedSignature = signatureHeader.split('v1=')[1];

  const payloadString = req.body.toString();
  const webhookSecret = process.env.ASSETFLOW_WEBHOOK_SECRET;

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payloadString)
    .digest('hex');

  if (expectedSignature !== providedSignature) {
    return res.status(401).send('Invalid signature');
  }

  // Signature is valid. Process the data!
  const payload = JSON.parse(payloadString);
  console.log("Data extracted:", payload.data.textPreview);
  
  res.status(200).send('Webhook received');
});`
};


// ------------------------------------------------------------------
// 3. MAIN PAGE COMPONENT
// ------------------------------------------------------------------
export default function DocsPage() {
  const [activeTab, setActiveTab] = useState('intro');
  const [copiedCode, setCopiedCode] = useState(null);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const sections = {
    intro: {
      title: "Introduction",
      icon: <BookOpen className="w-4 h-4" />,
      content: (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold text-white">AssetFlow API Documentation</h1>
          <p className="text-sm text-neutral-400 leading-relaxed">
            AssetFlow provides a high-performance, asynchronous API for extracting text from documents using advanced AI OCR. 
            Designed for scale, our architecture prevents your servers from blocking during heavy file processing by utilizing 
            secure presigned URLs and real-time Webhook delivery.
          </p>
          <div className="p-4 border border-emerald-900/50 bg-[#0a1510] rounded-md mt-6">
            <h3 className="text-sm font-medium text-emerald-400 mb-2">The Integration Lifecycle</h3>
            <ol className="list-decimal list-inside text-xs text-emerald-300/80 space-y-2">
              <li>Request a secure, temporary storage URL.</li>
              <li>Upload your binary file directly to the storage bucket.</li>
              <li>Finalize the upload to queue the background extraction job.</li>
              <li>Listen for the webhook payload containing your extracted data.</li>
            </ol>
          </div>
        </div>
      )
    },
    auth: {
      title: "Authentication",
      icon: <Key className="w-4 h-4" />,
      content: (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Authenticating Requests</h2>
          <p className="text-sm text-neutral-400">
            All API requests must be authenticated using your Secret API Key, generated in your dashboard. 
            Include the key in the <code className="text-emerald-400 bg-emerald-400/10 px-1 rounded">Authorization</code> header as a Bearer token.
          </p>
          <CodeBlock 
            id="auth-curl"
            language="cURL"
            code={SNIPPETS.auth}
            copiedCode={copiedCode}
            onCopy={handleCopy}
          />
        </div>
      )
    },
    step1: {
      title: "Step 1: Request Upload URL",
      icon: <UploadCloud className="w-4 h-4" />,
      content: (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Generate Presigned URL</h2>
          <p className="text-sm text-neutral-400">
            To prevent heavy file transfers from crashing your servers, AssetFlow uses direct-to-cloud uploads. 
            Request a temporary, secure URL to upload your raw document.
          </p>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-[10px] font-bold rounded uppercase">POST</span>
            <code className="text-xs text-neutral-300">/api/upload-url</code>
          </div>
          
          <h3 className="text-sm font-medium mt-6 text-white">Request Body</h3>
          <CodeBlock 
            id="req-1"
            language="JSON"
            code={SNIPPETS.req1}
            copiedCode={copiedCode}
            onCopy={handleCopy}
          />
          
          <h3 className="text-sm font-medium mt-6 text-white">Response</h3>
          <CodeBlock 
            id="res-1"
            language="JSON"
            code={SNIPPETS.res1}
            copiedCode={copiedCode}
            onCopy={handleCopy}
          />
          <p className="text-xs text-amber-500 bg-amber-500/10 p-3 rounded border border-amber-500/20 mt-4">
            <strong>Crucial:</strong> Save the returned <code className="font-mono">assetId</code>. You will need it in Step 3!
          </p>
        </div>
      )
    },
    step2: {
      title: "Step 2: Upload Binary",
      icon: <Terminal className="w-4 h-4" />,
      content: (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Upload File to Storage</h2>
          <p className="text-sm text-neutral-400">
            Execute a standard HTTP <code className="text-emerald-400 bg-emerald-400/10 px-1 rounded">PUT</code> request 
            to the <code className="text-emerald-400 bg-emerald-400/10 px-1 rounded">uploadUrl</code> you received in Step 1. 
            The body of the request must be the raw binary file. Do not use form-data.
          </p>
          <CodeBlock 
            id="req-2"
            language="JavaScript (Node.js)"
            code={SNIPPETS.req2}
            copiedCode={copiedCode}
            onCopy={handleCopy}
          />
        </div>
      )
    },
    step3: {
      title: "Step 3: Process Asset",
      icon: <ShieldCheck className="w-4 h-4" />,
      content: (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Queue Background Job</h2>
          <p className="text-sm text-neutral-400">
            Once the file is successfully uploaded to the storage bucket, notify AssetFlow to begin the background OCR extraction.
          </p>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-[10px] font-bold rounded uppercase">POST</span>
            <code className="text-xs text-neutral-300">/api/finalize</code>
          </div>

          <h3 className="text-sm font-medium mt-6 text-white">Request Body</h3>
          <CodeBlock 
            id="req-3"
            language="JSON"
            code={SNIPPETS.req3}
            copiedCode={copiedCode}
            onCopy={handleCopy}
          />

          <h3 className="text-sm font-medium mt-6 text-white">Response</h3>
          <CodeBlock 
            id="res-3"
            language="JSON"
            code={SNIPPETS.res3}
            copiedCode={copiedCode}
            onCopy={handleCopy}
          />
        </div>
      )
    },
    webhooks: {
      title: "Webhooks & Security",
      icon: <Webhook className="w-4 h-4" />,
      content: (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Receiving Data</h2>
          <p className="text-sm text-neutral-400">
            AssetFlow operates asynchronously. When OCR processing is complete, we send a <code className="text-blue-400 bg-blue-400/10 px-1 rounded">POST</code> request to your configured Webhook Target URL.
          </p>
          
          <h3 className="text-sm font-medium mt-6 text-white">The Webhook Payload</h3>
          <CodeBlock 
            id="webhook-payload"
            language="JSON"
            code={SNIPPETS.webhookPayload}
            copiedCode={copiedCode}
            onCopy={handleCopy}
          />

          <h3 className="text-sm font-medium mt-8 text-white border-t border-neutral-800 pt-6">Security: Verifying Signatures</h3>
          <p className="text-sm text-neutral-400">
            To prove the webhook came from us, we sign the payload using HMAC SHA-256 and your Webhook Secret Key. 
            You will find the signature in the <code className="text-emerald-400 bg-emerald-400/10 px-1 rounded">AssetFlow-Signature</code> header.
          </p>
          <CodeBlock 
            id="webhook-verify"
            language="JavaScript (Express.js)"
            code={SNIPPETS.webhookVerify}
            copiedCode={copiedCode}
            onCopy={handleCopy}
          />
        </div>
      )
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] font-sans flex">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-neutral-800 bg-[#0a0a0a] flex-shrink-0 hidden md:block">
        <div className="h-14 border-b border-neutral-800 flex items-center px-6">
          <span className="font-semibold text-sm tracking-wide text-white">Documentation</span>
        </div>
        <nav className="p-4 space-y-1">
          {Object.entries(sections).map(([key, section]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                activeTab === key 
                  ? 'bg-neutral-800/50 text-white font-medium' 
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-900/50'
              }`}
            >
              {section.icon}
              {section.title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl px-8 py-12 overflow-y-auto">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-500 mb-8">
            <span>Docs</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-emerald-500">{sections[activeTab].title}</span>
          </div>
          {sections[activeTab].content}
        </motion.div>
      </main>
    </div>
  );
}
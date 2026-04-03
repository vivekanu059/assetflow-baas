"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Database, Terminal, Shield, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    const token = localStorage.getItem('token');
    if (token) setIsLoggedIn(true);
  }, []);

  if (!isMounted) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] font-sans selection:bg-[#ededed] selection:text-[#0a0a0a]">
      
      <header className="border-b border-neutral-800 bg-[#0a0a0a] sticky top-0 z-50">
        {/* ... Keep your exact header code here ... */}
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between h-14 items-center">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-white" />
              <span className="font-semibold text-sm tracking-wide">AssetFlow</span>
            </div>
            
            <div className="flex items-center gap-6">
              <Link href="/docs" className="text-xs font-medium text-neutral-400 hover:text-white transition-colors">Documentation</Link>
              {isLoggedIn ? (
                <Link href="/dashboard" className="text-xs font-semibold px-4 py-1.5 bg-white text-black hover:bg-neutral-200 transition-colors">
                  Go to Console
                </Link>
              ) : (
                <div className="flex items-center gap-4">
                  <Link href="/login" className="text-xs font-medium text-neutral-400 hover:text-white transition-colors">
                    Sign in
                  </Link>
                  <Link href="/register" className="text-xs font-semibold px-4 py-1.5 bg-white text-black hover:bg-neutral-200 transition-colors">
                    Sign up
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-24 md:py-32 overflow-hidden">
        
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="max-w-3xl"
        >
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-[1.1] text-white">
            Build secure document extraction pipelines.
          </h1>
          <p className="text-lg text-neutral-400 mb-10 leading-relaxed max-w-2xl">
            AssetFlow provides the backend infrastructure to upload, process, and extract text from complex documents using an event-driven, distributed OCR architecture.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href={isLoggedIn ? "/dashboard" : "/register"} className="flex items-center justify-center gap-2 px-6 py-3 bg-white hover:bg-neutral-200 text-black text-sm font-semibold transition-colors">
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
            <button className="flex items-center justify-center gap-2 px-6 py-3 bg-[#111111] hover:bg-[#1a1a1a] border border-neutral-800 text-white text-sm font-medium transition-colors">
              <Terminal className="w-4 h-4 text-neutral-400" /> npm install @assetflow/sdk
            </button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-neutral-800 border border-neutral-800 mt-24">
          {/* We stagger the appearance of the feature cards */}
          {[
            { icon: Database, title: "Zero-Block Storage", desc: "Direct-to-cloud uploads via presigned Minio URLs keep your core application fast." },
            { icon: Terminal, title: "Isolated Microservices", desc: "Heavy OCR workloads are offloaded to Redis-backed worker nodes." },
            { icon: Shield, title: "Verified Webhooks", desc: "Receive cryptographically signed JSON payloads the exact millisecond extraction succeeds." }
          ].map((feature, index) => (
            <motion.div 
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 + (index * 0.1) }}
              className="p-8 bg-[#0a0a0a] hover:bg-[#0f0f0f] transition-colors"
            >
              <feature.icon className="w-5 h-5 text-neutral-400 mb-4" />
              <h3 className="text-sm font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-neutral-500 text-sm leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}

"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Database, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion'; // <-- Import Framer Motion
import api from '../../lib/api';

// ... (Keep your state and handleLogin function exactly the same) ...
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const response = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#0a0a0a] text-[#ededed] font-sans">
      
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-12 lg:flex-none lg:w-[480px] border-r border-neutral-800 bg-[#0a0a0a] z-10">
        {/* Animate the form sliding in */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mx-auto w-full max-w-sm"
        >
          <div className="flex items-center gap-2 mb-10">
            <Database className="w-5 h-5 text-white" />
            <span className="font-semibold tracking-wide">AssetFlow</span>
          </div>
          <h2 className="text-2xl font-semibold text-white mb-2">Sign in to your console</h2>
          <p className="text-sm text-neutral-400 mb-8">
            Don&apos;t have an account? <Link href="/register" className="text-white hover:underline underline-offset-4">Sign up</Link>
          </p>

          {/* ... Keep the rest of your form exactly the same ... */}
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Form Inputs... */}
             <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5 uppercase tracking-wider">Email address</label>
              <input type="email" required className="block w-full px-3 py-2 bg-[#111111] border border-neutral-800 text-white placeholder-neutral-600 focus:border-white focus:ring-0 outline-none transition-colors sm:text-sm" placeholder="developer@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5 uppercase tracking-wider">Password</label>
              <input type="password" required className="block w-full px-3 py-2 bg-[#111111] border border-neutral-800 text-white placeholder-neutral-600 focus:border-white focus:ring-0 outline-none transition-colors sm:text-sm" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" disabled={isLoading} className="w-full flex justify-center items-center py-2.5 px-4 mt-6 border border-transparent text-sm font-semibold text-black bg-white hover:bg-neutral-200 disabled:bg-neutral-600 disabled:text-neutral-400 transition-colors">
              {isLoading ? <Loader2 className="animate-spin h-4 w-4" /> : 'Continue'}
            </button>
          </form>
        </motion.div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-[#111111] relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        {/* Animate the code block fading in slowly */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.3 }}
          className="relative z-10 text-neutral-500 font-mono text-xs opacity-50 select-none"
        >
          <pre>
{`{
  "system": "AssetFlow Auth",
  "status": "online",
  "protocol": "JWT Bearer",
  "node_id": "auth-gateway-xyz"
}`}
          </pre>
        </motion.div>
      </div>
      
    </div>
  );
}
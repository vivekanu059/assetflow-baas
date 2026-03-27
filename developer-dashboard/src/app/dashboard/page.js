"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Key, Webhook, X, Loader2, Copy, Check, ChevronLeft, ChevronRight, AlertTriangle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../lib/api';

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [dashboardData, setDashboardData] = useState({ assets: [], apiKey: '', webhookUrl: '', webhookSecret: '' });
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [isTableLoading, setIsTableLoading] = useState(true);

  // DLQ State
  const [failedWebhooks, setFailedWebhooks] = useState([]);
  const [isRetrying, setIsRetrying] = useState({});

  const [isMounted, setIsMounted] = useState(false);
  const router = useRouter();

  const [copied, setCopied] = useState(false);
  
  // --- NEW: Webhook specific states ---
  const [webhookInput, setWebhookInput] = useState('');
  const [isSavingWebhook, setIsSavingWebhook] = useState(false);
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalData, setModalData] = useState(null);

  // api-key generation state
  const [newApiKey, setNewApiKey] = useState(null);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);

  // Fetch Dashboard & DLQ Data
  const fetchDashboard = useCallback(async (page) => {
    setIsTableLoading(true);
    try {
      const response = await api.get(`/user/dashboard?page=${page}&limit=10`);
      setDashboardData({
        apiKey: response.data.apiKey,
        webhookUrl: response.data.webhookUrl,
        webhookSecret: response.data.webhookSecret, // Pull secret from DB if it exists
        assets: response.data.assets
      });
      // Set the input field to the user's saved URL
      setWebhookInput(response.data.webhookUrl || '');
      
      if (response.data.pagination) {
        setTotalPages(response.data.pagination.totalPages || 1);
        setTotalItems(response.data.pagination.total || 0);
      }

      const dlqResponse = await api.get('/user/webhooks/failed');
      setFailedWebhooks(dlqResponse.data.failedWebhooks || []);

    } catch (error) {
      console.error("Failed to load dashboard:", error);
    } finally {
      setIsTableLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
    const token = localStorage.getItem('token');
    const userDataString = localStorage.getItem('user');

    if (!token || !userDataString || userDataString === "undefined") {
      localStorage.clear();
      router.push('/login');
      return;
    }

    try {
      setUser(JSON.parse(userDataString));
      fetchDashboard(1);
    } catch (error) {
      console.error("Corrupted local storage data. Forcing logout.");
      localStorage.clear();
      router.push('/login');
    }
  }, [router, fetchDashboard]);
  
  // Handle Manual Webhook Replay
  const handleRetryWebhook = async (assetId) => {
    setIsRetrying(prev => ({ ...prev, [assetId]: true }));
    try {
      await api.post(`/user/webhooks/retry/${assetId}`);
      setFailedWebhooks(prev => prev.filter(w => w.assetId !== assetId));
    } catch (error) {
      console.error("Failed to retry webhook", error);
      alert("Failed to queue retry. Please check console.");
    } finally {
      setIsRetrying(prev => ({ ...prev, [assetId]: false }));
    }
  };

  const handleNextPage = () => { if (currentPage < totalPages) { const p = currentPage + 1; setCurrentPage(p); fetchDashboard(p); } };
  const handlePrevPage = () => { if (currentPage > 1) { const p = currentPage - 1; setCurrentPage(p); fetchDashboard(p); } };

  const handleGenerateKey = async () => {
    if (dashboardData.apiKey && !confirm("Warning: Generating a new key will permanently invalidate your old one. Are you sure?")) {
      return;
    }
    
    setIsGeneratingKey(true);
    try {
      const response = await api.post('/user/api-key/roll');
      setNewApiKey(response.data.apiKey);
      setDashboardData(prev => ({ ...prev, apiKey: 'sk_live_********************************' }));
    } catch (error) {
      console.error("Failed to generate key", error);
      alert("Failed to generate a new API Key.");
    } finally {
      setIsGeneratingKey(false);
    }
  };

  // --- NEW: The real save function connecting to your backend ---
  const handleSaveWebhook = async () => {
    if (!webhookInput) return alert("Please enter a valid URL");
    
    setIsSavingWebhook(true);
    try {
      const response = await api.put('/user/webhook', { webhookUrl: webhookInput });
      
      // Update state with the newly saved URL and generated Secret!
      setDashboardData(prev => ({
        ...prev,
        webhookUrl: response.data.webhookUrl,
        webhookSecret: response.data.webhookSecret
      }));
      
      setWebhookSaved(true);
      setTimeout(() => setWebhookSaved(false), 2000);
    } catch (error) {
      console.error("Failed to save webhook", error);
      alert("Failed to save webhook target.");
    } finally {
      setIsSavingWebhook(false);
    }
  };

  const handleLogout = () => { localStorage.removeItem('token'); localStorage.removeItem('user'); router.push('/login'); };

  const handleViewJson = async (assetId) => {
    setIsModalOpen(true);
    setModalLoading(true);
    setModalData(null);
    try {
      const response = await api.get(`/user/asset/${assetId}`);
      setModalData(response.data);
    } catch (error) {
      setModalData({ extractedText: "Error: Data not found." });
    } finally {
      setModalLoading(false);
    }
  };

  if (!isMounted || !user) return null;

  const renderStatusIndicator = (status) => {
    if (status === 'COMPLETED') return <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Ready</span>;
    if (status === 'FAILED') return <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>Failed</span>;
    return <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>Processing</span>;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] font-sans selection:bg-[#ededed] selection:text-[#0a0a0a]">
      
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.2 }}
              className="bg-[#0a0a0a] border border-neutral-800 w-full max-w-3xl flex flex-col max-h-[85vh] shadow-2xl"
            >
              <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-[#0a0a0a]">
                <span className="text-xs font-mono text-neutral-400">payload.json</span>
                <button onClick={() => setIsModalOpen(false)} className="text-neutral-500 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 bg-[#111111]">
                {modalLoading ? (
                  <div className="flex items-center gap-3 text-sm text-neutral-500 font-mono"><Loader2 className="w-4 h-4 animate-spin" /> FETCHING_DATA</div>
                ) : (
                  <pre className="text-[13px] text-neutral-300 font-mono whitespace-pre-wrap">
                    {JSON.stringify({ success: true, event: "asset.processed", data: { assetId: modalData?.assetId, originalName: modalData?.originalName, text: modalData?.extractedText } }, null, 2)}
                  </pre>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <header className="border-b border-neutral-800 bg-[#0a0a0a] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex justify-between h-14 items-center">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-white" />
              <span className="font-semibold text-sm tracking-wide">AssetFlow Console</span>
            </div>
            <div className="flex items-center gap-6">
              <span className="text-xs font-mono text-neutral-500">{user.email}</span>
              <button onClick={handleLogout} className="text-xs font-medium text-neutral-400 hover:text-white transition-colors">Log out</button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h2 className="text-sm font-semibold text-white mb-4">Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Secure Secret Key Card */}
            <div className="bg-[#111111] border border-neutral-800 p-5 flex flex-col justify-between">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-2"><Key className="w-4 h-4 text-neutral-400" /><h3 className="text-sm font-medium">API Key</h3></div>
                  <p className="text-xs text-neutral-500">
                    {newApiKey ? "Copy this now. You will never see it again." : "Authenticate your external integrations."}
                  </p>
                </div>
                {dashboardData.apiKey && !newApiKey && (
                  <button onClick={handleGenerateKey} disabled={isGeneratingKey} className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 hover:text-white transition-colors">
                    {isGeneratingKey ? "Rolling..." : "Roll Key"}
                  </button>
                )}
              </div>
              
              <div className="flex border border-neutral-800 bg-[#0a0a0a]">
                {newApiKey ? (
                  <>
                    <code className="flex-1 px-3 py-2 text-xs font-mono text-emerald-400 truncate flex items-center">
                      {newApiKey}
                    </code>
                    <button onClick={() => { navigator.clipboard.writeText(newApiKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="px-3 py-2 border-l border-neutral-800 hover:bg-neutral-900 transition-colors flex items-center justify-center w-10">
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-neutral-500" />}
                    </button>
                  </>
                ) : dashboardData.apiKey === null && !isTableLoading ? (
                  <button onClick={handleGenerateKey} disabled={isGeneratingKey} className="w-full px-3 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-200 transition-colors flex items-center justify-center gap-2">
                    {isGeneratingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate API Key"}
                  </button>
                ) : (
                  <>
                    <code className="flex-1 px-3 py-2 text-xs font-mono text-neutral-600 truncate flex items-center select-none">
                      {dashboardData.apiKey || 'Loading...'}
                    </code>
                    <button onClick={() => alert('For security reasons, API keys cannot be copied after you close the window. Please click "Roll Key" to generate a new one.')} className="px-3 py-2 border-l border-neutral-800 bg-[#050505] cursor-not-allowed flex items-center justify-center w-10">
                      <Copy className="w-4 h-4 text-neutral-800" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* --- UPDATED: Webhook Target Card --- */}
            <div className="bg-[#111111] border border-neutral-800 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2"><Webhook className="w-4 h-4 text-neutral-400" /><h3 className="text-sm font-medium">Webhook Target</h3></div>
                <p className="text-xs text-neutral-500 mb-4">Receive push events upon extraction completion.</p>
              </div>
              
              <div className="flex flex-col gap-4">
                <div className="flex border border-neutral-800 bg-[#0a0a0a]">
                  <input 
                    type="url" 
                    value={webhookInput}
                    onChange={(e) => setWebhookInput(e.target.value)}
                    placeholder="https://api.yourcompany.com/webhook" 
                    className="flex-1 px-3 py-2 text-xs font-mono text-neutral-300 bg-transparent outline-none focus:ring-0" 
                  />
                  <button 
                    onClick={handleSaveWebhook} 
                    disabled={isSavingWebhook}
                    className="px-4 py-2 border-l border-neutral-800 bg-white hover:bg-neutral-200 text-black text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSavingWebhook ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : webhookSaved ? 'Saved' : 'Save'}
                  </button>
                </div>

                {/* Securely display the auto-generated Webhook Secret */}
                {dashboardData.webhookSecret && (
                  <div className="p-3 bg-[#0a0a0a] border border-emerald-900/50 rounded flex flex-col gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-500 font-semibold">Webhook Secret Key</span>
                    <div className="flex justify-between items-center gap-2">
                      <code className="text-xs font-mono text-neutral-300 truncate">
                        {dashboardData.webhookSecret}
                      </code>
                      <button 
                        onClick={() => { navigator.clipboard.writeText(dashboardData.webhookSecret); setSecretCopied(true); setTimeout(() => setSecretCopied(false), 2000); }}
                        className="p-1 hover:bg-neutral-800 rounded transition-colors"
                      >
                        {secretCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-neutral-500 hover:text-white" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </motion.div>

        {/* The DLQ UI Panel */}
        {failedWebhooks.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
            <div className="flex items-center justify-between mb-4 mt-10">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <h2 className="text-sm font-semibold text-white">Delivery Failures (DLQ)</h2>
              </div>
              <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-mono uppercase tracking-wider rounded">
                Action Required
              </span>
            </div>
            
            <div className="border border-red-900/50 bg-[#110505]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#1a0505] border-b border-red-900/50">
                    <tr>
                      <th className="px-4 py-3 text-xs font-medium text-red-400 uppercase tracking-wider">Asset ID</th>
                      <th className="px-4 py-3 text-xs font-medium text-red-400 uppercase tracking-wider">Error Reason</th>
                      <th className="px-4 py-3 text-xs font-medium text-red-400 uppercase tracking-wider">Failed At</th>
                      <th className="px-4 py-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-900/30">
                    {failedWebhooks.map((hook, index) => (
                      <tr key={hook.assetId} className="hover:bg-[#1a0505] transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-red-300">{hook.assetId.split('-')[0]}...</td>
                        <td className="px-4 py-3 text-red-300 text-xs max-w-[200px] truncate">{hook.errorReason}</td>
                        <td className="px-4 py-3 text-xs font-mono text-red-400/70">{new Date(hook.failedAt).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          <button 
                            onClick={() => handleRetryWebhook(hook.assetId)}
                            disabled={isRetrying[hook.assetId]}
                            className="flex items-center justify-end gap-1.5 ml-auto text-xs font-semibold text-white hover:text-red-300 disabled:opacity-50 transition-colors"
                          >
                            {isRetrying[hook.assetId] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            Replay Event
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* Main Data Table Section */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.4 }}>
          <div className="flex items-center justify-between mb-4 mt-10">
            <h2 className="text-sm font-semibold text-white">Processed Assets</h2>
            <span className="text-xs font-mono text-neutral-500">Total: {totalItems} items</span>
          </div>
          
          <div className="border border-neutral-800 bg-[#111111]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0a0a0a] border-b border-neutral-800">
                  <tr>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Asset ID</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Filename</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Created At</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {isTableLoading ? (
                    <tr><td colSpan="5" className="px-4 py-8 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-neutral-500" /></td></tr>
                  ) : dashboardData.assets.length === 0 ? (
                    <tr><td colSpan="5" className="px-4 py-8 text-center text-xs text-neutral-500 font-mono">No data streams found.</td></tr>
                  ) : (
                    dashboardData.assets.map((asset, index) => (
                      <motion.tr key={asset.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: index * 0.05 }} className="hover:bg-[#161616] transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-neutral-400">{asset.id.split('-')[0]}...</td>
                        <td className="px-4 py-3 text-neutral-300 text-sm max-w-[200px] truncate">{asset.originalName}</td>
                        <td className="px-4 py-3 text-xs font-medium text-neutral-300">{renderStatusIndicator(asset.status)}</td>
                        <td className="px-4 py-3 text-xs font-mono text-neutral-500">{new Date(asset.createdAt).toISOString().split('T')[0]}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleViewJson(asset.id)} className={`text-xs font-semibold ${asset.status === 'COMPLETED' ? 'text-white hover:underline underline-offset-4' : 'text-neutral-600 cursor-not-allowed'}`} disabled={asset.status !== 'COMPLETED'}>View Payload</button>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-800 bg-[#0a0a0a]">
              <button onClick={handlePrevPage} disabled={currentPage === 1 || isTableLoading} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white disabled:text-neutral-600 hover:bg-neutral-900 disabled:hover:bg-transparent transition-colors rounded">
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-xs font-mono text-neutral-500">Page {currentPage} of {totalPages === 0 ? 1 : totalPages}</span>
              <button onClick={handleNextPage} disabled={currentPage >= totalPages || isTableLoading} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white disabled:text-neutral-600 hover:bg-neutral-900 disabled:hover:bg-transparent transition-colors rounded">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>

      </main>
    </div>
  );
}

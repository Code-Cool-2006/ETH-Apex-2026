import React, { useState, useEffect } from 'react';
import { Settings, Mail, RefreshCw, Send, Key, Shield, Eye, EyeOff, Copy, Zap, AlertTriangle, Bell, Heart, Wifi } from 'lucide-react';

export default function SettingsView() {
  const [config, setConfig] = useState({
    smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '', testEmail: '',
    securityProtocol: 'STARTTLS', authMethod: 'OAuth2 (Recommended)'
  });
  const [saveLoading, setSaveLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Triage alert toggles
  const [alertDesaturation, setAlertDesaturation] = useState(true);
  const [alertHeartRate, setAlertHeartRate] = useState(true);
  const [alertSignalLoss, setAlertSignalLoss] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/settings', {
          headers: { 'Authorization': 'Bearer admin_master_token_MEDISYNC' }
        });
        if (res.ok) {
          const data = await res.json();
          setConfig(prev => ({
            ...prev,
            smtpHost: 'smtp.gmail.com',
            smtpPort: 587,
            smtpUser: data.smtp_user_hint || '',
          }));
        }
      } catch (err) {
        console.warn("Could not fetch settings:", err.message);
      }
    };
    fetchSettings();
  }, []);

  const handleChange = (e) => {
    setConfig(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaveLoading(true);
    setStatusMessage('');
    try {
      const res = await fetch('http://localhost:8000/api/settings/save-smtp', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin_master_token_MEDISYNC'
        },
        body: JSON.stringify({
          smtp_host: config.smtpHost || 'smtp.gmail.com',
          smtp_port: parseInt(config.smtpPort) || 587,
          smtp_user: config.smtpUser,
          smtp_password: config.smtpPass
        })
      });
      if (res.ok) setStatusMessage('SMTP Settings applied successfully to Python service.');
      else {
        const errData = await res.json();
        setStatusMessage(`Failed to save settings: ${errData.detail || 'check values'}`);
      }
    } catch (err) {
      setStatusMessage('Connection error: ' + err.message);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTestEmail = async () => {
    if (!config.testEmail) { setStatusMessage('Enter a test email address.'); return; }
    setTestLoading(true);
    setStatusMessage('');
    try {
      const res = await fetch('http://localhost:8000/api/settings/test-email', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin_master_token_MEDISYNC'
        },
        body: JSON.stringify({ 
          to_email: config.testEmail,
          to_phone: "+15555555555" // dummy value to satisfy Twilio schema check
        })
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage('Test email dispatched successfully!');
      } else {
        setStatusMessage(`Failed: ${data.detail || 'SMTP credentials mismatch'}`);
      }
    } catch (err) {
      setStatusMessage('Test failed: ' + err.message);
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-primary font-label-caps text-label-caps mb-1">
            <Settings size={14} />
            <span>SYSTEM CONFIGURATION</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">Global Settings</h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-white/5 hover:bg-white/10 border border-white/10 text-on-surface font-bold px-5 py-2.5 rounded-lg text-sm transition-all active:scale-95">
            Discard Changes
          </button>
          <button 
            onClick={handleSave}
            disabled={saveLoading}
            className="bg-primary-container text-white font-bold px-5 py-2.5 rounded-lg text-sm hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
          >
            {saveLoading && <RefreshCw size={14} className="animate-spin" />}
            Apply All
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="glass-panel rounded-xl p-4 mb-6 text-sm text-secondary border-secondary/20">
          {statusMessage}
        </div>
      )}

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        
        {/* SMTP Gateway */}
        <section className="glass-panel rounded-xl p-6">
          <h2 className="font-headline-md text-headline-md flex items-center gap-3 mb-6">
            <Mail className="text-on-surface-variant" size={20} />
            SMTP Gateway
          </h2>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant block">Server Address</label>
                <input
                  name="smtpHost"
                  value={config.smtpHost}
                  onChange={handleChange}
                  placeholder="smtp.medisync-secure.io"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary/50 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant block">Port</label>
                <input
                  name="smtpPort"
                  value={config.smtpPort}
                  onChange={handleChange}
                  placeholder="587"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary/50 outline-none transition-all"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant block">Security Protocol</label>
                <select
                  name="securityProtocol"
                  value={config.securityProtocol}
                  onChange={handleChange}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary/50 outline-none transition-all appearance-none cursor-pointer"
                >
                  <option value="STARTTLS">STARTTLS</option>
                  <option value="SSL/TLS">SSL/TLS</option>
                  <option value="None">None</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="font-label-caps text-label-caps text-on-surface-variant block">Authentication</label>
                <select
                  name="authMethod"
                  value={config.authMethod}
                  onChange={handleChange}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary/50 outline-none transition-all appearance-none cursor-pointer"
                >
                  <option value="OAuth2 (Recommended)">OAuth2 (Recommended)</option>
                  <option value="App Password">App Password</option>
                  <option value="Basic Auth">Basic Auth</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 text-on-surface-variant text-sm">
                <div className="w-2 h-2 rounded-[0.75rem] bg-tertiary"></div>
                Ready for validation
              </div>
              <button 
                type="button"
                onClick={handleTestEmail}
                className="flex items-center gap-2 border border-secondary/30 text-secondary px-4 py-2 rounded-lg text-sm font-bold hover:bg-secondary/10 active:scale-95 transition-all"
              >
                <Zap size={14} />
                Test Connection
              </button>
            </div>
          </form>
        </section>

        {/* API Keys */}
        <section className="glass-panel rounded-xl p-6">
          <h2 className="font-headline-md text-headline-md flex items-center gap-3 mb-6">
            <Key className="text-on-surface-variant" size={20} />
            API Keys
          </h2>
          <div className="space-y-4">
            {/* Telemetry Write Access */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-on-surface font-medium">Telemetry Write Access</span>
                <span className="text-[10px] font-label-caps text-secondary border border-secondary/20 bg-secondary/10 px-2 py-0.5 rounded">Active</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={config.smtpPass || '••••••••••••••••••••••••'}
                  readOnly
                  className="flex-1 bg-transparent border-none text-on-surface-variant text-sm tracking-widest outline-none"
                />
                <button onClick={() => navigator.clipboard.writeText(config.smtpPass)} className="text-on-surface-variant hover:text-on-surface p-1 transition-colors">
                  <Copy size={16} />
                </button>
                <button onClick={() => setShowPassword(!showPassword)} className="text-on-surface-variant hover:text-on-surface p-1 transition-colors">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* EMS Dispatch Read */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 opacity-60">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-on-surface font-medium">EMS Dispatch Read</span>
                <span className="text-[10px] font-label-caps text-on-surface-variant">Expired 12d ago</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="password" value="••••••••••••••••••••••••" readOnly className="flex-1 bg-transparent border-none text-on-surface-variant text-sm tracking-widest outline-none" />
                <button className="text-on-surface-variant hover:text-on-surface p-1 transition-colors">
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            <button className="w-full border border-white/10 hover:bg-white/5 py-3 rounded-lg text-sm text-on-surface-variant transition-all">
              + Generate New Endpoint Key
            </button>
          </div>
        </section>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Triage Alerts */}
        <section className="glass-panel rounded-xl p-6">
          <h2 className="font-headline-md text-headline-md flex items-center gap-3 mb-6">
            <Bell className="text-on-surface-variant" size={20} />
            Triage Alerts
          </h2>
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-on-surface font-medium">Critical Desaturation</p>
                <p className="text-xs text-on-surface-variant">Immediate SpO2 drop alert</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={alertDesaturation} onChange={() => setAlertDesaturation(!alertDesaturation)} />
                <span className="slider-toggle"></span>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-on-surface font-medium">Heart Rate Anomalies</p>
                <p className="text-xs text-on-surface-variant">Arrhythmia detection trigger</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={alertHeartRate} onChange={() => setAlertHeartRate(!alertHeartRate)} />
                <span className="slider-toggle"></span>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-on-surface font-medium">Telemetry Signal Loss</p>
                <p className="text-xs text-on-surface-variant">Sensor disconnection warnings</p>
              </div>
              <label className="switch">
                <input type="checkbox" checked={alertSignalLoss} onChange={() => setAlertSignalLoss(!alertSignalLoss)} />
                <span className="slider-toggle"></span>
              </label>
            </div>
          </div>
        </section>

        {/* Cloud Latency Map */}
        <section className="glass-panel rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-headline-md text-headline-md flex items-center gap-3">
              <Wifi className="text-on-surface-variant" size={20} />
              Cloud Latency Map
            </h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-[0.75rem] bg-secondary"></div> Active</span>
              <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-[0.75rem] bg-primary-container"></div> Congested</span>
            </div>
          </div>
          <div className="bg-black/30 rounded-lg p-8 flex flex-col items-center justify-center mb-4 min-h-[140px] border border-white/5">
            <span className="text-5xl font-display-vitals text-secondary tracking-tight">24ms</span>
            <span className="font-label-caps text-label-caps text-secondary mt-1">STABLE UPLINK</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
              <div className="text-[10px] font-label-caps text-on-surface-variant mb-1">UPTIME</div>
              <div className="text-sm font-bold text-on-surface">99.98%</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
              <div className="text-[10px] font-label-caps text-on-surface-variant mb-1">PACKETS</div>
              <div className="text-sm font-bold text-on-surface">0.02% Loss</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
              <div className="text-[10px] font-label-caps text-on-surface-variant mb-1">PEAK</div>
              <div className="text-sm font-bold text-on-surface">142ms</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
              <div className="text-[10px] font-label-caps text-on-surface-variant mb-1">NODES</div>
              <div className="text-sm font-bold text-on-surface">12 Global</div>
            </div>
          </div>
        </section>
      </div>

      {/* Test Email Section */}
      <div className="mt-6 glass-panel rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Send className="text-on-surface-variant" size={20} />
          <div>
            <h3 className="text-sm font-bold text-on-surface">Simulated Dispatch Handshake</h3>
            <p className="text-xs text-on-surface-variant">Verify SMTP relay directly to a test recipient.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <input
            type="email"
            name="testEmail"
            value={config.testEmail}
            onChange={handleChange}
            placeholder="recipient@example.com"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary/50 outline-none transition-all"
          />
          <button
            type="button"
            onClick={handleTestEmail}
            disabled={testLoading}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-on-surface font-bold px-5 py-2.5 rounded-lg flex items-center gap-2 active:scale-95 transition-all text-sm"
          >
            {testLoading ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
            Trigger Test
          </button>
        </div>
      </div>
    </div>
  );
}

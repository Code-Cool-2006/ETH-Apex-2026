import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Phone, Mail, MessageSquare, MapPin, UserPlus, Trash, Shield, Check, RefreshCw, Send, Heart, CheckCircle } from 'lucide-react';

export default function SOSView() {
  const [coords, setCoords] = useState(null);
  const [contacts, setContacts] = useState([
    { name: 'Dr. Jane Smith (Primary ER)', phone: '+919876543210', email: 'jane.smith@example.com' }
  ]);
  const [newContact, setNewContact] = useState({ name: '', phone: '', email: '' });
  const [holdProgress, setHoldProgress] = useState(0);
  const [sosTriggered, setSosTriggered] = useState(false);
  const [contactsApiSupported, setContactsApiSupported] = useState(false);
  
  const holdIntervalRef = useRef(null);

  useEffect(() => {
    if ('contacts' in navigator && 'select' in navigator.contacts) {
      setContactsApiSupported(true);
    }
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (err) => { console.error("GPS Acquisition failed:", err); setCoords({ lat: 34.0522, lng: -118.2437, accuracy: 10 }); },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  }, []);

  const handleStartHold = () => {
    if (sosTriggered) return;
    holdIntervalRef.current = setInterval(() => {
      setHoldProgress((prev) => {
        if (prev >= 100) {
          clearInterval(holdIntervalRef.current);
          setSosTriggered(true);
          triggerSOS();
          return 100;
        }
        return prev + 1.5;
      });
    }, 50);
  };

  const handleEndHold = () => {
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    if (!sosTriggered) setHoldProgress(0);
  };

  const triggerSOS = () => {
    console.log("SOS Triggered! Location:", coords);
    fetch('http://localhost:8000/api/sos/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_name: "Patient-SOS",
        lat: coords ? coords.lat : 34.0522,
        lng: coords ? coords.lng : -118.2437,
        condition: "Medical Emergency",
        contacts: contacts.map(c => ({
          name: c.name,
          phone: c.phone,
          email: c.email || "",
          relation: "Family"
        }))
      })
    }).catch(err => console.error("Failed to post SOS to server:", err));
  };

  const refreshLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => {},
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  };

  const mapsLink = coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : 'https://maps.google.com';
  const smsBody = `EMERGENCY SOS! I need help. My current location is: ${mapsLink}`;
  const mailSubject = `EMERGENCY ALERT: MediSyncAI SOS`;
  const mailBody = `I have triggered an emergency SOS from MediSyncAI. Location: ${mapsLink}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(smsBody)}`;

  // SVG circle progress
  const circumference = 2 * Math.PI * 90;
  const dashOffset = circumference - (holdProgress / 100) * circumference;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">Emergency Signal</h1>
        <p className="text-on-surface-variant text-sm">Hold for 3 seconds to dispatch help</p>
      </div>

      {/* SOS Button */}
      <div className="flex justify-center mb-10">
        <div className="relative">
          <button
            onMouseDown={handleStartHold}
            onMouseUp={handleEndHold}
            onMouseLeave={handleEndHold}
            onTouchStart={handleStartHold}
            onTouchEnd={handleEndHold}
            className={`w-48 h-48 rounded-xl flex flex-col items-center justify-center gap-3 transition-all select-none cursor-pointer ${
              sosTriggered 
                ? 'bg-secondary/20 border-2 border-secondary' 
                : 'bg-gradient-to-br from-primary-container to-[#be0037] border-2 border-primary-container shadow-[0_0_60px_rgba(225,29,72,0.4)] hover:shadow-[0_0_80px_rgba(225,29,72,0.6)] active:scale-95'
            }`}
          >
            {sosTriggered ? (
              <CheckCircle size={48} className="text-secondary" />
            ) : (
              <>
                <div className="w-12 h-12 border-2 border-white/50 rounded-lg flex items-center justify-center rotate-45">
                  <AlertTriangle size={24} className="text-white -rotate-45" />
                </div>
                <span className="text-white font-bold text-xl tracking-tight">SOS</span>
              </>
            )}
          </button>
          {/* Progress ring overlay */}
          {holdProgress > 0 && !sosTriggered && (
            <svg className="absolute inset-0 w-48 h-48 pointer-events-none -rotate-90" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
              <circle cx="100" cy="100" r="90" fill="none" stroke="#4edea3" strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset} className="transition-all duration-100" />
            </svg>
          )}
        </div>
      </div>

      {/* Live Location */}
      <div className="glass-panel rounded-xl p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin className="text-primary" size={18} />
          <div>
            <div className="font-label-caps text-[10px] text-on-surface-variant uppercase">LIVE LOCATION</div>
            <div className="text-secondary font-label-caps text-sm mt-0.5">
              {coords ? `${coords.lat.toFixed(4)}° N, ${Math.abs(coords.lng).toFixed(4)}° W` : 'Acquiring GPS...'}
            </div>
          </div>
        </div>
        <button onClick={refreshLocation} className="text-on-surface-variant hover:text-on-surface p-2 hover:bg-white/5 rounded-lg transition-all">
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Emergency Contacts */}
      <div className="mb-6">
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-4">Emergency Contacts</h3>
        <div className="grid grid-cols-3 gap-4">
          <a 
            href={contacts[0] ? `tel:${contacts[0].phone}` : '#'}
            className="glass-panel rounded-xl p-5 flex flex-col items-center gap-3 hover:bg-white/[0.04] transition-all cursor-pointer"
          >
            <Phone className="text-on-surface-variant" size={24} />
            <span className="font-label-caps text-label-caps text-on-surface-variant">CALL</span>
          </a>
          <a 
            href={contacts[0] ? `sms:${contacts[0].phone}?body=${encodeURIComponent(smsBody)}` : '#'}
            className="glass-panel rounded-xl p-5 flex flex-col items-center gap-3 hover:bg-white/[0.04] transition-all cursor-pointer"
          >
            <MessageSquare className="text-on-surface-variant" size={24} />
            <span className="font-label-caps text-label-caps text-on-surface-variant">SMS</span>
          </a>
          <a 
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-panel rounded-xl p-5 flex flex-col items-center gap-3 hover:bg-white/[0.04] transition-all cursor-pointer"
          >
            <MessageSquare className="text-on-surface-variant" size={24} />
            <span className="font-label-caps text-label-caps text-on-surface-variant">WHATSAPP</span>
          </a>
        </div>
      </div>

      {/* Quick Assist */}
      <div>
        <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-4">Quick Assist</h3>
        <div className="space-y-3">
          <a 
            href={`mailto:${contacts[0]?.email || ''}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`}
            className="glass-panel rounded-xl p-4 flex items-center justify-between hover:bg-white/[0.04] transition-all cursor-pointer group"
          >
            <div>
              <h4 className="text-sm font-bold text-on-surface">Send Critical Update</h4>
              <p className="text-xs text-on-surface-variant mt-0.5">"Dispatch, requesting immediate assistance at [{coords ? `${coords.lat.toFixed(4)}` : '...'}...</p>
            </div>
            <Send className="text-on-surface-variant group-hover:text-primary transition-colors" size={18} />
          </a>

          <div className="glass-panel rounded-xl p-4 flex items-center justify-between border-l-4 border-l-primary-container cursor-pointer hover:bg-white/[0.04] transition-all group">
            <div>
              <h4 className="text-sm font-bold text-on-surface">Cardiac Alert</h4>
              <p className="text-xs text-on-surface-variant mt-0.5">Immediate notification to cardiac response team with vitals.</p>
            </div>
            <Heart className="text-primary group-hover:text-primary-container transition-colors" size={18} />
          </div>

          <div className="glass-panel rounded-xl p-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.04] transition-all group">
            <div>
              <h4 className="text-sm font-bold text-on-surface">Report Stable State</h4>
              <p className="text-xs text-on-surface-variant mt-0.5">"Vitals normalized. Cancelling previous alert."</p>
            </div>
            <CheckCircle className="text-secondary group-hover:text-secondary transition-colors" size={18} />
          </div>
        </div>
      </div>
    </div>
  );
}

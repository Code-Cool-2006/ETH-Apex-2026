import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, ShieldAlert, Navigation, Database, Radio, Wifi, WifiOff, Volume2, Mic, Settings, Play, Check, Send } from 'lucide-react';

const SpeechRecognitionAPI =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

function useVoiceDictation({ onTranscriptUpdate }) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(!!SpeechRecognitionAPI);
  const [speechError, setSpeechError] = useState("");
  const recognitionRef = useRef(null);
  const callbackRef = useRef(onTranscriptUpdate);

  useEffect(() => {
    callbackRef.current = onTranscriptUpdate;
  }, [onTranscriptUpdate]);

  useEffect(() => {
    if (!SpeechRecognitionAPI) return;
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalTranscript += result[0].transcript;
      }
      if (finalTranscript.trim() && callbackRef.current) callbackRef.current(finalTranscript.trim());
    };
    recognition.onerror = (event) => {
      console.error(event.error);
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening((wasListening) => {
        if (wasListening) {
          try { recognition.start(); } catch (e) {}
        }
        return wasListening;
      });
    };
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, []);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setSpeechError("");
    setIsListening((prev) => {
      const next = !prev;
      if (next) {
        try { recognitionRef.current.start(); } catch (e) {}
      } else {
        recognitionRef.current.stop();
      }
      return next;
    });
  }, []);

  return { isListening, isSupported, speechError, toggleListening };
}

function ECGOscilloscope({ heartRate }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let frameId;
    let x = 0;
    const points = [];
    const draw = () => {
      ctx.fillStyle = 'rgba(19, 19, 21, 0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#4edea3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < canvas.width; i++) {
        const y = canvas.height / 2 + Math.sin((i + x) * 0.05) * 15 * (Math.sin((i + x) * 0.01) > 0.7 ? 2 : 0.2);
        if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
      }
      ctx.stroke();
      x += (heartRate / 60) * 2;
      frameId = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frameId);
  }, [heartRate]);
  return <canvas ref={canvasRef} className="w-full h-24 bg-black/40 rounded-lg border border-white/5" width="400" height="96" />;
}

export default function AmbulanceView({ socket, gpsSocket, socketConnected, ambulances, hospitals, trips, setActiveTrip, refreshTrips, setMapFocus, onNewDispatch, simulations, setSimulations }) {
  const [selectedAmbId, setSelectedAmbId] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [offlineBuffer, setOfflineBuffer] = useState([]);
  const [scanning, setScanning] = useState(false);

  const createDefaultSimState = (ambId) => {
    const amb = ambulances.find(a => a.id === ambId);
    return {
      activeTrip: null,
      patientName: 'PT-9283',
      patientAge: '52',
      symptoms: 'Patient presenting with acute myocardial infarction indicators. ST-elevation detected in Lead II telemetry. Cath lab prep requested.',
      vitals: { hr: 142, spo2: 88, systolicBP: 90, temp: 37.2, respRate: 26 },
      routePoints: [],
      currentRouteIndex: 0,
      isDriving: false,
      currentLoc: amb ? { lat: amb.lat, lng: amb.lng } : { lat: 15.852, lng: 74.504 },
      speed: 0,
      heading: 0
    };
  };

  const getSim = (ambId) => simulations[ambId] || createDefaultSimState(ambId);

  const updateSimField = (ambId, field, val) => {
    setSimulations(prev => {
      const sim = prev[ambId] || createDefaultSimState(ambId);
      return { ...prev, [ambId]: { ...sim, [field]: val } };
    });
  };

  const updateSimVital = (ambId, vital, val) => {
    setSimulations(prev => {
      const sim = prev[ambId] || createDefaultSimState(ambId);
      return { ...prev, [ambId]: { ...sim, vitals: { ...sim.vitals, [vital]: val } } };
    });
  };

  const interpolatePoints = (start, end, steps = 30) => {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({ lat: start.lat + (end.lat - start.lat) * t, lng: start.lng + (end.lng - start.lng) * t });
    }
    return points;
  };

  const fetchOSRMRoute = async (start, end) => {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.routes && data.routes.length > 0) return data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      }
    } catch (err) { console.warn(err); }
    return interpolatePoints(start, end, 30);
  };

  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState({
    'AMB-01': [
      { sender: 'ai', text: 'Hello! I am your AI Medical Advisor. I am monitoring Rescue 402\'s live telemetry stream. How can I assist with this patient?' }
    ],
    'AMB-02': [
      { sender: 'ai', text: 'Hello! I am your AI Medical Advisor. I am monitoring BLS Unit 12\'s live telemetry stream. How can I assist with this patient?' }
    ],
    'AMB-03': [
      { sender: 'ai', text: 'Hello! I am your AI Medical Advisor. I am monitoring ALS Rescue 08\'s live telemetry stream. How can I assist with this patient?' }
    ]
  });

  const handleSendChat = (e, presetText = null) => {
    if (e) e.preventDefault();
    const userMessage = presetText || chatInput.trim();
    if (!userMessage || !selectedAmbId) return;

    if (!presetText) setChatInput('');

    // Append user message
    setChatHistory(prev => ({
      ...prev,
      [selectedAmbId]: [...(prev[selectedAmbId] || []), { sender: 'user', text: userMessage }]
    }));

    // Generate AI response
    setTimeout(() => {
      const sim = getSim(selectedAmbId);
      let aiResponse = "";

      const msgLower = userMessage.toLowerCase();
      if (msgLower.includes('vital') || msgLower.includes('hr') || msgLower.includes('spo2') || msgLower.includes('score')) {
        aiResponse = `The patient's current vitals show a heart rate of ${sim.vitals.hr} BPM and SpO2 at ${sim.vitals.spo2}%. This computes to a NEWS2 score of ${sim.activeTrip?.news2_score || 6}. Continuous supplemental oxygen and cardiac monitoring are highly advised.`;
      } else if (msgLower.includes('protocol') || msgLower.includes('treat') || msgLower.includes('do')) {
        aiResponse = `Recommended Protocol: \n1. Administer high-flow oxygen to maintain SpO2 > 94%.\n2. Establish IV access and prepare emergency medications.\n3. Request immediate trauma bay setup at ${hospitals.find(h => h.id === sim.activeTrip?.hospital_id)?.name || 'MediSync Central'}.`;
      } else if (msgLower.includes('symptom') || msgLower.includes('condition') || msgLower.includes('ecg')) {
        aiResponse = `Diagnostic assessment: "${sim.symptoms}". The ST-elevation telemetry indicates acute coronary syndrome. Preparing the cardiac cath lab bay is critical.`;
      } else {
        aiResponse = `Understood. Based on the patient's symptoms (${sim.activeTrip ? sim.symptoms.slice(0, 50) + "..." : "Stable baseline"}), please prioritize airway management and prepare for immediate handover at the designated Level 1 trauma bay.`;
      }

      setChatHistory(prev => ({
        ...prev,
        [selectedAmbId]: [...(prev[selectedAmbId] || []), { sender: 'ai', text: aiResponse }]
      }));
    }, 800);
  };

  const onVoiceTranscript = useCallback((chunk) => {
    if (!selectedAmbId) return;
    setSimulations(prev => {
      const sim = prev[selectedAmbId] || createDefaultSimState(selectedAmbId);
      return { ...prev, [selectedAmbId]: { ...sim, symptoms: sim.symptoms ? `${sim.symptoms.trim()} ${chunk}` : chunk } };
    });
  }, [selectedAmbId]);

  const { isListening, isSupported, speechError, toggleListening } = useVoiceDictation({ onTranscriptUpdate: onVoiceTranscript });

  useEffect(() => {
    if (ambulances && ambulances.length > 0 && !selectedAmbId) {
      setSelectedAmbId(ambulances[0].id);
    }
  }, [ambulances, selectedAmbId]);

  const handleOfflineToggle = (e) => {
    setIsOffline(e.target.checked);
  };

  const startDispatch = async (e) => {
    e.preventDefault();
    if (!selectedAmbId) return;
    const sim = getSim(selectedAmbId);
    
    const newPatientId = "PT-" + Math.random().toString(36).substr(2, 9).toUpperCase();
    const hr = sim.vitals.hr;
    const spo2 = sim.vitals.spo2;
    const localUrgency = (hr > 120 || spo2 < 90) ? 'critical' : (hr > 100 || spo2 < 95) ? 'urgent' : 'stable';
    const localScore = localUrgency === 'critical' ? 6 : 2;

    const patientData = {
      id: newPatientId,
      name: sim.patientName,
      age: parseInt(sim.patientAge) || 52,
      symptoms: sim.symptoms,
      urgency: localUrgency,
      status: "EnRoute",
      vitals: {
        hr: sim.vitals.hr,
        spo2: sim.vitals.spo2,
        bpSys: sim.vitals.systolicBP,
        bpDia: 60,
        temp: sim.vitals.temp,
        news2Score: localScore
      },
      assignedHospital: {
        id: "HOSP-01"
      },
      ambulanceId: selectedAmbId,
      ambulanceCallsign: ambulances.find(a => a.id === selectedAmbId)?.callsign || "Rescue Unit"
    };

    if (onNewDispatch) {
      onNewDispatch(patientData);
    }

    const hospital = hospitals.find(h => h.id === "HOSP-01");
    const amb = ambulances.find(a => a.id === selectedAmbId);
    const start = { lat: amb?.lat || 15.852, lng: amb?.lng || 74.504 };
    const end = { lat: hospital?.lat || 15.8828, lng: hospital?.lng || 74.5242 };
    const points = await fetchOSRMRoute(start, end);

    setSimulations(prev => ({
      ...prev,
      [selectedAmbId]: {
        ...sim,
        activeTrip: {
          id: newPatientId,
          ambulance_id: selectedAmbId,
          patient_name: sim.patientName,
          patient_age: sim.patientAge,
          symptoms: sim.symptoms,
          urgency: localUrgency,
          hospital_id: "HOSP-01",
          news2_score: localScore
        },
        routePoints: points,
        currentRouteIndex: 0,
        isDriving: true,
        currentLoc: start
      }
    }));

    if (setActiveTrip) {
      setActiveTrip({
        id: newPatientId,
        ambulance_id: selectedAmbId,
        patient_name: sim.patientName,
        patient_age: sim.patientAge,
        symptoms: sim.symptoms,
        urgency: localUrgency,
        hospital_id: "HOSP-01",
        news2_score: localScore
      });
    }
  };

  const completeTrip = async () => {
    const sim = getSim(selectedAmbId);
    if (!sim.activeTrip) return;
    setSimulations(prev => { const next = { ...prev }; delete next[selectedAmbId]; return next; });
    if (setActiveTrip) setActiveTrip(null);
  };

  const redirectHospital = async (hospId) => {
    const sim = getSim(selectedAmbId);
    if (!sim.activeTrip) return;
    const hospital = hospitals.find(h => h.id === hospId);
    const points = interpolatePoints(sim.currentLoc, { lat: hospital?.lat || 15.8828, lng: hospital?.lng || 74.5242 }, 30);
    setSimulations(prev => ({
      ...prev,
      [selectedAmbId]: {
        ...sim,
        activeTrip: {
          ...sim.activeTrip,
          hospital_id: hospId
        },
        routePoints: points,
        currentRouteIndex: 0,
        isDriving: true
      }
    }));
  };

  const runMedicalScan = () => {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      updateSimVital(selectedAmbId, 'hr', Math.round(70 + Math.random() * 20));
      updateSimVital(selectedAmbId, 'spo2', Math.round(95 + Math.random() * 4));
    }, 2000);
  };

  const applyScenario = (type) => {
    if (!selectedAmbId) return;
    const presets = {
      cardiac: { patientName: 'PT-9283', patientAge: '52', symptoms: 'Patient presenting with acute myocardial infarction indicators. ST-elevation detected in Lead II telemetry. Cath lab prep requested.', vitals: { hr: 142, spo2: 88, systolicBP: 90, temp: 37.2, respRate: 26 } },
      trauma: { patientName: 'PT-4412', patientAge: '28', symptoms: 'Moderate respiratory distress following blunt force trauma to the chest. Oxygen saturation fluctuating between 92-94%. Possible pneumothorax.', vitals: { hr: 110, spo2: 94, systolicBP: 105, temp: 36.6, respRate: 22 } },
      respiratory: { patientName: 'PT-1109', patientAge: '67', symptoms: 'Stable respiratory baseline, minor dyspnea reported.', vitals: { hr: 78, spo2: 98, systolicBP: 120, temp: 36.8, respRate: 16 } },
      minor: { patientName: 'PT-0512', patientAge: '19', symptoms: 'Minor laceration on left forearm, bleeding controlled. Vitals stable.', vitals: { hr: 72, spo2: 99, systolicBP: 115, temp: 36.5, respRate: 14 } }
    };
    const p = presets[type];
    if (p) {
      setSimulations(prev => {
        const sim = prev[selectedAmbId] || createDefaultSimState(selectedAmbId);
        return { ...prev, [selectedAmbId]: { ...sim, ...p } };
      });
    }
  };

  const currentSim = getSim(selectedAmbId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* Ambulance Cards Selector Grid */}
      <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {ambulances.map(a => {
          const sim = getSim(a.id);
          const isActive = selectedAmbId === a.id;
          const isEnroute = !!sim.activeTrip;
          return (
            <div 
              key={a.id}
              onClick={() => setSelectedAmbId(a.id)}
              className={`glass-panel rounded-xl p-5 cursor-pointer transition-all border-l-4 ${
                isActive ? 'border-primary ring-1 ring-primary/30 bg-white/[0.03]' : 'border-white/10 hover:bg-white/[0.01]'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-base text-on-surface">{a.callsign}</h3>
                <span className={`text-[9px] font-bold font-label-caps px-2 py-0.5 rounded ${
                  isEnroute ? 'bg-secondary/20 text-secondary border border-secondary/30' : 'bg-surface-container-highest text-on-surface-variant'
                }`}>
                  {isEnroute ? 'ENROUTE' : 'IDLE'}
                </span>
              </div>
              {isEnroute ? (
                <div className="space-y-1 mt-2">
                  <p className="text-xs text-on-surface-variant font-medium">Patient: {sim.patientName}</p>
                  <p className="text-[10px] text-primary font-bold uppercase tracking-wider">Active Telemetry Stream</p>
                </div>
              ) : (
                <p className="text-xs text-on-surface-variant mt-2 italic">Ready for dispatch.</p>
              )}
            </div>
          );
        })}
      </div>

      {/* ===== Left 8 cols: Active Terminal ===== */}
      <div className="lg:col-span-8 space-y-6">
        
        {/* Terminal Header */}
        <div className="glass-panel rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-container/20 flex items-center justify-center">
              <Activity className="text-primary-container animate-pulse" size={20} />
            </div>
            <div>
              <div className="text-[10px] text-on-surface-variant font-label-caps uppercase">EMT TRANSCRIPTION HUB</div>
              <h2 className="text-lg font-bold">{ambulances.find(a => a.id === selectedAmbId)?.callsign || 'Rescue Unit'} Console</h2>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-on-surface-variant">Network</span>
              <label className="switch">
                <input type="checkbox" checked={isOffline} onChange={handleOfflineToggle} />
                <span className="slider-toggle"></span>
              </label>
            </div>
          </div>
        </div>

        {/* Blueprint Quick Loader Tabs */}
        {!currentSim.activeTrip && (
          <section className="glass-panel rounded-xl p-5">
            <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-4">Quick Load Scenarios</h3>
            <div className="grid grid-cols-4 gap-3">
              <button onClick={() => applyScenario('cardiac')} className="bg-white/5 hover:bg-white/10 border border-white/10 text-on-surface text-xs font-bold py-2.5 rounded-lg transition-all">Cardiac</button>
              <button onClick={() => applyScenario('trauma')} className="bg-white/5 hover:bg-white/10 border border-white/10 text-on-surface text-xs font-bold py-2.5 rounded-lg transition-all">Trauma</button>
              <button onClick={() => applyScenario('respiratory')} className="bg-white/5 hover:bg-white/10 border border-white/10 text-on-surface text-xs font-bold py-2.5 rounded-lg transition-all">Stroke</button>
              <button onClick={() => applyScenario('minor')} className="bg-white/5 hover:bg-white/10 border border-white/10 text-on-surface text-xs font-bold py-2.5 rounded-lg transition-all">Other</button>
            </div>
          </section>
        )}

        {/* Triage Workspace Placeholder */}
        {!currentSim.activeTrip ? (
          <div className="glass-panel rounded-xl p-8 text-center space-y-4">
            <Radio size={36} className="mx-auto text-on-surface-variant opacity-40 animate-pulse" />
            <h3 className="text-base font-bold text-on-surface">No Active Triage Session</h3>
            <p className="text-xs text-on-surface-variant max-w-sm mx-auto">
              This terminal is ready for diagnostic stream monitoring. Click "New Dispatch" in the sidebar to configure a patient ticket and launch telemetry.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Live vitals summary / Waveform */}
            <div className="glass-panel rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-[0.75rem] bg-secondary animate-pulse"></span>
                  <span className="font-label-caps text-xs">LIVE ECG / LEAD II</span>
                </div>
              </div>
              <ECGOscilloscope heartRate={currentSim.vitals.hr} />
            </div>

            {/* Vitals Cards near ECG */}
            <div className="grid grid-cols-3 gap-4">
              <div className="glass-panel rounded-xl p-4 flex flex-col justify-between">
                <span className="text-[10px] text-on-surface-variant font-label-caps uppercase">HEART RATE & SPO2</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-primary">{currentSim.vitals.hr}</span>
                  <span className="text-xs text-on-surface-variant">BPM</span>
                </div>
                <span className="text-[10px] text-on-surface-variant mt-1">SpO2: {currentSim.vitals.spo2}%</span>
              </div>
              <div className="glass-panel rounded-xl p-4 flex flex-col justify-between">
                <span className="text-[10px] text-on-surface-variant font-label-caps uppercase">BLOOD PRESSURE</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-primary">{currentSim.vitals.systolicBP}/60</span>
                  <span className="text-xs text-on-surface-variant">mmHg</span>
                </div>
                <span className="text-[10px] text-on-surface-variant mt-1">Mean Arterial: Auto</span>
              </div>
              <div className="glass-panel rounded-xl p-4 flex flex-col justify-between">
                <span className="text-[10px] text-on-surface-variant font-label-caps uppercase">TEMPERATURE</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-primary">{currentSim.vitals.temp || '37.2'}</span>
                  <span className="text-xs text-on-surface-variant">°C</span>
                </div>
                <span className="text-[10px] text-on-surface-variant mt-1">Core Temp Link: Active</span>
              </div>
            </div>

            {/* Transcription dictation */}
            <div className="glass-panel rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-xs text-on-surface-variant">CREW VOICE HANDOVER DICTATION</span>
                {isSupported && (
                  <button type="button" onClick={toggleListening} className={`px-4 py-1.5 rounded-lg text-xs font-bold font-label-caps flex items-center gap-2 ${isListening ? 'bg-primary-container text-white animate-pulse' : 'bg-white/5 text-on-surface-variant hover:bg-white/10'}`}>
                    <Mic size={14} /> {isListening ? 'LISTENING...' : 'TAP TO TALK'}
                  </button>
                )}
              </div>
              <textarea value={currentSim.symptoms} onChange={(e) => updateSimField(selectedAmbId, 'symptoms', e.target.value)} rows="3" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface focus:ring-1 focus:ring-secondary/50 outline-none transition-all" />
            </div>

            {/* Diagnostics Peripherals */}
            <div className="glass-panel rounded-xl p-5 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-sm">Diagnostic Peripherals Link</h4>
                <p className="text-xs text-on-surface-variant mt-0.5">Stream direct sensor imaging telemetry</p>
              </div>
              <button onClick={runMedicalScan} className="bg-secondary text-on-secondary-container px-4 py-2 rounded-lg text-xs font-bold hover:brightness-110 active:scale-95 transition-all">
                {scanning ? 'LINKING SENSORS...' : 'RUN ECG SCAN'}
              </button>
            </div>

            {/* Hand off button */}
            <button onClick={completeTrip} className="w-full bg-secondary text-on-secondary-container py-3 rounded-lg font-bold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2">
              <Check size={18} /> Complete Patient Handover
            </button>
          </div>
        )}
      </div>

      {/* ===== Right 4 cols: Hospital Allocation & Chatbot ===== */}
      <div className="lg:col-span-4 space-y-6">
        
        {/* Capability Route */}
        <section className="glass-panel rounded-xl p-5">
          <h3 className="font-headline-md text-[16px] font-semibold text-on-surface mb-4">ER Capability Route</h3>
          <div className="space-y-3">
            {hospitals.map(h => {
              const isAssigned = currentSim.activeTrip?.hospital_id === h.id;
              return (
                <div key={h.id} className={`bg-white/5 border rounded-lg p-3 flex items-center justify-between ${isAssigned ? 'border-primary' : 'border-white/10'}`}>
                  <div>
                    <h4 className={`text-sm font-bold ${isAssigned ? 'text-primary' : 'text-on-surface'}`}>{h.name.split(' ').slice(0, 2).join(' ')}</h4>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">Beds open: {h.icu_beds} | ETA: 4m</p>
                  </div>
                  {currentSim.activeTrip && !isAssigned && (
                    <button onClick={() => redirectHospital(h.id)} className="bg-white/5 hover:bg-white/10 border border-white/10 text-on-surface px-3 py-1 rounded text-[10px] font-label-caps transition-all">ROUTE</button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* AI Triage Advisor Chatbot */}
        {currentSim.activeTrip && (
          <section className="glass-panel rounded-xl flex flex-col overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center gap-2 bg-white/[0.01]">
              <Radio className="text-secondary animate-pulse" size={16} />
              <h3 className="font-bold text-sm text-on-surface">AI Triage Advisor</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[220px] max-h-[260px] scrollbar-thin">
              {(chatHistory[selectedAmbId] || []).map((msg, i) => (
                <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`p-3 rounded-lg text-xs leading-relaxed max-w-[85%] ${
                    msg.sender === 'user' 
                      ? 'bg-secondary text-on-secondary-container font-semibold rounded-br-none' 
                      : 'bg-white/5 text-on-surface border border-white/5 rounded-bl-none'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* suggestion chips */}
            <div className="px-4 py-2 border-t border-white/5 flex gap-2 flex-wrap bg-black/10">
              <button type="button" onClick={() => handleSendChat(null, "Analyze patient vitals")} className="bg-white/5 border border-white/10 hover:bg-white/10 px-2.5 py-1 rounded text-[10px] text-on-surface-variant font-medium transition-all">
                Analyze Vitals
              </button>
              <button type="button" onClick={() => handleSendChat(null, "Recommend treatment protocols")} className="bg-white/5 border border-white/10 hover:bg-white/10 px-2.5 py-1 rounded text-[10px] text-on-surface-variant font-medium transition-all">
                Recommend Protocols
              </button>
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendChat} className="p-3 border-t border-white/10 bg-black/20 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Consult advisor..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-on-surface focus:ring-1 focus:ring-secondary/50 outline-none transition-all"
              />
              <button type="submit" className="bg-secondary p-1.5 rounded-lg text-on-secondary-container active:scale-95 transition-all">
                <Send size={14} />
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}

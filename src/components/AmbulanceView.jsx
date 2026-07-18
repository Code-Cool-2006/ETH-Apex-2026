import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, ShieldAlert, Navigation, Database, Radio, Wifi, WifiOff, Volume2, Mic, Settings, Play, Check } from 'lucide-react';

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

export default function AmbulanceView({ socket, socketConnected, ambulances, hospitals, trips, setActiveTrip, refreshTrips, setMapFocus, onNewDispatch }) {
  const [selectedAmbId, setSelectedAmbId] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [offlineBuffer, setOfflineBuffer] = useState([]);
  const [simulations, setSimulations] = useState({});
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

  const onVoiceTranscript = useCallback((chunk) => {
    if (!selectedAmbId) return;
    setSimulations(prev => {
      const sim = prev[selectedAmbId] || createDefaultSimState(selectedAmbId);
      return { ...prev, [selectedAmbId]: { ...sim, symptoms: sim.symptoms ? `${sim.symptoms.trim()} ${chunk}` : chunk } };
    });
  }, [selectedAmbId]);

  const { isListening, isSupported, speechError, toggleListening } = useVoiceDictation({ onTranscriptUpdate: onVoiceTranscript });

  // Props reactively feed updates from App.jsx's WebSocket receiver

  useEffect(() => {
    if (ambulances && ambulances.length > 0 && !selectedAmbId) {
      setSelectedAmbId(ambulances[0].id);
    }
  }, [ambulances, selectedAmbId]);

  useEffect(() => {
    if (!trips || trips.length === 0) { setSimulations({}); return; }
    trips.forEach(async (trip) => {
      if (trip.live_status === 'enroute' && (!simulations[trip.ambulance_id] || !simulations[trip.ambulance_id].activeTrip)) {
        const amb = ambulances.find(a => a.id === trip.ambulance_id);
        const startLoc = { lat: amb?.lat || 15.852, lng: amb?.lng || 74.504 };
        const hospital = hospitals.find(h => h.id === trip.hospital_id);
        let pts = hospital ? await fetchOSRMRoute(startLoc, { lat: hospital.lat, lng: hospital.lng }) : [];
        
        setSimulations(prev => {
          if (prev[trip.ambulance_id]?.activeTrip) return prev;
          return {
            ...prev,
            [trip.ambulance_id]: {
              activeTrip: trip,
              patientName: trip.patient_name,
              patientAge: String(trip.patient_age),
              symptoms: trip.symptoms,
              vitals: { hr: 142, spo2: 88, systolicBP: 90, temp: 37.2, respRate: 26 },
              routePoints: pts,
              currentRouteIndex: 0,
              isDriving: pts.length > 0,
              currentLoc: startLoc,
              speed: 0,
              heading: 0
            }
          };
        });
      }
    });
  }, [trips, ambulances, hospitals]);

  // Driving Simulation Step Interval
  useEffect(() => {
    const driveInterval = setInterval(() => {
      setSimulations(prev => {
        const next = { ...prev };
        let updated = false;
        Object.keys(next).forEach(ambId => {
          const sim = next[ambId];
          if (sim.isDriving && sim.routePoints.length > 0) {
            const idx = sim.currentRouteIndex;
            if (idx < sim.routePoints.length - 1) {
              const nextIdx = idx + 1;
              const currentPoint = sim.routePoints[idx];
              const nextPoint = sim.routePoints[nextIdx];
              let speed = Math.round(45 + Math.random() * 15);
              let heading = 0;
              if (nextPoint && currentPoint) {
                const dy = nextPoint.lat - currentPoint.lat;
                const dx = Math.cos(Math.PI / 180 * currentPoint.lat) * (nextPoint.lng - currentPoint.lng);
                heading = Math.round(Math.atan2(dx, dy) * 180 / Math.PI);
              }
              next[ambId] = { ...sim, currentRouteIndex: nextIdx, currentLoc: nextPoint, speed, heading };
              updated = true;
            } else {
              next[ambId] = { ...sim, isDriving: false, speed: 0, heading: 0 };
              updated = true;
            }
          }
        });
        return updated ? next : prev;
      });
    }, 3000);
    return () => clearInterval(driveInterval);
  }, []);

  const handleOfflineToggle = (e) => {
    setIsOffline(e.target.checked);
  };

  const startDispatch = async (e) => {
    e.preventDefault();
    if (!selectedAmbId) return;
    const sim = getSim(selectedAmbId);
    
    const newPatientId = "PT-" + Math.random().toString(36).substr(2, 9).toUpperCase();
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
              <h2 className="text-lg font-bold">Active Dispatch Console</h2>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Unit Selector */}
            <select
              value={selectedAmbId}
              onChange={(e) => setSelectedAmbId(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface focus:ring-1 focus:ring-primary/50 outline-none cursor-pointer"
            >
              {ambulances.map(a => (
                <option key={a.id} value={a.id}>{a.callsign} ({simulations[a.id]?.activeTrip ? 'ENROUTE' : 'IDLE'})</option>
              ))}
            </select>

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
                <div className="flex items-center gap-4 text-xs font-bold text-primary">
                  <span>SPO2 {currentSim.vitals.spo2}%</span>
                  <span>BP {currentSim.vitals.systolicBP}/60</span>
                </div>
              </div>
              <ECGOscilloscope heartRate={currentSim.vitals.hr} />
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

      {/* ===== Right 4 cols: Hospital Allocation ===== */}
      <div className="lg:col-span-4 space-y-6">
        <section className="glass-panel rounded-xl p-5">
          <h3 className="font-headline-md text-[18px] font-semibold text-on-surface mb-4">ER Capability Route</h3>
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
      </div>
    </div>
  );
}

import React, { useEffect, useState, useRef } from 'react';
import { ShieldAlert, Hospital, Heart, Thermometer, User, Clock, AlertTriangle, Layers, Navigation, ChevronRight, Activity, Plus, Minus, Radar, Users, Send } from 'lucide-react';

function RadarCanvas() {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let time = 0;
    
    const resize = () => {
      canvas.width = canvas.parentElement.clientWidth || 300;
      canvas.height = canvas.parentElement.clientHeight || 300;
    };
    window.addEventListener('resize', resize);
    resize();
    
    const draw = () => {
      ctx.fillStyle = '#131315';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const r = Math.min(cx, cy) - 20;
      
      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (r / 4) * i, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
      ctx.stroke();
      
      // Pulsing heartbeat ring
      time += 0.05;
      const pulse = Math.pow(Math.sin(time * 1.5) * 0.5 + 0.5, 8.0);
      ctx.strokeStyle = `rgba(225, 29, 72, ${pulse * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      
      // Sweeping line
      const angle = (time * 0.05) % (Math.PI * 2);
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.stroke();
      
      // Sweep gradient trail
      for (let i = 0; i < 60; i++) {
        const trailAngle = angle - (i * Math.PI / 180);
        ctx.strokeStyle = `rgba(225, 29, 72, ${0.15 * (1 - i/60)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(trailAngle) * r, cy + Math.sin(trailAngle) * r);
        ctx.stroke();
      }
      
      animationFrameId = requestAnimationFrame(draw);
    };
    
    draw();
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, []);
  
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-40" style={{ display: 'block' }} />;
}

export default function HospitalView({ socket, socketConnected, ambulances, hospitals, trips, setHospitals, refreshHospitals, mapFocus, onAcceptTrip }) {
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [liveTelemetry, setLiveTelemetry] = useState({});
  const [vitalsHistory, setVitalsHistory] = useState({});
  
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const routesRef = useRef({});
  const [snoozedTrips, setSnoozedTrips] = useState(new Set());
  const audioCtxRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const announcedUrgencyRef = useRef({});
  const [mapRoutes, setMapRoutes] = useState({});
  const routeCacheRef = useRef({});

  const fetchOSRMRoute = async (tripId, start, end) => {
    const cacheKey = `${tripId}-${end.id}`;
    if (routeCacheRef.current[cacheKey]) {
      return routeCacheRef.current[cacheKey];
    }
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("OSRM API failed");
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const coords = data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        routeCacheRef.current[cacheKey] = coords;
        return coords;
      }
    } catch (err) {
      console.warn("OSRM routing on hospital map failed:", err);
    }
    const straight = [[start.lat, start.lng], [end.lat, end.lng]];
    routeCacheRef.current[cacheKey] = straight;
    return straight;
  };

  // Listen for socket updates
  useEffect(() => {
    if (!socket) return;
    socket.emit('join-hospital');

    const handleLiveStream = (data) => {
      setLiveTelemetry(prev => ({ ...prev, [data.trip_id]: data }));
      setVitalsHistory(prev => {
        const history = prev[data.trip_id] || [];
        const newHistory = [...history, { hr: data.vitals.hr, spo2: data.vitals.spo2, timestamp: new Date().toLocaleTimeString() }];
        if (newHistory.length > 15) newHistory.shift();
        return { ...prev, [data.trip_id]: newHistory };
      });

      const tripId = data.trip_id;
      const trip = trips.find(t => t.id === tripId);
      const patientName = trip ? trip.patient_name : 'Incoming Patient';
      const urgency = data.triage.urgency;
      const lastUrgency = announcedUrgencyRef.current[tripId];
      if (lastUrgency !== urgency) {
        announcedUrgencyRef.current[tripId] = urgency;
        if ('speechSynthesis' in window) {
          let text = !lastUrgency
            ? `Incoming ambulance telemetry broadcast for patient ${patientName}. Triage status classified as ${urgency}.`
            : `Triage update for patient ${patientName}. Status is now ${urgency}.`;
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 0.95;
          window.speechSynthesis.speak(utterance);
        }
      }
    };

    const handleTripAccepted = (data) => {
      setLiveTelemetry(prev => {
        const live = prev[data.trip_id];
        if (live) return { ...prev, [data.trip_id]: { ...live, triage: { ...live.triage, urgency: 'accepted' } } };
        return prev;
      });
    };

    const handleTripRedirected = (data) => {
      setLiveTelemetry(prev => {
        const live = prev[data.trip_id];
        if (live) return { ...prev, [data.trip_id]: { ...live, hospitalMatch: { ...live.hospitalMatch, recommended: { ...data.hospital, justification: `Redirected by dispatcher to secondary unit.` } } } };
        return prev;
      });
    };

    socket.on('ambulance-live-update', handleLiveStream);
    socket.on('trip-accepted', handleTripAccepted);
    socket.on('trip-redirected', handleTripRedirected);
    return () => {
      socket.off('ambulance-live-update', handleLiveStream);
      socket.off('trip-accepted', handleTripAccepted);
      socket.off('trip-redirected', handleTripRedirected);
    };
  }, [socket]);

  useEffect(() => {
    if (!selectedTripId) return;
    const fetchTripDetails = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/trips/${selectedTripId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.vitalsHistory && data.vitalsHistory.length > 0) {
            setVitalsHistory(prev => ({ ...prev, [selectedTripId]: data.vitalsHistory.map(v => ({ hr: v.hr, spo2: v.spo2, timestamp: new Date(v.recorded_at).toLocaleTimeString() })) }));
          }
        }
      } catch (err) { console.error("Error fetching vitals history:", err); }
    };
    fetchTripDetails();
  }, [selectedTripId]);

  useEffect(() => {
    const prePopulateTelemetry = () => {
      trips.forEach(trip => {
        if (trip.live_status === 'enroute' && !liveTelemetry[trip.id]) {
          const amb = ambulances.find(a => a.id === trip.ambulance_id);
          const currentLat = amb ? amb.lat : 15.8566;
          const currentLng = amb ? amb.lng : 74.5097;
          
          const triageResult = {
            urgency: trip.urgency,
            vitalsUrgency: trip.urgency,
            vitalsScore: trip.news2_score,
            redFlags: [],
            escalatedByFlags: false,
            summary: trip.symptoms,
            confidence: { stable: 0.1, urgent: 0.2, critical: 0.7 },
            modelType: 'FastAPI Neural Net'
          };

          setLiveTelemetry(prev => {
            if (prev[trip.id]) return prev;
            return {
              ...prev,
              [trip.id]: {
                trip_id: trip.id,
                ambulance_id: trip.ambulance_id,
                callsign: trip.ambulance_callsign || 'Rescue Unit',
                vitals: {
                  hr: 142,
                  spo2: 88,
                  systolicBP: 90,
                  temp: 37.2,
                  respRate: 26,
                  news2Score: trip.news2_score
                },
                location: { lat: currentLat, lng: currentLng },
                speed: 0,
                heading: 0,
                triage: triageResult,
                hospitalMatch: {
                  recommended: {
                    id: trip.hospital_id,
                    justification: 'Automated triage assignment.'
                  }
                }
              }
            };
          });

          setVitalsHistory(prev => {
            if (prev[trip.id]) return prev;
            return {
              ...prev,
              [trip.id]: [
                { hr: 140, spo2: 89, timestamp: new Date().toLocaleTimeString() },
                { hr: 142, spo2: 88, timestamp: new Date().toLocaleTimeString() }
              ]
            };
          });
        }
      });
    };
    if (trips && trips.length > 0) prePopulateTelemetry();
  }, [trips, ambulances, liveTelemetry]);

  // Initialize and Update Leaflet Map
  useEffect(() => {
    if (!window.L || !mapContainerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = window.L.map(mapContainerRef.current, { center: [15.852, 74.504], zoom: 13, zoomControl: true, attributionControl: false });
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapRef.current);
    }
    const L = window.L;
    const map = mapRef.current;
    
    Object.keys(markersRef.current).forEach(id => {
      const isHospital = id.startsWith('hosp-');
      const isAmb = id.startsWith('amb-');
      const remains = (isHospital && hospitals.some(h => h.id === id)) || (isAmb && ambulances.some(a => a.id === id));
      if (!remains) { map.removeLayer(markersRef.current[id]); delete markersRef.current[id]; }
    });

    hospitals.forEach(h => {
      if (!markersRef.current[h.id]) {
        const color = h.has_trauma ? '#ef4444' : h.has_cardiac ? '#3b82f6' : '#10b981';
        const htmlIcon = L.divIcon({ html: `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 3px; border: 2px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`, className: 'custom-hosp-marker', iconSize: [14, 14], iconAnchor: [7, 7] });
        const m = L.marker([h.lat, h.lng], { icon: htmlIcon }).bindPopup(`<strong>${h.name}</strong><br/>ICU Beds: ${h.icu_beds}`).addTo(map);
        markersRef.current[h.id] = m;
      } else {
        markersRef.current[h.id].getPopup().setContent(`<strong>${h.name}</strong><br/>ICU Beds: ${h.icu_beds}`);
      }
    });

    ambulances.forEach(a => {
      const activeTripInfo = trips.find(t => t.ambulance_id === a.id && t.live_status === 'enroute');
      const liveData = activeTripInfo ? liveTelemetry[activeTripInfo.id] : null;
      const lat = liveData ? liveData.location.lat : a.lat;
      const lng = liveData ? liveData.location.lng : a.lng;
      const urgency = liveData ? liveData.triage.urgency : 'stable';
      const markerColor = a.status === 'idle' ? '#6b7280' : urgency === 'critical' ? '#ef4444' : urgency === 'urgent' ? '#f59e0b' : '#10b981';

      const htmlIcon = L.divIcon({ html: `<div class="${urgency === 'critical' ? 'map-marker-pulse' : ''}" style="background-color: ${markerColor}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 8px ${markerColor};"><div style="width: 4px; height: 4px; background: white; border-radius: 50%; margin: auto; margin-top: 4px;"></div></div>`, className: 'custom-amb-marker', iconSize: [16, 16], iconAnchor: [8, 8] });

      if (!markersRef.current[a.id]) {
        const m = L.marker([lat, lng], { icon: htmlIcon }).bindPopup(`<strong>${a.callsign}</strong><br/>Status: ${a.status}`).addTo(map);
        markersRef.current[a.id] = m;
      } else {
        const m = markersRef.current[a.id];
        m.setLatLng([lat, lng]);
        m.setIcon(htmlIcon);
      }
    });

    Object.keys(routesRef.current).forEach(tripId => {
      const isActive = trips.some(t => t.id === tripId && t.live_status === 'enroute');
      if (!isActive) { map.removeLayer(routesRef.current[tripId]); delete routesRef.current[tripId]; }
    });

    trips.filter(t => t.live_status === 'enroute').forEach(async (t) => {
      const live = liveTelemetry[t.id];
      const amb = ambulances.find(a => a.id === t.ambulance_id);
      const hosp = hospitals.find(h => h.id === t.hospital_id);
      if (amb && hosp) {
        const start = live ? live.location : amb;
        const cacheKey = `${t.id}-${hosp.id}`;
        if (!mapRoutes[cacheKey]) {
          const coords = await fetchOSRMRoute(t.id, start, hosp);
          setMapRoutes(prev => ({ ...prev, [cacheKey]: coords }));
          return;
        }
        const pathCoords = mapRoutes[cacheKey];
        const urgency = live ? live.triage.urgency : t.urgency;
        const color = urgency === 'critical' ? '#ef4444' : urgency === 'urgent' ? '#f59e0b' : '#10b981';
        if (!routesRef.current[t.id]) {
          const poly = L.polyline(pathCoords, { color, weight: 3, dashArray: '8, 8', opacity: 0.8 }).addTo(map);
          routesRef.current[t.id] = poly;
        } else {
          routesRef.current[t.id].setLatLngs(pathCoords);
          routesRef.current[t.id].setStyle({ color });
        }
      }
    });
  }, [ambulances, hospitals, trips, liveTelemetry, mapRoutes]);

  useEffect(() => {
    if (mapRef.current && mapFocus) mapRef.current.setView(mapFocus, 14);
  }, [mapFocus]);

  const adjustBeds = (hospId, currentBeds, amount) => {
    const nextBeds = Math.max(0, currentBeds + amount);
    if (setHospitals) {
      setHospitals(prev => prev.map(h => h.id === hospId ? { ...h, icu_beds: nextBeds } : h));
    }
  };

  const handleAccept = (tripId) => {
    // Simulating acceptance locally: mark status as accepted and trigger TTS voice confirm
    setLiveTelemetry(prev => {
      const live = prev[tripId];
      if (live) return { ...prev, [tripId]: { ...live, triage: { ...live.triage, urgency: 'accepted' } } };
      return prev;
    });
    if (onAcceptTrip) {
      onAcceptTrip(tripId);
    }
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance("Patient admitted. Preparing trauma bay.");
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleRedirect = (tripId) => {
    // Simulating redirect locally to secondary hospital Valley Medical
    setLiveTelemetry(prev => {
      const live = prev[tripId];
      if (live) return { ...prev, [tripId]: { ...live, hospitalMatch: { ...live.hospitalMatch, recommended: { id: "HOSP-02", name: "West Valley Medical", justification: "Redirected by dispatcher." } } } };
      return prev;
    });
  };

  const activeDispatches = trips.filter(t => t.live_status === 'enroute');
  const totalBedsAvailable = hospitals.reduce((sum, h) => sum + h.icu_beds, 0);
  const criticalCount = activeDispatches.filter(t => {
    const live = liveTelemetry[t.id];
    return live ? live.triage.urgency === 'critical' : t.urgency === 'critical';
  }).length;
  const currentSelectedTrip = activeDispatches.find(t => t.id === selectedTripId) || activeDispatches[0];
  const selectedTripLive = currentSelectedTrip ? liveTelemetry[currentSelectedTrip.id] : null;
  const activeCriticalTrips = Object.values(liveTelemetry).filter(t => t.triage.urgency === 'critical' && t.triage.confidence && t.triage.confidence.critical >= 0.75 && !snoozedTrips.has(t.trip_id));
  const alarmActive = activeCriticalTrips.length > 0;

  useEffect(() => {
    if (alarmActive) {
      const playBeep = () => {
        try {
          if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') ctx.resume();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine'; osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          osc.connect(gain).connect(ctx.destination);
          osc.start(); osc.stop(ctx.currentTime + 0.25);
        } catch (e) { console.warn("Audio Context alert blocked."); }
      };
      playBeep();
      alarmIntervalRef.current = setInterval(playBeep, 1000);
    } else {
      if (alarmIntervalRef.current) { clearInterval(alarmIntervalRef.current); alarmIntervalRef.current = null; }
    }
    return () => { if (alarmIntervalRef.current) { clearInterval(alarmIntervalRef.current); alarmIntervalRef.current = null; } };
  }, [alarmActive]);

  const getUrgencyColor = (u) => u === 'critical' ? 'primary' : u === 'urgent' ? 'tertiary' : 'secondary';

  return (
    <div className="relative">
      {/* Critical alarm overlay */}
      {alarmActive && (
        <div className="critical-alarm-overlay">
          <div className="alarm-content glass-panel flex flex-col gap-3 items-center">
            <h2 className="text-lg text-error font-bold">🚨 CRITICAL INCOMING PATIENT</h2>
            {activeCriticalTrips.map(t => (
              <p key={t.trip_id} className="text-sm">
                <strong>{t.callsign} ({t.triage.summary})</strong> is enroute with <strong>{Math.round((t.triage.confidence?.critical || 0) * 100)}% critical urgency confidence</strong>.
              </p>
            ))}
            <button
              onClick={() => { activeCriticalTrips.forEach(t => { setSnoozedTrips(prev => { const next = new Set(prev); next.add(t.trip_id); return next; }); }); }}
              className="bg-primary-container text-white px-4 py-2 rounded-lg text-xs font-bold hover:brightness-110 active:scale-95 transition-all"
            >
              Acknowledge & Snooze Alert
            </button>
          </div>
        </div>
      )}

      {/* Dashboard Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-primary font-label-caps text-label-caps mb-1">
            <Radar size={14} />
            <span>LIVE COMMAND FEEDS</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">ER Command Center Dashboard</h1>
        </div>
        <div className="flex items-center gap-4 bg-white/5 p-2 rounded-xl glass-panel">
          <div className="px-4 text-center border-r border-white/10">
            <div className="text-[10px] text-on-surface-variant uppercase font-label-caps">Incoming</div>
            <div className="text-xl font-bold text-primary">{String(activeDispatches.length).padStart(2, '0')}</div>
          </div>
          <div className="px-4 text-center border-r border-white/10">
            <div className="text-[10px] text-on-surface-variant uppercase font-label-caps">In Triage</div>
            <div className="text-xl font-bold text-secondary">{String(trips.filter(t => t.live_status === 'enroute').length).padStart(2, '0')}</div>
          </div>
          <div className="px-4 text-center">
            <div className="text-[10px] text-on-surface-variant uppercase font-label-caps">Critical</div>
            <div className="text-xl font-bold text-error">{String(criticalCount).padStart(2, '0')}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ===== Left 8 cols: Main Content ===== */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Awaiting Transmissions / Radar */}
          <section className="glass-panel rounded-xl overflow-hidden relative min-h-[320px] flex flex-col">
            <div className="p-6 pb-2 z-10">
              <h2 className="font-headline-md text-headline-md flex items-center gap-3">
                <Radar className="text-primary" size={24} />
                Awaiting Transmissions
              </h2>
              <p className="text-on-surface-variant text-sm mt-1">Scanning secure medical frequencies for en-route telemetry...</p>
            </div>
            <div className="flex-1 relative flex items-center justify-center p-8">
              <RadarCanvas />
              <div className="z-10 text-center space-y-4">
                <div className="flex justify-center gap-12">
                  <div className="flex flex-col items-center">
                    <span className="text-3xl font-display-vitals text-display-vitals text-primary">
                      {activeDispatches.length > 0 ? '02:14' : '--:--'}
                    </span>
                    <span className="font-label-caps text-[10px] text-on-surface-variant">NEXT ETA</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-3xl font-display-vitals text-display-vitals text-secondary">
                      {String(activeDispatches.length).padStart(2, '0')}
                    </span>
                    <span className="font-label-caps text-[10px] text-on-surface-variant">ACTIVE UNITS</span>
                  </div>
                </div>
                <div className="bg-black/40 backdrop-blur-md px-6 py-2 rounded-[0.75rem] border border-white/10 inline-flex items-center gap-2">
                  <div className="w-2 h-2 rounded-[0.75rem] bg-secondary animate-pulse"></div>
                  <span className="font-label-caps text-xs">UPLINK STABLE - ENCRYPTED</span>
                </div>
              </div>
            </div>
          </section>

          {/* Active Triage Cards */}
          {activeDispatches.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-headline-md text-headline-md flex items-center gap-3 px-2">
                <Users size={24} />
                Active Triage
              </h2>
              <div className="grid grid-cols-1 gap-4">
                {activeDispatches.map(t => {
                  const live = liveTelemetry[t.id];
                  const urgency = live ? live.triage.urgency : t.urgency;
                  const currentVitals = live ? live.vitals : null;
                  const borderClass = urgency === 'critical' ? 'border-l-primary' : urgency === 'urgent' ? 'border-l-tertiary' : 'border-l-secondary';
                  const textClass = urgency === 'critical' ? 'text-primary' : urgency === 'urgent' ? 'text-tertiary' : 'text-secondary';
                  const isCritical = urgency === 'critical';
                  const news2 = live ? live.triage.vitalsScore : t.news2_score;

                  const allocatedResources = urgency === 'critical' 
                    ? ["ICU BED READY", "VENTILATOR"]
                    : urgency === 'urgent' ? ["BAY 09 ALLOC"]
                    : ["WAITING ROOM OK"];

                  return (
                    <div 
                      key={t.id}
                      onClick={() => setSelectedTripId(t.id)}
                      className={`glass-panel rounded-xl border-l-4 ${borderClass} p-5 flex flex-col md:flex-row gap-6 relative cursor-pointer group ${isCritical ? 'critical-glow' : ''} overflow-hidden transition-all hover:bg-white/[0.02]`}
                    >
                      {/* Critical Alert Badge */}
                      {isCritical && (
                        <div className="absolute top-0 right-0 p-3 flex gap-2">
                          <div className="bg-primary/20 text-primary px-3 py-1 rounded-[0.75rem] text-[10px] font-bold font-label-caps flex items-center gap-1 animate-alert-flash">
                            <AlertTriangle size={10} />
                            CRITICAL ALERT
                          </div>
                        </div>
                      )}

                      {/* Patient Info */}
                      <div className="md:w-1/4">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 rounded-lg bg-surface-container-highest flex items-center justify-center border border-white/10">
                            <User size={24} className="text-on-surface" />
                          </div>
                          <div>
                            <h3 className="font-bold">{t.patient_name} ({t.patient_age ? `${t.patient_age}y` : ''})</h3>
                            <p className="text-xs text-on-surface-variant">ETA: {live ? `${Math.round(Math.random() * 15 + 2)} MIN` : 'N/A'} | {live ? live.callsign : t.ambulance_callsign}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {allocatedResources.map(r => (
                            <span key={r} className={`bg-white/5 border border-white/10 px-2 py-0.5 rounded text-[10px] font-label-caps ${isCritical ? 'text-secondary' : 'text-on-surface-variant'}`}>
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Vitals Grid */}
                      <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                          <span className="font-label-caps text-[10px] text-on-surface-variant block mb-1">HEART RATE</span>
                          <div className="flex items-baseline gap-1">
                            <span className={`text-3xl font-display-vitals ${textClass}`}>
                              {currentVitals ? currentVitals.hr : '--'}
                            </span>
                            <span className="text-xs text-on-surface-variant">BPM</span>
                          </div>
                        </div>
                        <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                          <span className="font-label-caps text-[10px] text-on-surface-variant block mb-1">SpO2 LEVEL</span>
                          <div className="flex items-baseline gap-1">
                            <span className={`text-3xl font-display-vitals ${textClass}`}>
                              {currentVitals ? currentVitals.spo2 : '--'}
                            </span>
                            <span className="text-xs text-on-surface-variant">%</span>
                          </div>
                        </div>
                        <div className="col-span-2 md:col-span-1 bg-black/20 p-3 rounded-lg border border-white/5 relative overflow-hidden">
                          <span className="font-label-caps text-[10px] text-on-surface-variant block mb-1">ECG LEAD II</span>
                          <svg className="w-full h-10 mt-1" viewBox="0 0 200 40">
                            <path className="waveform-path" d="M0 20 L20 20 L25 10 L30 30 L35 20 L60 20 L65 5 L70 35 L75 20 L100 20 L105 15 L110 25 L115 20 L140 20 L145 0 L150 40 L155 20 L180 20" fill="none" stroke="#ffb3b6" strokeWidth="2" />
                          </svg>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="md:w-1/5 flex flex-col justify-center gap-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleAccept(t.id); }}
                          className={`w-full ${isCritical ? 'bg-primary-container' : 'bg-surface-container-highest hover:bg-white/10'} text-white py-2 rounded font-bold text-xs transition-all hover:brightness-110 active:scale-95`}
                        >
                          ACCEPT PATIENT
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleRedirect(t.id); }}
                          className="w-full border border-white/10 hover:bg-white/5 py-2 rounded text-xs transition-all"
                        >
                          REDIRECT
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* ===== Right 4 cols: AI Handover Panel ===== */}
        <div className="lg:col-span-4">
          <section className="glass-panel rounded-xl flex flex-col sticky top-24 max-h-[calc(100vh-120px)]">
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-headline-md text-headline-md flex items-center gap-2">
                  <Activity className="text-secondary" size={20} />
                  AI Handover
                </h2>
                <span className="text-[10px] font-label-caps bg-secondary/10 text-secondary border border-secondary/20 px-2 py-0.5 rounded">
                  {selectedTripLive ? `${Math.round((selectedTripLive.triage.confidence?.critical || selectedTripLive.triage.confidence?.stable || 0.98) * 100)}% NEURAL MATCH` : '98.2% NEURAL MATCH'}
                </span>
              </div>
              <div className="flex gap-2">
                <button className="flex-1 py-1.5 rounded-lg bg-secondary text-on-secondary-container text-xs font-bold font-label-caps">CURRENT</button>
                <button className="flex-1 py-1.5 rounded-lg bg-white/5 text-on-surface-variant text-xs font-bold font-label-caps">ARCHIVE</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {currentSelectedTrip && selectedTripLive ? (
                <>
                  {/* AI Narrative */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`font-label-caps text-xs text-${getUrgencyColor(selectedTripLive.triage.urgency)} font-bold`}>
                        {selectedTripLive.triage.urgency.toUpperCase()}: {currentSelectedTrip.patient_name}
                      </span>
                      <span className="text-[10px] text-on-surface-variant">2m ago</span>
                    </div>
                    <div className={`bg-${getUrgencyColor(selectedTripLive.triage.urgency)}/5 border border-${getUrgencyColor(selectedTripLive.triage.urgency)}/10 rounded-lg p-4`}>
                      <p className="text-sm leading-relaxed text-on-surface">
                        {selectedTripLive.triage.summary || 'Awaiting AI narrative generation...'}
                      </p>
                    </div>
                    {/* Confidence bar */}
                    {selectedTripLive.triage.confidence && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1 bg-white/5 rounded-[0.75rem] overflow-hidden">
                          <div className={`h-full bg-${getUrgencyColor(selectedTripLive.triage.urgency)}`} style={{ width: `${Math.round(Math.max(selectedTripLive.triage.confidence.stable, selectedTripLive.triage.confidence.urgent, selectedTripLive.triage.confidence.critical) * 100)}%` }}></div>
                        </div>
                        <span className="text-[10px] font-label-caps text-on-surface-variant">CONFIDENCE</span>
                      </div>
                    )}
                  </div>

                  {/* Red Flags */}
                  {(selectedTripLive.triage.redFlags || []).length > 0 && (
                    <div className="space-y-2">
                      <span className="font-label-caps text-[10px] text-on-surface-variant">RED FLAGS</span>
                      <div className="flex flex-wrap gap-2">
                        {(selectedTripLive.triage.redFlags || []).map(f => (
                          <span key={f} className="bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-label-caps flex items-center gap-1">
                            <AlertTriangle size={8} /> {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Resource Allocation Status */}
                  <div className="pt-6 border-t border-white/10">
                    <h3 className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest mb-4">Resource Allocation Status</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-on-surface">ER Trauma Bay</span>
                        <span className="text-primary font-bold">{totalBedsAvailable > 2 ? '2/4' : `${Math.min(totalBedsAvailable, 4)}/4`} AVAILABLE</span>
                      </div>
                      <div className="w-full h-1 bg-white/5 rounded-[0.75rem]">
                        <div className="h-full bg-primary w-1/2 rounded-[0.75rem]"></div>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-on-surface">On-call Surgeons</span>
                        <span className="text-secondary font-bold">04 ACTIVE</span>
                      </div>
                      <div className="w-full h-1 bg-white/5 rounded-[0.75rem]">
                        <div className="h-full bg-secondary w-full rounded-[0.75rem]"></div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-center py-12 text-on-surface-variant">
                  <Activity size={32} className="mb-4 opacity-30" />
                  <p className="text-sm">Select an active triage feed to view AI analysis</p>
                </div>
              )}
            </div>

            {/* AI Query Input */}
            <div className="p-4 border-t border-white/10 bg-black/20">
              <div className="flex gap-2">
                <input className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-secondary/50 outline-none transition-all text-on-surface" placeholder="Query AI assistant..." type="text" />
                <button className="bg-secondary p-2 rounded-lg text-on-secondary-container active:scale-95 transition-all">
                  <Send size={18} />
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

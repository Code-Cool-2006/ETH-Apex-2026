import React, { useState, useEffect, useRef } from 'react';
import { ShieldAlert, Search, Bell, Settings, Users, Activity, BarChart3, History, HelpCircle, LogOut, Plus, Trash2 } from 'lucide-react';
import './App.css';
import AmbulanceView from './components/AmbulanceView';
import HospitalView from './components/HospitalView';
import CommandView from './components/CommandView';
import SOSView from './components/SOSView';
import SettingsView from './components/SettingsView';
import LogsView from './components/LogsView';
import NewDispatchView from './components/NewDispatchView';
import NotificationsView from './components/NotificationsView';
import TutorialGuide from './components/TutorialGuide';

const DEFAULT_AMBULANCES = [
  { id: 'AMB-01', callsign: 'Rescue 402', status: 'idle', lat: 15.8566, lng: 74.5097, speed: 0 },
  { id: 'AMB-02', callsign: 'BLS Unit 12', status: 'idle', lat: 15.8622, lng: 74.5122, speed: 0 },
  { id: 'AMB-03', callsign: 'ALS Rescue 08', status: 'idle', lat: 15.8455, lng: 74.5011, speed: 0 }
];

const DEFAULT_HOSPITALS = [
  { id: 'HOSP-01', name: 'MediSync Central', lat: 15.852, lng: 74.504, icu_beds: 4, total_beds: 40, has_trauma: true, has_cardiac: true },
  { id: 'HOSP-02', name: 'West Valley Medical', lat: 15.8828, lng: 74.5242, icu_beds: 2, total_beds: 20, has_trauma: false, has_cardiac: true }
];

function App() {
  const [socketConnected, setSocketConnected] = useState(false);
  const [ambulances, setAmbulances] = useState(DEFAULT_AMBULANCES);
  const [hospitals, setHospitals] = useState(DEFAULT_HOSPITALS);
  const [trips, setTrips] = useState([]);
  const [activeTrip, setActiveTrip] = useState(null);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [mapFocus, setMapFocus] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationHistory, setNotificationHistory] = useState([]);

  const recentNotifsRef = useRef(new Set());
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  useEffect(() => {
    const unlock = () => {
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance('');
        window.speechSynthesis.speak(utterance);
        setAudioUnlocked(true);
        console.log("[TTS] Speech synthesis audio unlocked.");
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const addNotification = (message, type = 'info') => {
    // Prevent duplicate notifications firing within a 2-second window (e.g. from React StrictMode dual WebSockets)
    if (recentNotifsRef.current.has(message)) return;
    recentNotifsRef.current.add(message);
    setTimeout(() => {
      recentNotifsRef.current.delete(message);
    }, 2000);

    const id = Date.now() + Math.random();
    const timestamp = new Date().toLocaleTimeString();
    
    setNotifications(prev => [...prev, { id, message, type }]);
    setNotificationHistory(prev => [{ id, message, type, timestamp }, ...prev]);
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 6000);

    if ('speechSynthesis' in window) {
      // Remove emojis from the speech text for a cleaner voice readout
      const cleanMessage = message.replace(/^[\u{1F300}-\u{1F9FF}🚨🏥📱]+?\s*/u, '');
      const utterance = new SpeechSynthesisUtterance(cleanMessage);
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  };

  const wsRef = useRef(null);
  const wsGpsRef = useRef(null);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const navigate = (to) => {
    window.history.pushState({}, '', to);
    setCurrentPath(to);
  };

  // Connect to FastAPI WebSockets with auto-reconnect
  useEffect(() => {
    const token = 'ems_device_token_UNIT_A42'; // Auth token registered in auth.py
    const WS_URL = window.location.hostname === 'localhost' ? 'ws://localhost:8000' : 'wss://eth-apex-2026.onrender.com';
    // 1. Patient Telemetry Channel
    const ws = new WebSocket(`${WS_URL}/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setSocketConnected(true);
      console.log("[WS] Connected to Patient Telemetry Channel.");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("[WS] Received message:", msg);
        if (msg.type === 'INITIAL_STATE') {
          const loadedTrips = msg.data.map(p => ({
            id: p.id,
            ambulance_id: p.ambulanceId || 'AMB-01',
            ambulance_callsign: p.ambulanceCallsign || 'Rescue 402',
            patient_name: p.name,
            patient_age: p.age,
            symptoms: p.symptoms,
            urgency: p.urgency,
            live_status: p.status === 'Completed' ? 'completed' : 'enroute',
            hospital_id: p.assignedHospital?.id || 'HOSP-01',
            news2_score: p.vitals?.news2Score || 0,
            vitals: p.vitals || null,
            patient_lat: p.patient_lat || (15.852 + (Math.random() - 0.5) * 0.015),
            patient_lng: p.patient_lng || (74.504 + (Math.random() - 0.5) * 0.015)
          }));
          setTrips(loadedTrips);
          const active = loadedTrips.find(t => t.live_status === 'enroute');
          if (active) setActiveTrip(active);
        } else if (msg.type === 'NEW_PATIENT_BROADCAST') {
          addNotification(`🚨 Ambulance ${msg.data.ambulanceCallsign || 'Rescue Unit'} dispatched to patient ${msg.data.name}'s location.`, 'info');
          const newTrip = {
            id: msg.data.id,
            ambulance_id: msg.data.ambulanceId || 'AMB-01',
            ambulance_callsign: msg.data.ambulanceCallsign || 'Rescue 402',
            patient_name: msg.data.name,
            patient_age: msg.data.age,
            symptoms: msg.data.symptoms,
            urgency: msg.data.urgency,
            live_status: 'enroute',
            hospital_id: msg.data.assignedHospital?.id || 'HOSP-01',
            news2_score: msg.data.vitals?.news2Score || 0,
            vitals: msg.data.vitals || null,
            patient_lat: msg.data.patient_lat || (15.852 + (Math.random() - 0.5) * 0.015),
            patient_lng: msg.data.patient_lng || (74.504 + (Math.random() - 0.5) * 0.015)
          };
          setTrips(prev => {
            if (prev.some(t => t.id === newTrip.id)) return prev;
            return [...prev, newTrip];
          });
          setActiveTrip(newTrip);
        } else if (msg.type === 'UPDATE_PATIENTS') {
          const loadedTrips = msg.data.map(p => ({
            id: p.id,
            ambulance_id: p.ambulanceId || 'AMB-01',
            ambulance_callsign: p.ambulanceCallsign || 'Rescue 402',
            patient_name: p.name,
            patient_age: p.age,
            symptoms: p.symptoms,
            urgency: p.urgency,
            live_status: p.status === 'Completed' ? 'completed' : 'enroute',
            hospital_id: p.assignedHospital?.id || 'HOSP-01',
            news2_score: p.vitals?.news2Score || 0,
            vitals: p.vitals || null,
            patient_lat: p.patient_lat || (15.852 + (Math.random() - 0.5) * 0.015),
            patient_lng: p.patient_lng || (74.504 + (Math.random() - 0.5) * 0.015)
          }));
          setTrips(loadedTrips);
          const active = loadedTrips.find(t => t.live_status === 'enroute');
          setActiveTrip(active || null);
        }
      };

      ws.onclose = () => {
        setSocketConnected(false);
        console.log("[WS] Disconnected from Patient Telemetry Channel. Reconnecting...");
        triggerReconnect();
      };

      ws.onerror = (err) => {
        console.warn("[WS] Telemetry channel error:", err);
      };

      // 2. GPS Fleet Tracking Channel
      wsGps = new WebSocket(`${WS_URL}/ws/gps?token=${token}`);
      wsGpsRef.current = wsGps;

      wsGps.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'GPS_STATE' || msg.type === 'GPS_BROADCAST') {
            const gpsMap = {};
            msg.data.forEach(unit => {
              gpsMap[unit.unitId] = unit;
              
              // Synchronize Patient Trip Live Status with Ambulance GPS Status updates
              setTrips(prev => {
                let tripChanged = false;
                const nextTrips = prev.map(t => {
                  if (t.ambulance_id === unit.unitId && t.live_status !== 'completed') {
                    const newLiveStatus = (unit.status === 'EnRoute' || unit.status === 'enroute' || unit.status === 'PickedUp' || unit.status === 'picked_up') ? 'enroute'
                                        : (unit.status === 'Arrived' || unit.status === 'completed') ? 'completed'
                                        : t.live_status;
                    if (t.live_status !== newLiveStatus) {
                      tripChanged = true;
                      if (newLiveStatus === 'enroute') {
                        addNotification(`🚨 Patient ${t.patient_name} has been picked up by Rescue 402. En route to MediSync Central.`, 'success');
                      } else if (newLiveStatus === 'completed') {
                        addNotification(`🏥 Patient ${t.patient_name} arrived at MediSync Central. Transfer complete.`, 'success');
                      }
                      return { ...t, live_status: newLiveStatus };
                    }
                  }
                  return t;
                });

                if (tripChanged) {
                  const active = nextTrips.find(t => t.live_status === 'enroute');
                  setActiveTrip(active || null);
                }
                return nextTrips;
              });
            });

            setAmbulances(prev => prev.map(amb => {
              const update = gpsMap[amb.id];
              if (update) {
                return {
                  ...amb,
                  lat: update.lat,
                  lng: update.lng,
                  status: update.status ? update.status.toLowerCase() : 'enroute',
                  speed: update.speed || 0
                };
              }
              return amb;
            }));
          }
        } catch (err) {
          console.error("Error parsing GPS message:", err);
        }
      };

      wsGps.onclose = () => {
        console.log("[WS GPS] GPS Channel closed.");
      };
    };

    const triggerReconnect = () => {
      if (isCleanup) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connectSockets();
      }, 3000);
    };

    connectSockets();

    return () => {
      isCleanup = true;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
      if (wsGps) wsGps.close();
    };
  }, []);

  const [simulations, setSimulations] = useState({});

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

  // Sync trips to simulations state
  useEffect(() => {
    if (!trips || trips.length === 0) { setSimulations({}); return; }

    setSimulations(prev => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach(ambId => {
        const sim = next[ambId];
        if (sim.activeTrip && !trips.some(t => t.id === sim.activeTrip.id && t.live_status === 'enroute')) {
          delete next[ambId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    trips.forEach(async (trip) => {
      if (trip.live_status === 'enroute' && (!simulations[trip.ambulance_id] || !simulations[trip.ambulance_id].activeTrip)) {
        const amb = ambulances.find(a => a.id === trip.ambulance_id);
        const startLoc = { lat: amb?.lat || 15.852, lng: amb?.lng || 74.504 };
        const hospital = hospitals.find(h => h.id === trip.hospital_id);
        
        // Use coordinates attached to the trip (or generate fallback if missing)
        const patientLoc = {
          lat: trip.patient_lat || (startLoc.lat + (Math.random() - 0.5) * 0.015),
          lng: trip.patient_lng || (startLoc.lng + (Math.random() - 0.5) * 0.015)
        };

        // Fetch two-segment route: Start -> Patient -> Hospital
        let pts1 = await fetchOSRMRoute(startLoc, patientLoc);
        let pts2 = hospital ? await fetchOSRMRoute(patientLoc, { lat: hospital.lat, lng: hospital.lng }) : [];
        let pts = [...pts1, ...pts2];

        setSimulations(prev => {
          if (prev[trip.ambulance_id]?.activeTrip) return prev;
          const tv = trip.vitals || {};
          return {
            ...prev,
            [trip.ambulance_id]: {
              activeTrip: trip,
              patientName: trip.patient_name,
              patientAge: String(trip.patient_age),
              symptoms: trip.symptoms,
              vitals: {
                hr: tv.hr ?? 80,
                spo2: tv.spo2 ?? 98,
                systolicBP: tv.bpSys ?? 120,
                temp: tv.temp ?? 37.0,
                respRate: tv.rr ?? 16
              },
              routePoints: pts,
              pickupIndex: pts1.length - 1, // index where pickup happens
              currentRouteIndex: 0,
              isDriving: pts.length > 0,
              currentLoc: startLoc,
              speed: 0,
              heading: 0,
              patientLoc: patientLoc
            }
          };
        });
      }
    });
  }, [trips, ambulances, hospitals]);

  const handleAcceptTrip = (tripId) => {
    const trip = trips.find(t => t.id === tripId);
    const patientName = trip ? trip.patient_name : 'Patient';
    const hospital = hospitals.find(h => h.id === (trip ? trip.hospital_id : 'HOSP-01'));
    addNotification(`🏥 ${hospital ? hospital.name : 'Hospital'} has taken charge of ${patientName}. Transfer complete.`, 'info');

    setTrips(prev => prev.map(t => t.id === tripId ? { ...t, live_status: 'completed', urgency: 'stable' } : t));
    setActiveTrip(prev => prev && prev.id === tripId ? null : prev);
  };

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

              // Send GPS update to the server
              if (wsGpsRef.current && wsGpsRef.current.readyState === WebSocket.OPEN) {
                wsGpsRef.current.send(JSON.stringify({
                  type: "GPS_UPDATE",
                  data: {
                    unitId: ambId,
                    lat: nextPoint.lat,
                    lng: nextPoint.lng,
                    urgency: sim.activeTrip?.urgency || "stable",
                    status: nextIdx >= sim.pickupIndex ? "EnRoute" : "Dispatched",
                    speed: speed
                  }
                }));
              }

              // Trigger pickup notification when reaching the pickupIndex
              if (nextIdx === sim.pickupIndex && sim.activeTrip) {
                const hosp = hospitals.find(h => h.id === sim.activeTrip.hospital_id);
                addNotification(`🚨 Patient ${sim.activeTrip.patient_name} has been picked up by ${sim.activeTrip.ambulance_callsign || 'Rescue Unit'}. En route to ${hosp ? hosp.name : 'hospital'}.`, 'success');
              }

            } else {
              next[ambId] = { ...sim, isDriving: false, speed: 0, heading: 0 };
              updated = true;

              // Send final GPS update: status "Arrived", speed 0
              if (wsGpsRef.current && wsGpsRef.current.readyState === WebSocket.OPEN) {
                wsGpsRef.current.send(JSON.stringify({
                  type: "GPS_UPDATE",
                  data: {
                    unitId: ambId,
                    lat: sim.currentLoc.lat,
                    lng: sim.currentLoc.lng,
                    urgency: "stable",
                    status: "Arrived",
                    speed: 0
                  }
                }));
              }

              // Trigger arrival notification
              if (sim.activeTrip) {
                const tripId = sim.activeTrip.id;
                const hosp = hospitals.find(h => h.id === sim.activeTrip.hospital_id);
                addNotification(`🏥 Patient ${sim.activeTrip.patient_name} has successfully arrived at ${hosp ? hosp.name : 'the hospital'}. Completed patient handover.`, 'success');
                
                // Automate patient admission and release ambulance after 5 seconds
                setTimeout(() => {
                  handleAcceptTrip(tripId);
                }, 5000);
              }
            }
          }
        });
        return updated ? next : prev;
      });
    }, 3000);
    return () => clearInterval(driveInterval);
  }, [hospitals]);

  const handleSystemReset = async () => {
    if (window.confirm("Are you sure you want to clear all active dispatches, clinical telemetry logs, and reset the fleet to default positions?")) {
      try {
        const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000' : 'https://eth-apex-2026.onrender.com';
        await fetch(`${API_URL}/api/reset`, { method: 'POST' });
      } catch (err) {
        console.warn("Failed to reset backend state:", err);
      }
      setTrips([]);
      setActiveTrip(null);
      setAmbulances(DEFAULT_AMBULANCES);
      setHospitals(DEFAULT_HOSPITALS);
      console.log("Local system database reset successfully.");
    }
  };

  const handleNewDispatch = (patientData) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "NEW_PATIENT",
        data: patientData
      }));
    }
  };

  // Nav links for top header
  const topNavLinks = [
    { path: '/', label: 'Dashboard' },
    { path: '/emt', label: 'EMT Terminal' },
    { path: '/tracking', label: 'Tracking' },
    { path: '/sos', label: 'SOS' },
  ];

  // Sidebar nav items
  const sidebarItems = [
    { icon: Users, label: 'Patients', path: '/', active: currentPath === '/' },
    { icon: Activity, label: 'Triage', path: '/emt', active: currentPath === '/emt' },
    { icon: BarChart3, label: 'Analytics', path: '/tracking', active: currentPath === '/tracking' },
    { icon: History, label: 'Logs', path: '/logs', active: currentPath === '/logs' },
  ];

  return (
    <div className="dark min-h-screen bg-surface text-on-surface font-body-md">
      
      {/* ===== Left Sidebar ===== */}
      <aside className="fixed left-0 top-0 h-screen w-64 bg-surface-container/80 backdrop-blur-[40px] border-r border-white/10 shadow-xl flex-col py-4 z-40 hidden md:flex">
        {/* Facility Header */}
        <div className="px-6 mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-6 h-6 bg-primary-container/20 rounded flex items-center justify-center">
              <Activity className="text-primary-container" size={14} />
            </div>
            <span className="font-headline-md text-[18px] font-semibold text-on-surface tracking-tight">MediSync Central</span>
          </div>
          <span className="text-[10px] text-on-surface-variant uppercase tracking-widest px-1 font-label-caps">Level 1 Trauma • Unit 04</span>
        </div>

        {!audioUnlocked && (
          <div className="px-4 py-3 mx-4 mb-6 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center animate-pulse">
            <span className="text-[10px] font-label-caps text-amber-400 font-bold block">🔊 AUDIO MUTED</span>
            <span className="text-[9px] text-on-surface-variant leading-tight block mt-1">Click anywhere on this dashboard to enable Voice Alerts.</span>
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 space-y-1">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.active || false;
            return (
              <a
                key={item.label}
                href="#"
                onClick={(e) => { e.preventDefault(); navigate(item.path); }}
                className={`flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-all font-label-caps text-label-caps ${
                  isActive
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-white/5'
                }`}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        {/* New Dispatch Button */}
        <div className="px-4 mb-4">
          <button 
            onClick={() => navigate('/new-dispatch')}
            className="w-full bg-primary-container text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition-all text-sm"
          >
            <Plus size={18} />
            New Dispatch
          </button>
        </div>

        {/* Footer */}
        <footer className="mt-auto border-t border-white/5 pt-4">
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); navigate('/settings'); }}
            className={`flex items-center gap-3 px-4 py-2 mx-2 rounded-lg transition-all font-label-caps text-label-caps ${
              currentPath === '/settings' ? 'bg-white/10 text-on-surface' : 'text-on-surface-variant hover:bg-white/5'
            }`}
          >
            <Settings size={20} />
            <span>Settings</span>
          </a>
          <a 
            href="#" 
            onClick={(e) => { e.preventDefault(); navigate('/notifications'); }}
            className={`flex items-center gap-3 px-4 py-2 mx-2 rounded-lg transition-all font-label-caps text-label-caps ${
              currentPath === '/notifications' ? 'bg-white/10 text-on-surface' : 'text-on-surface-variant hover:bg-white/5'
            }`}
          >
            <Bell size={20} />
            <span>Notifications</span>
          </a>
          <a 
            href="#" 
            onClick={(e) => { 
              e.preventDefault(); 
              localStorage.removeItem('tutorial_completed');
              navigate('/');
            }}
            className="flex items-center gap-3 px-4 py-2 mx-2 text-on-surface-variant hover:bg-white/5 rounded-lg transition-all font-label-caps text-label-caps"
          >
            <HelpCircle size={20} />
            <span>Resume Tour</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2 mx-2 text-on-surface-variant hover:bg-white/5 rounded-lg transition-all font-label-caps text-label-caps">
            <LogOut size={20} />
            <span>Sign Out</span>
          </a>
        </footer>
      </aside>

      {/* ===== Main Content Canvas ===== */}
      <main className="md:ml-64 p-gutter pt-8 min-h-screen">
        
        {currentPath === '/' && (
          <HospitalView 
            socket={null}
            socketConnected={socketConnected}
            ambulances={ambulances}
            hospitals={hospitals}
            trips={trips}
            setHospitals={setHospitals}
            refreshHospitals={() => {}}
            mapFocus={mapFocus}
            onAcceptTrip={handleAcceptTrip}
          />
        )}

        {currentPath === '/emt' && (
          <AmbulanceView 
            socket={wsRef.current} 
            gpsSocket={wsGpsRef.current}
            socketConnected={socketConnected}
            ambulances={ambulances}
            hospitals={hospitals}
            trips={trips}
            activeTrip={activeTrip}
            setActiveTrip={setActiveTrip}
            refreshTrips={() => {}}
            setMapFocus={setMapFocus}
            onNewDispatch={handleNewDispatch}
            simulations={simulations}
            setSimulations={setSimulations}
          />
        )}

        {currentPath === '/tracking' && (
          <CommandView 
            socket={null}
            ambulances={ambulances}
            hospitals={hospitals}
            trips={trips}
          />
        )}

        {currentPath === '/sos' && (
          <SOSView />
        )}

        {currentPath === '/settings' && (
          <SettingsView />
        )}

        {currentPath === '/notifications' && (
          <NotificationsView 
            notificationHistory={notificationHistory}
            onClearHistory={() => setNotificationHistory([])}
          />
        )}

        {currentPath === '/logs' && (
          <LogsView trips={trips} />
        )}

        {currentPath === '/new-dispatch' && (
          <NewDispatchView 
            ambulances={ambulances} 
            onNewDispatch={handleNewDispatch} 
            navigate={navigate} 
          />
        )}
        <TutorialGuide currentPath={currentPath} navigate={navigate} />
      </main>

      {/* Toast Notification Container */}
      <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none max-w-sm w-full">
        {notifications.map(n => (
          <div 
            key={n.id} 
            className={`pointer-events-auto p-4 rounded-xl shadow-2xl border backdrop-blur-md flex items-start gap-3 transition-all duration-300 animate-slide-in ${
              n.type === 'success' 
                ? 'bg-secondary-container/95 border-secondary text-on-secondary-container' 
                : 'bg-primary-container/95 border-primary text-white'
            }`}
          >
            <div className="flex-1 text-sm font-semibold leading-relaxed">
              {n.message}
            </div>
            <button 
              onClick={() => setNotifications(prev => prev.filter(x => x.id !== n.id))}
              className="text-on-surface-variant hover:text-on-surface text-xs"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;

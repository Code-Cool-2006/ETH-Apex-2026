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

  // Connect to FastAPI WebSockets
  useEffect(() => {
    const token = 'ems_device_token_UNIT_A42'; // Auth token registered in auth.py
    
    // 1. Patient Telemetry Channel
    const ws = new WebSocket(`ws://localhost:8000/ws?token=${token}`);
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
            news2_score: p.vitals?.news2Score || 0
          }));
          setTrips(loadedTrips);
          const active = loadedTrips.find(t => t.live_status === 'enroute');
          if (active) setActiveTrip(active);
        } else if (msg.type === 'NEW_PATIENT_BROADCAST') {
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
            news2_score: msg.data.vitals?.news2Score || 0
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
            news2_score: p.vitals?.news2Score || 0
          }));
          setTrips(loadedTrips);
          const active = loadedTrips.find(t => t.live_status === 'enroute');
          setActiveTrip(active || null);
        }
      } catch (err) {
        console.error("Error parsing telemetry message:", err);
      }
    };

    ws.onclose = () => {
      setSocketConnected(false);
      console.log("[WS] Disconnected from Patient Telemetry Channel.");
    };

    // 2. GPS Fleet Tracking Channel
    const wsGps = new WebSocket(`ws://localhost:8000/ws/gps?token=${token}`);
    wsGpsRef.current = wsGps;

    wsGps.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'GPS_STATE' || msg.type === 'GPS_BROADCAST') {
          const gpsMap = {};
          msg.data.forEach(unit => {
            gpsMap[unit.unitId] = unit;
          });
          setAmbulances(prev => prev.map(amb => {
            const update = gpsMap[amb.id];
            if (update) {
              return {
                ...amb,
                lat: update.lat,
                lng: update.lng,
                status: update.status === 'Arrived' ? 'idle' : 'enroute',
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

    return () => {
      ws.close();
      wsGps.close();
    };
  }, []);

  const handleSystemReset = () => {
    if (window.confirm("Are you sure you want to clear all active dispatches, clinical telemetry logs, and reset the fleet to default positions?")) {
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

  const handleAcceptTrip = (tripId) => {
    setTrips(prev => prev.map(t => t.id === tripId ? { ...t, live_status: 'completed', urgency: 'stable' } : t));
    setActiveTrip(prev => prev && prev.id === tripId ? null : prev);
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
          <a href="#" className="flex items-center gap-3 px-4 py-2 mx-2 text-on-surface-variant hover:bg-white/5 rounded-lg transition-all font-label-caps text-label-caps">
            <Bell size={20} />
            <span>Notifications</span>
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2 mx-2 text-on-surface-variant hover:bg-white/5 rounded-lg transition-all font-label-caps text-label-caps">
            <HelpCircle size={20} />
            <span>Support</span>
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
            socketConnected={socketConnected}
            ambulances={ambulances}
            hospitals={hospitals}
            trips={trips}
            activeTrip={activeTrip}
            setActiveTrip={setActiveTrip}
            refreshTrips={() => {}}
            setMapFocus={setMapFocus}
            onNewDispatch={handleNewDispatch}
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

      </main>
    </div>
  );
}

export default App;

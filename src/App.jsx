import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { ShieldAlert, Search, Bell, Settings, Users, Activity, BarChart3, History, HelpCircle, LogOut, Plus, Trash2 } from 'lucide-react';
import './App.css';
import AmbulanceView from './components/AmbulanceView';
import HospitalView from './components/HospitalView';
import CommandView from './components/CommandView';
import SOSView from './components/SOSView';
import SettingsView from './components/SettingsView';

// Connect to real-time server
const socket = io('http://localhost:5000', {
  autoConnect: true,
  reconnection: true
});

function App() {
  const [socketConnected, setSocketConnected] = useState(false);
  const [ambulances, setAmbulances] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [trips, setTrips] = useState([]);
  
  // Simulation Active Trip state
  const [activeTrip, setActiveTrip] = useState(null);
  
  // Custom router state
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  
  // Dynamic Map Focusing coord trigger
  const [mapFocus, setMapFocus] = useState(null);

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

  // Fetch initial data on load
  const fetchData = async () => {
    try {
      const resAmb = await fetch('http://localhost:5000/api/ambulances');
      if (resAmb.ok) {
        const data = await resAmb.json();
        setAmbulances(data);
      }
      
      const resHosp = await fetch('http://localhost:5000/api/hospitals');
      if (resHosp.ok) {
        const data = await resHosp.json();
        setHospitals(data);
      }

      const resTrips = await fetch('http://localhost:5000/api/trips');
      if (resTrips.ok) {
        const data = await resTrips.json();
        setTrips(data);
        
        const active = data.find(t => t.live_status === 'enroute');
        if (active) {
          setActiveTrip(active);
        } else {
          setActiveTrip(null);
        }
      }
    } catch (err) {
      console.warn("Could not connect to Express API. Ensure the backend server is running on port 5000.", err.message);
    }
  };

  useEffect(() => {
    fetchData();

    socket.on('connect', () => {
      setSocketConnected(true);
      console.log("Connected to Realtime Server via WebSockets.");
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
      console.log("Disconnected from Realtime Server.");
    });

    socket.on('trip-started', () => {
      fetchData();
    });

    socket.on('trip-completed', () => {
      fetchData();
      setActiveTrip(null);
    });

    socket.on('hospital-update', (updatedHosp) => {
      setHospitals(prev => prev.map(h => h.id === updatedHosp.id ? updatedHosp : h));
    });

    socket.on('system-reset', () => {
      fetchData();
      setActiveTrip(null);
    });

    const interval = setInterval(fetchData, 8000);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('trip-started');
      socket.off('trip-completed');
      socket.off('hospital-update');
      socket.off('system-reset');
      clearInterval(interval);
    };
  }, []);

  const handleSystemReset = async () => {
    if (window.confirm("Are you sure you want to clear all active dispatches, clinical telemetry logs, and reset the fleet to default positions?")) {
      try {
        const response = await fetch('http://localhost:5000/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
          console.log("System database reset successfully.");
        }
      } catch (err) {
        console.error("Error resetting system:", err);
      }
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
    { icon: Users, label: 'Patients', path: '/' },
    { icon: Activity, label: 'Triage', path: '/', active: currentPath === '/' },
    { icon: BarChart3, label: 'Analytics', path: '/tracking' },
    { icon: History, label: 'Logs', path: '/emt' },
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
            onClick={handleSystemReset}
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
            socket={socket}
            socketConnected={socketConnected}
            ambulances={ambulances}
            hospitals={hospitals}
            trips={trips}
            setHospitals={setHospitals}
            refreshHospitals={fetchData}
            mapFocus={mapFocus}
          />
        )}

        {currentPath === '/emt' && (
          <AmbulanceView 
            socket={socket} 
            socketConnected={socketConnected}
            ambulances={ambulances}
            hospitals={hospitals}
            trips={trips}
            activeTrip={activeTrip}
            setActiveTrip={setActiveTrip}
            refreshTrips={fetchData}
            setMapFocus={setMapFocus}
          />
        )}

        {currentPath === '/tracking' && (
          <CommandView 
            socket={socket}
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

        {currentPath === '/sandbox' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-120px)]">
            <AmbulanceView 
              socket={socket} 
              socketConnected={socketConnected}
              ambulances={ambulances}
              hospitals={hospitals}
              trips={trips}
              activeTrip={activeTrip}
              setActiveTrip={setActiveTrip}
              refreshTrips={fetchData}
              setMapFocus={setMapFocus}
            />
            <HospitalView 
              socket={socket}
              socketConnected={socketConnected}
              ambulances={ambulances}
              hospitals={hospitals}
              trips={trips}
              setHospitals={setHospitals}
              refreshHospitals={fetchData}
              mapFocus={mapFocus}
            />
          </div>
        )}

      </main>
    </div>
  );
}

export default App;

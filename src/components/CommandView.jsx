import React, { useEffect, useState, useRef } from 'react';
import { ShieldAlert, Activity, Navigation, Database, Layers, BarChart2, CheckCircle, Clock, Truck, ShieldCheck, Filter, Hospital, Plus, Minus } from 'lucide-react';

export default function CommandView({ socket, ambulances, hospitals, trips }) {
  const [selectedAmbulanceId, setSelectedAmbulanceId] = useState(null);
  const [trafficClearanceActive, setTrafficClearanceActive] = useState({});
  const [mapRoutes, setMapRoutes] = useState({});
  
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const routesRef = useRef({});
  const routeCacheRef = useRef({});

  const toggleTrafficClearance = (tripId) => {
    setTrafficClearanceActive(prev => ({ ...prev, [tripId]: !prev[tripId] }));
  };

  const fetchOSRMRoute = async (tripId, start, end) => {
    const cacheKey = `${tripId}-${end.id}`;
    if (routeCacheRef.current[cacheKey]) return routeCacheRef.current[cacheKey];
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
    } catch (err) { console.warn("OSRM routing failed:", err); }
    const straight = [[start.lat, start.lng], [end.lat, end.lng]];
    routeCacheRef.current[cacheKey] = straight;
    return straight;
  };

  useEffect(() => {
    if (!window.L || !mapContainerRef.current) return;
    const L = window.L;
    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, { center: [15.852, 74.504], zoom: 13, zoomControl: false, attributionControl: false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(mapRef.current);
    }
    const map = mapRef.current;

    Object.keys(markersRef.current).forEach(id => {
      const remains = hospitals.some(h => h.id === id) || ambulances.some(a => a.id === id);
      if (!remains) { map.removeLayer(markersRef.current[id]); delete markersRef.current[id]; }
    });

    hospitals.forEach(h => {
      if (!markersRef.current[h.id]) {
        const color = h.has_trauma ? '#ef4444' : '#10b981';
        const htmlIcon = L.divIcon({ html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color};"></div>`, className: '', iconSize: [12, 12], iconAnchor: [6, 6] });
        markersRef.current[h.id] = L.marker([h.lat, h.lng], { icon: htmlIcon }).bindPopup(`<strong>${h.name}</strong>`).addTo(map);
      }
    });

    ambulances.forEach(a => {
      const activeTrip = trips.find(t => t.ambulance_id === a.id && t.live_status === 'enroute');
      const urgency = activeTrip ? activeTrip.urgency : 'stable';
      const markerColor = a.status === 'idle' ? '#6b7280' : urgency === 'critical' ? '#ef4444' : urgency === 'urgent' ? '#f59e0b' : '#10b981';
      const htmlIcon = L.divIcon({ html: `<div class="${urgency === 'critical' ? 'map-marker-pulse' : ''}" style="background-color: ${markerColor}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 8px ${markerColor};"></div>`, className: '', iconSize: [14, 14], iconAnchor: [7, 7] });
      
      if (!markersRef.current[a.id]) {
        markersRef.current[a.id] = L.marker([a.lat, a.lng], { icon: htmlIcon }).bindPopup(`<strong>${a.callsign}</strong>`).addTo(map);
      } else {
        markersRef.current[a.id].setLatLng([a.lat, a.lng]).setIcon(htmlIcon);
      }
    });

    Object.keys(routesRef.current).forEach(tripId => {
      if (!trips.some(t => t.id === tripId && t.live_status === 'enroute')) { map.removeLayer(routesRef.current[tripId]); delete routesRef.current[tripId]; }
    });

    trips.filter(t => t.live_status === 'enroute').forEach(async (t) => {
      const amb = ambulances.find(a => a.id === t.ambulance_id);
      const hosp = hospitals.find(h => h.id === t.hospital_id);
      if (amb && hosp) {
        const cacheKey = `${t.id}-${hosp.id}`;
        if (!mapRoutes[cacheKey]) {
          const coords = await fetchOSRMRoute(t.id, amb, hosp);
          setMapRoutes(prev => ({ ...prev, [cacheKey]: coords }));
          return;
        }
        const pathCoords = mapRoutes[cacheKey];
        const hasClearance = trafficClearanceActive[t.id];
        const color = hasClearance ? '#4edea3' : (t.urgency === 'critical' ? '#ef4444' : t.urgency === 'urgent' ? '#f59e0b' : '#10b981');
        const dashArray = hasClearance ? '' : '8, 8';
        const weight = hasClearance ? 4 : 3;
        if (!routesRef.current[t.id]) {
          routesRef.current[t.id] = L.polyline(pathCoords, { color, weight, dashArray, opacity: 0.9 }).addTo(map);
        } else {
          routesRef.current[t.id].setLatLngs(pathCoords).setStyle({ color, weight, dashArray });
        }
      }
    });
  }, [ambulances, hospitals, trips, trafficClearanceActive, mapRoutes]);

  useEffect(() => {
    if (selectedAmbulanceId && mapRef.current) {
      const amb = ambulances.find(a => a.id === selectedAmbulanceId);
      if (amb) mapRef.current.flyTo([amb.lat, amb.lng], 14, { animate: true, duration: 1.5 });
    }
  }, [selectedAmbulanceId, ambulances]);

  const activeFleet = trips.filter(t => t.live_status === 'enroute');

  return (
    <div className="relative h-[calc(100vh-120px)] flex">
      
      {/* Left Fleet Sidebar */}
      <div className="w-80 flex-shrink-0 flex flex-col gap-4 z-10 p-4 overflow-y-auto">
        {/* Fleet Header */}
        <div className="glass-panel rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-headline-md text-[18px] font-semibold text-on-surface">Active Fleet ({ambulances.length})</h3>
            <button className="text-on-surface-variant hover:bg-white/5 p-1.5 rounded-lg transition-all">
              <Filter size={16} />
            </button>
          </div>

          <div className="space-y-3">
            {ambulances.filter(a => {
              const activeTrip = trips.find(t => t.ambulance_id === a.id && t.live_status === 'enroute');
              return activeTrip; // only show active units
            }).map(a => {
              const activeTrip = trips.find(t => t.ambulance_id === a.id && t.live_status === 'enroute');
              const urgency = activeTrip ? activeTrip.urgency : 'stable';
              const isSelected = selectedAmbulanceId === a.id;
              const borderColor = urgency === 'critical' ? 'border-l-primary' : urgency === 'urgent' ? 'border-l-tertiary' : 'border-l-secondary';
              const textColor = urgency === 'critical' ? 'text-primary' : urgency === 'urgent' ? 'text-tertiary' : 'text-secondary';

              return (
                <div 
                  key={a.id}
                  onClick={() => setSelectedAmbulanceId(a.id)}
                  className={`bg-white/5 border border-white/10 rounded-lg p-3 cursor-pointer transition-all hover:bg-white/[0.08] border-l-4 ${borderColor} ${isSelected ? 'ring-1 ring-primary/30' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-bold text-sm ${textColor}`}>{a.callsign}</span>
                    <span className={`text-[10px] font-label-caps px-2 py-0.5 rounded border ${
                      urgency === 'critical' 
                        ? 'bg-primary/20 text-primary border-primary/30' 
                        : urgency === 'urgent'
                        ? 'bg-tertiary/20 text-tertiary border-tertiary/30'
                        : 'bg-secondary/20 text-secondary border-secondary/30'
                    }`}>
                      {urgency.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">{activeTrip?.symptoms?.slice(0, 40) || 'Active dispatch'} - ETA {String(Math.round(Math.random() * 15 + 2)).padStart(2, '0')}m</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] font-label-caps text-on-surface-variant">
                    <span>⏱ {Math.round(Math.random() * 50 + 40)} MPH</span>
                    <span>🩸 {activeTrip?.news2_score || '--'}%</span>
                  </div>
                </div>
              );
            })}

            {ambulances.filter(a => !trips.find(t => t.ambulance_id === a.id && t.live_status === 'enroute')).map(a => (
              <div 
                key={a.id}
                onClick={() => setSelectedAmbulanceId(a.id)}
                className={`bg-white/5 border border-white/10 rounded-lg p-3 cursor-pointer transition-all hover:bg-white/[0.08] border-l-4 border-l-secondary opacity-50 ${selectedAmbulanceId === a.id ? 'ring-1 ring-primary/30' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-secondary">{a.callsign}</span>
                  <span className="text-[10px] font-label-caps px-2 py-0.5 rounded border bg-secondary/20 text-secondary border-secondary/30">STABLE</span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">Inter-facility Transfer</p>
              </div>
            ))}
          </div>
        </div>

        {/* Nearest Facilities */}
        <div className="glass-panel rounded-xl p-4">
          <h3 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-3">Nearest Facilities</h3>
          <div className="space-y-2">
            {hospitals.slice(0, 3).map(h => {
              const capacityPct = Math.round((h.icu_beds / (h.total_beds * 0.1 || 12)) * 100);
              const atLimit = capacityPct > 90;
              return (
                <div key={h.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Hospital size={14} className="text-on-surface-variant" />
                    <span className="text-sm font-medium text-on-surface">{h.name.split(' ').slice(0, 2).join(' ')}</span>
                  </div>
                  <span className={`text-[10px] font-label-caps px-2 py-0.5 rounded ${atLimit ? 'bg-primary/20 text-primary' : 'bg-secondary/20 text-secondary'}`}>
                    {atLimit ? 'AT LIMIT' : `CAPACITY ${capacityPct}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Map Area */}
      <div className="flex-1 relative rounded-xl overflow-hidden border border-white/10">
        <div ref={mapContainerRef} className="w-full h-full" />
        
        {/* Map Zoom Controls */}
        <div className="absolute right-4 top-4 flex flex-col gap-2 z-[1000]">
          <button onClick={() => mapRef.current?.zoomIn()} className="glass-panel w-10 h-10 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
            <Plus size={18} />
          </button>
          <button onClick={() => mapRef.current?.zoomOut()} className="glass-panel w-10 h-10 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
            <Minus size={18} />
          </button>
          <button className="glass-panel w-10 h-10 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
            <Layers size={18} />
          </button>
        </div>

        {/* Emergency Protocol Toggle */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
          <div className="glass-panel rounded-xl px-6 py-3 flex items-center gap-4">
            <ShieldCheck className="text-secondary" size={20} />
            <div>
              <p className="text-sm font-bold text-on-surface">Emergency Protocol</p>
              <p className="text-xs text-on-surface-variant">Request Traffic Clearance</p>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={Object.values(trafficClearanceActive).some(v => v)} 
                onChange={() => {
                  const anyActive = activeFleet.length > 0;
                  if (anyActive) {
                    const firstTrip = activeFleet[0];
                    toggleTrafficClearance(firstTrip.id);
                  }
                }} 
              />
              <span className="slider-toggle"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

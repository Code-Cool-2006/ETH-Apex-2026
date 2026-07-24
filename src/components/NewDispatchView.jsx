import React, { useState } from 'react';
import { Radio, ShieldAlert } from 'lucide-react';

export default function NewDispatchView({ ambulances, onNewDispatch, navigate }) {
  const [selectedAmbId, setSelectedAmbId] = useState(ambulances[0]?.id || '');
  const [form, setForm] = useState({
    patientName: 'PT-9283',
    patientAge: '52',
    symptoms: 'Patient presenting with acute myocardial infarction indicators. ST-elevation detected in Lead II telemetry.',
    urgency: 'critical',
    hr: 142,
    spo2: 88,
    bpSys: 90,
    rr: 26,
    temp: 37.2
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const targetAmbId = selectedAmbId || ambulances[0]?.id || 'AMB-01';

    const newPatientId = "PT-" + Math.random().toString(36).substr(2, 9).toUpperCase();
    const tempCelsius = parseFloat(form.temp) || 37.0;

    const patientData = {
      id: newPatientId,
      name: form.patientName,
      age: parseInt(form.patientAge) || 52,
      symptoms: form.symptoms,
      urgency: form.urgency,
      status: "EnRoute",
      vitals: {
        hr: parseInt(form.hr) || 72,
        spo2: parseInt(form.spo2) || 98,
        bpSys: parseInt(form.bpSys) || 120,
        bpDia: 60,
        rr: parseInt(form.rr) || 16,
        temp: parseFloat(tempCelsius.toFixed(1)),
        news2Score: form.urgency === 'critical' ? 6 : 2
      },
      assignedHospital: { id: "HOSP-01" },
      ambulanceId: targetAmbId,
      ambulanceCallsign: ambulances.find(a => a.id === targetAmbId)?.callsign || "Rescue Unit"
    };

    if (onNewDispatch) {
      onNewDispatch(patientData);
    }
    // Navigate to Fleet Tracking view to display the en-route unit
    navigate('/tracking');
  };

  const loadPreset = (type) => {
    const presets = {
      cardiac: { patientName: 'PT-9283', patientAge: '52', urgency: 'critical', symptoms: 'Patient presenting with acute myocardial infarction indicators. ST-elevation detected in Lead II telemetry. Cath lab prep requested.', hr: 142, spo2: 88, bpSys: 90, rr: 26, temp: 37.2 },
      trauma: { patientName: 'PT-4412', patientAge: '28', urgency: 'urgent', symptoms: 'Moderate respiratory distress following blunt force trauma to the chest. Oxygen saturation fluctuating between 92-94%. Possible pneumothorax.', hr: 110, spo2: 94, bpSys: 105, rr: 22, temp: 36.6 },
      respiratory: { patientName: 'PT-1109', patientAge: '67', urgency: 'stable', symptoms: 'Stable respiratory baseline, minor dyspnea reported.', hr: 78, spo2: 98, bpSys: 120, rr: 16, temp: 36.8 }
    };
    if (presets[type]) {
      setForm(prev => ({ ...prev, ...presets[type] }));
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">Create New Dispatch</h1>
        <p className="text-on-surface-variant text-sm">Assign an active unit and load diagnostic templates</p>
      </div>

      <div className="glass-panel rounded-xl p-6 space-y-6">
        {/* Preset selection */}
        <div>
          <label className="font-label-caps text-[10px] text-on-surface-variant block mb-2">SCENARIO TEMPLATES</label>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => loadPreset('cardiac')} className="bg-white/5 hover:bg-white/10 text-xs py-2 rounded text-on-surface border border-white/10">Cardiac Preset</button>
            <button onClick={() => loadPreset('trauma')} className="bg-white/5 hover:bg-white/10 text-xs py-2 rounded text-on-surface border border-white/10">Trauma Preset</button>
            <button onClick={() => loadPreset('respiratory')} className="bg-white/5 hover:bg-white/10 text-xs py-2 rounded text-on-surface border border-white/10">Stable Preset</button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="font-label-caps text-[10px] text-on-surface-variant block">ASSIGN AMBULANCE UNIT</label>
              <select value={selectedAmbId} onChange={(e) => setSelectedAmbId(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface">
                {ambulances.map(a => (
                  <option key={a.id} value={a.id}>{a.callsign}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="font-label-caps text-[10px] text-on-surface-variant block">URGENCY CLASS</label>
              <select value={form.urgency} onChange={(e) => setForm(prev => ({ ...prev, urgency: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface">
                <option value="stable">STABLE</option>
                <option value="urgent">URGENT</option>
                <option value="critical">CRITICAL</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="font-label-caps text-[10px] text-on-surface-variant block">PATIENT NAME</label>
              <input value={form.patientName} onChange={(e) => setForm(prev => ({ ...prev, patientName: e.target.value }))} required className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface" />
            </div>
            <div className="space-y-2">
              <label className="font-label-caps text-[10px] text-on-surface-variant block">AGE</label>
              <input type="number" value={form.patientAge} onChange={(e) => setForm(prev => ({ ...prev, patientAge: e.target.value }))} required className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="font-label-caps text-[10px] text-on-surface-variant block">CREW SYMPTOMS LOG</label>
            <textarea value={form.symptoms} onChange={(e) => setForm(prev => ({ ...prev, symptoms: e.target.value }))} required rows="3" className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-on-surface" />
          </div>

          <div className="grid grid-cols-5 gap-3">
            <div>
              <label className="font-label-caps text-[10px] text-on-surface-variant block mb-1">HR</label>
              <input type="number" value={form.hr} onChange={(e) => setForm(prev => ({ ...prev, hr: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="font-label-caps text-[10px] text-on-surface-variant block mb-1">SPO2</label>
              <input type="number" value={form.spo2} onChange={(e) => setForm(prev => ({ ...prev, spo2: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="font-label-caps text-[10px] text-on-surface-variant block mb-1">BP SYS</label>
              <input type="number" value={form.bpSys} onChange={(e) => setForm(prev => ({ ...prev, bpSys: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="font-label-caps text-[10px] text-on-surface-variant block mb-1">RESP RATE</label>
              <input type="number" value={form.rr} onChange={(e) => setForm(prev => ({ ...prev, rr: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="font-label-caps text-[10px] text-on-surface-variant block mb-1">TEMP</label>
              <input type="number" step="0.1" value={form.temp} onChange={(e) => setForm(prev => ({ ...prev, temp: e.target.value }))} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-sm" />
            </div>
          </div>

          <button type="submit" className="w-full bg-primary-container text-white py-3 rounded-lg font-bold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2">
            <Radio size={16} /> Transmit Live Telemetry
          </button>
        </form>
      </div>
    </div>
  );
}

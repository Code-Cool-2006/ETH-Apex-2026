import React from 'react';
import { History, CheckCircle, Clock, AlertTriangle, FileText } from 'lucide-react';

export default function LogsView({ trips }) {
  // Filter for completed/historical patient records
  const historicalLogs = trips.filter(t => t.live_status === 'completed');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-primary font-label-caps text-label-caps mb-1">
            <History size={14} />
            <span>ARCHIVED PATIENT TELEMETRY</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">Historical Triage Logs</h1>
        </div>
        <div className="bg-white/5 px-4 py-2 rounded-xl glass-panel text-xs text-on-surface-variant font-label-caps">
          Total Logs: {String(historicalLogs.length).padStart(2, '0')}
        </div>
      </div>

      {historicalLogs.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center flex flex-col items-center justify-center space-y-4">
          <FileText size={48} className="text-on-surface-variant opacity-35" />
          <h3 className="text-lg font-bold text-on-surface">No Historical Logs Found</h3>
          <p className="text-sm text-on-surface-variant max-w-md">
            Once active patient handovers are completed in the EMT Terminal, they will be archived here as permanent clinical records.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {historicalLogs.map((log) => {
            const isCritical = log.urgency === 'critical';
            const urgencyColor = isCritical ? 'border-l-primary text-primary bg-primary/5' : log.urgency === 'urgent' ? 'border-l-tertiary text-tertiary bg-tertiary/5' : 'border-l-secondary text-secondary bg-secondary/5';

            return (
              <div 
                key={log.id} 
                className={`glass-panel rounded-xl border-l-4 ${urgencyColor.split(' ')[0]} p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all hover:bg-white/[0.02]`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center border border-white/10">
                    <CheckCircle className="text-secondary" size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-on-surface">{log.patient_name} ({log.patient_age}y)</h3>
                      <span className={`text-[10px] font-label-caps px-2 py-0.5 rounded border ${urgencyColor.split(' ')[1]} ${urgencyColor.split(' ')[2]} border-white/10`}>
                        {log.urgency.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-1">ID: {log.id} | Unit: {log.ambulance_callsign}</p>
                  </div>
                </div>

                <div className="flex-1 max-w-md">
                  <span className="text-[10px] font-label-caps text-on-surface-variant uppercase">Clinical Narrative Summary</span>
                  <p className="text-sm text-on-surface mt-0.5 italic">"{log.symptoms}"</p>
                </div>

                <div className="text-right">
                  <div className="text-xs text-on-surface-variant flex items-center gap-1.5 justify-end">
                    <Clock size={12} />
                    Arrived at ER
                  </div>
                  <strong className="text-sm text-on-surface block mt-1">{log.hospital_name || 'MediSync Central'}</strong>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

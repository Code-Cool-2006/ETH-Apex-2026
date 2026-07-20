import React from 'react';
import { Bell, Clock, Info, ShieldAlert, CheckCircle2, Trash2 } from 'lucide-react';
export default function NotificationsView({ notificationHistory, onClearHistory }) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-primary font-label-caps text-label-caps mb-1">
            <Bell size={14} />
            <span>SYSTEM AUDIT LOGS</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface">Notification History</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white/5 px-4 py-2 rounded-xl glass-panel text-xs text-on-surface-variant font-label-caps">
            Total Alerts: {String(notificationHistory.length).padStart(2, '0')}
          </div>
          {notificationHistory.length > 0 && (
            <button
              onClick={onClearHistory}
              className="bg-white/5 hover:bg-white/10 text-on-surface px-4 py-2 rounded-xl text-xs font-bold font-label-caps border border-white/10 flex items-center gap-2 transition-all active:scale-95"
            >
              <Trash2 size={14} /> Clear History
            </button>
          )}
        </div>
      </div>

      {notificationHistory.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center flex flex-col items-center justify-center space-y-4">
          <Bell size={48} className="text-on-surface-variant opacity-35 animate-bounce" />
          <h3 className="text-lg font-bold text-on-surface">No Notifications Recorded</h3>
          <p className="text-sm text-on-surface-variant max-w-md">
            Broadcast dispatches, patient pickups, arrivals, and hospital admission alerts will be tracked and archived in this timeline.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notificationHistory.map((notif) => {
            const isEmergency = notif.message.includes('🚨') || notif.type === 'critical';
            const isSuccess = notif.message.includes('🏥') || notif.type === 'success';

            const iconBg = isEmergency
              ? 'bg-red-500/10 text-red-500 border-red-500/20'
              : isSuccess
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                : 'bg-blue-500/10 text-blue-500 border-blue-500/20';

            const Icon = isEmergency ? ShieldAlert : isSuccess ? CheckCircle2 : Info;

            return (
              <div
                key={notif.id}
                className="glass-panel rounded-xl p-4 flex items-center justify-between gap-4 border border-white/5 hover:bg-white/[0.01] transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${iconBg}`}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <p className="text-sm text-on-surface font-medium leading-relaxed">
                      {notif.message}
                    </p>
                    <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant mt-1.5 font-label-caps">
                      <Clock size={11} />
                      <span>{notif.timestamp}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

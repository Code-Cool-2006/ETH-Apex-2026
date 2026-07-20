import React, { useState } from 'react';

export default function FaceScanner({ onVerify }) {
  const [scanState, setScanState] = useState('idle'); // 'idle' | 'scanning' | 'success'
  const [statusText, setStatusText] = useState('TAP TO SCAN');

  const startScan = () => {
    if (scanState !== 'idle') return;
    setScanState('scanning');
    setStatusText('IDENTIFYING FACE...');

    // Progress updates
    setTimeout(() => {
      setStatusText('MAPPING BIOMETRICS...');
    }, 800);

    setTimeout(() => {
      setStatusText('VERIFYING CREDENTIALS...');
    }, 1600);

    setTimeout(() => {
      setScanState('success');
      setStatusText('ACCESS GRANTED');
      setTimeout(() => {
        if (onVerify) onVerify();
      }, 600);
    }, 2400);
  };

  return (
    <div className="face-scanner-wrapper">
      <div 
        className={`face-scanner-container ${scanState}`} 
        onClick={startScan}
      >
        {/* Face scanning brackets and HUD */}
        <div className="hud-brackets">
          <svg className="hud-svg" viewBox="0 0 200 200">
            {/* Corners */}
            <path d="M 20,40 L 20,20 L 40,20" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <path d="M 160,20 L 180,20 L 180,40" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <path d="M 20,160 L 20,180 L 40,180" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <path d="M 160,180 L 180,180 L 180,160" fill="none" stroke="currentColor" strokeWidth="2.5" />
            
            {/* Outer dotted target ring */}
            <circle cx="100" cy="100" r="75" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4, 4" opacity="0.3" />
            
            {/* Face silhouette wireframe */}
            <path 
              d="M 100,50 C 75,50 65,70 65,95 C 65,120 80,140 100,150 C 120,140 135,120 135,95 C 135,70 125,50 100,50 Z" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              className="face-path" 
            />
            {/* Eyes, Nose, Mouth tracking nodes */}
            <circle cx="85" cy="85" r="3" fill="currentColor" className="mesh-node node-eye-l" />
            <circle cx="115" cy="85" r="3" fill="currentColor" className="mesh-node node-eye-r" />
            <path d="M 100,80 L 100,105 L 95,110" fill="none" stroke="currentColor" strokeWidth="2" className="mesh-node node-nose" />
            <path d="M 85,125 Q 100,135 115,125" fill="none" stroke="currentColor" strokeWidth="2" className="mesh-node node-mouth" />
            
            {/* Target Crosshair */}
            <path d="M 100,25 L 100,35 M 100,165 L 100,175 M 25,100 L 35,100 M 165,100 L 175,100" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
          </svg>
        </div>

        {/* Laser Sweep Line */}
        <div className="laser-sweep" />

        {/* Scanning status banner */}
        <div className="status-label">{statusText}</div>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';

// ponytail: using a simple global state in localStorage + route matching instead of a complex tour library (e.g. driver.js).
// Ceiling: This won't highlight specific UI elements or block interactions. 
// Upgrade path: If the user gets lost and needs a strict guided overlay, we can upgrade to driver.js later.

const TUTORIAL_STEPS = [
  { path: '/', title: 'Welcome to MediSync!', text: 'Let\'s simulate an emergency. Click on "New Dispatch" in the sidebar to create a telemetry ticket.', nextPath: '/new-dispatch', nextLabel: 'Go to Dispatch' },
  { path: '/new-dispatch', title: 'Create a Dispatch', text: 'Fill out the form or use a Quick Load scenario at the top, then hit "Dispatch Unit". After dispatching, head to the Fleet Tracking page.', nextPath: '/tracking', nextLabel: 'Go to Tracking' },
  { path: '/tracking', title: 'Fleet Tracking', text: 'The ambulance is now en route on the map! You can monitor its speed and ETA. Next, let\'s jump into the ambulance to see what the EMT sees.', nextPath: '/emt', nextLabel: 'Go to Triage Terminal' },
  { path: '/emt', title: 'EMT Triage & AI', text: 'Here, EMTs monitor live vitals and can use voice notes. Click the "Prescribe Medication" chip to have the AI analyze the vitals and recommend protocols! Once they arrive at the hospital, they will automatically be admitted.', nextPath: '/notifications', nextLabel: 'Check Notifications' },
  { path: '/notifications', title: 'Notifications Audit', text: 'All dispatch, arrival, and admission events are permanently logged here. This concludes the tutorial!', nextPath: null, nextLabel: 'Finish Tour' }
];

export default function TutorialGuide({ currentPath, navigate }) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);

  useEffect(() => {
    if (localStorage.getItem('tutorial_completed') === 'true') {
      setIsVisible(false);
      return;
    }

    const step = TUTORIAL_STEPS.find(s => currentPath === s.path);
    if (step) {
      setCurrentStep(step);
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [currentPath]);

  const handleNext = () => {
    if (currentStep.nextPath) {
      navigate(currentStep.nextPath);
    } else {
      localStorage.setItem('tutorial_completed', 'true');
      setIsVisible(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem('tutorial_completed', 'true');
    setIsVisible(false);
  };

  if (!isVisible || !currentStep) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '30px',
      right: '30px',
      width: '320px',
      backgroundColor: '#1E293B',
      color: 'white',
      padding: '20px',
      borderRadius: '12px',
      boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
      zIndex: 9999,
      border: '1px solid #334155'
    }}>
      <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '24px' }}>🎓</span> {currentStep.title}
      </h3>
      <p style={{ fontSize: '14px', color: '#94A3B8', marginBottom: '20px', lineHeight: '1.5' }}>
        {currentStep.text}
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button 
          onClick={handleSkip}
          style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '14px' }}
        >
          Skip Tour
        </button>
        <button 
          onClick={handleNext}
          style={{ background: '#3B82F6', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {currentStep.nextLabel}
        </button>
      </div>
    </div>
  );
}

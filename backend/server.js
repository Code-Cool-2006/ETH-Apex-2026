import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import tls from 'tls';

// Parse .env file manually to avoid dependency friction
if (fs.existsSync('.env')) {
  const env = fs.readFileSync('.env', 'utf8');
  env.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index > 0) {
      const key = trimmed.substring(0, index).trim();
      const val = trimmed.substring(index + 1).replace(/^["']|["']$/g, '').trim();
      process.env[key] = val;
    }
  });
}

import db from './db.js';
import { scoreVitals, extractRedFlags, fuseTriage, matchHospitals, evaluateNeuralTriage } from './triage.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Initialize Database
await db.init();

// --- REST API ENDPOINTS ---

// Get all ambulances
app.get('/api/ambulances', async (req, res) => {
  try {
    const list = await db.getAmbulances();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all hospitals
app.get('/api/hospitals', async (req, res) => {
  try {
    const list = await db.getHospitals();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all active and past trips
app.get('/api/trips', async (req, res) => {
  try {
    const list = await db.getTrips();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get detailed trip data
app.get('/api/trips/:id', async (req, res) => {
  try {
    const trip = await db.getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const vitalsHistory = await db.getVitalsHistory(req.params.id);
    const triage = await db.getTriageResult(req.params.id);

    res.json({
      trip,
      vitalsHistory,
      triage
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start a new ambulance trip
app.post('/api/trips', async (req, res) => {
  try {
    const { ambulance_id, patient_name, patient_age, symptoms, lat, lng } = req.body;
    
    if (!ambulance_id || !patient_name || !patient_age) {
      return res.status(400).json({ error: "Missing required ambulance_id, patient_name, or patient_age" });
    }

    const amb = await db.getAmbulance(ambulance_id);
    if (!amb) return res.status(404).json({ error: "Ambulance not found" });

    if (amb.status !== 'idle') {
      return res.status(400).json({ error: "Ambulance is currently active on another dispatch" });
    }

    // Determine current location (use body or fallback to ambulance default)
    const currentLat = lat || amb.lat;
    const currentLng = lng || amb.lng;

    // Fetch hospitals to recommend the initial match
    const hospitals = await db.getHospitals();
    
    // Initial neural triage with baseline normal vitals
    const baselineVitals = { hr: 75, spo2: 98, systolicBP: 120, temp: 36.6, respRate: 14 };
    const triageResult = await evaluateNeuralTriage(baselineVitals, symptoms, patient_age, patient_name);
    const matchResult = matchHospitals(currentLat, currentLng, triageResult.redFlags, triageResult.urgency, hospitals);
    const recommendedHospitalId = matchResult.recommended ? matchResult.recommended.id : null;

    const tripId = 'trip-' + Date.now();
    const trip = await db.createTrip(tripId, ambulance_id, recommendedHospitalId, patient_name, patient_age, symptoms);

    // Save initial triage
    await db.updateTripTriage(
      tripId, 
      triageResult.vitalsUrgency, 
      triageResult.redFlags, 
      triageResult.escalatedByFlags, 
      triageResult.summary, 
      triageResult.vitalsScore, 
      triageResult.urgency,
      recommendedHospitalId,
      triageResult.confidence,
      triageResult.modelType
    );

    // Update ambulance position and status
    await db.updateAmbulanceLocation(ambulance_id, currentLat, currentLng, 'enroute', 0, 0, tripId);

    // Broadcast setup to all dashboard clients
    io.emit('trip-started', { trip_id: tripId, ambulance_id });

    res.json({ trip, triage: triageResult, hospitalMatch: matchResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update hospital ICU beds
app.post('/api/hospitals/:id/beds', async (req, res) => {
  try {
    const { icu_beds } = req.body;
    const updated = await db.updateHospitalBeds(req.params.id, icu_beds);
    io.emit('hospital-update', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete a trip (patient handed off to hospital)
app.post('/api/trips/:id/complete', async (req, res) => {
  try {
    const { ambulance_id, hospital_id } = req.body;
    await db.completeTrip(req.params.id, ambulance_id, hospital_id);
    io.emit('trip-completed', { trip_id: req.params.id, ambulance_id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retrain ML model (proxy to Python service)
const PYTHON_ML_URL = process.env.PYTHON_ML_URL || 'http://localhost:8000';

app.post('/api/retrain', async (req, res) => {
  try {
    const { epochs = 150, lr = 0.015, data_count = 2500 } = req.body;
    console.log(`Proxying retrain request to Python ML service (${epochs} epochs, ${data_count} samples)...`);
    
    const response = await fetch(`${PYTHON_ML_URL}/train`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ epochs, lr, data_count }),
      signal: AbortSignal.timeout(120000), // 2 minute timeout for training
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✓ Model retrained: Urgency ${result.urgency_acc.toFixed(1)}%, Flags ${result.flags_acc.toFixed(1)}%`);
      io.emit('model-retrained', result);
      res.json({ success: true, ...result });
    } else {
      const errText = await response.text();
      throw new Error(`Python service returned ${response.status}: ${errText}`);
    }
  } catch (err) {
    console.error('Retrain failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ML Service health check
app.get('/api/ml-status', async (req, res) => {
  try {
    const response = await fetch(`${PYTHON_ML_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      res.json({ available: true, ...data });
    } else {
      res.json({ available: false, error: `HTTP ${response.status}` });
    }
  } catch (err) {
    res.json({ available: false, error: err.message });
  }
});

// Accept a trip & reserve bed
app.post('/api/trips/:id/accept', async (req, res) => {
  try {
    const tripId = req.params.id;
    const trip = await db.getTrip(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const hospitalId = trip.hospital_id;
    if (!hospitalId) {
      return res.status(400).json({ error: "No hospital assigned to this trip" });
    }

    const updatedTrip = await db.updateTripStatus(tripId, "accepted");
    const updatedHospital = await db.decrementHospitalBeds(hospitalId, 1);

    io.emit('trip-accepted', {
      trip_id: tripId,
      hospital_id: hospitalId,
      hospital: updatedHospital,
      status: "accepted",
      message: `ER confirmed admission. Bed reserved.`
    });

    io.emit('hospital-update', updatedHospital);

    res.json({ trip: updatedTrip, hospital: updatedHospital });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Redirect ambulance to secondary target
app.post('/api/trips/:id/redirect', async (req, res) => {
  try {
    const tripId = req.params.id;
    const trip = await db.getTrip(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const vitalsHistory = await db.getVitalsHistory(tripId);
    const latestVitals = vitalsHistory.length > 0
      ? vitalsHistory[vitalsHistory.length - 1]
      : { hr: 75, spo2: 98, systolic_bp: 120, temp: 36.6, resp_rate: 14, lat: 15.852, lng: 74.504 };

    const triage = await db.getTriageResult(tripId);
    const redFlags = triage ? triage.redFlags : [];
    const finalUrgency = triage ? triage.final_urgency || triage.urgency : "stable";

    const hospitals = await db.getHospitals();
    const matchResult = matchHospitals(latestVitals.lat || 15.852, latestVitals.lng || 74.504, redFlags, finalUrgency, hospitals);
    
    const secondaryHospital = (matchResult.options && matchResult.options.length > 1)
      ? matchResult.options[1]
      : null;

    if (!secondaryHospital) {
      return res.status(400).json({ error: "No secondary hospital matching criteria available" });
    }

    const updatedTrip = await db.updateTripDestination(tripId, secondaryHospital.id);

    io.emit('trip-redirected', {
      trip_id: tripId,
      hospital_id: secondaryHospital.id,
      hospital: secondaryHospital,
      message: `Ambulance redirected to ${secondaryHospital.name}. Route updated.`
    });

    res.json({ trip: updatedTrip, hospital: secondaryHospital });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all active and historical cases
app.post('/api/reset', async (req, res) => {
  try {
    await db.clearAllTrips();
    io.emit('system-reset');
    res.json({ success: true, message: "All cases cleared successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- SMTP DISPATCH EMAIL CLIENT (ZERO-DEPENDENCY RAW TLS) ---
function sendRawEmail({ host, port, user, pass, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const smtpPort = parseInt(port) || 465;
    const socket = tls.connect(smtpPort, host, { rejectUnauthorized: false }, () => {
      console.log(`Connected to SMTP host ${host}:${smtpPort}`);
    });

    let step = 0;
    let responseData = '';

    const send = (data) => {
      socket.write(data);
    };

    socket.on('data', (chunk) => {
      responseData += chunk.toString();
      const lines = responseData.split('\r\n');
      if (lines.length <= 1) return;

      const lastLine = lines[lines.length - 2];
      const code = lastLine.substring(0, 3);
      const separator = lastLine.charAt(3);
      if (separator === '-') return; // Keep buffering multi-line

      responseData = ''; // Clear for next phase

      if (step === 0) {
        if (code === '220') {
          send(`EHLO localhost\r\n`);
          step = 1;
        } else {
          reject(new Error("SMTP Handshake failed: " + lastLine));
          socket.end();
        }
      } else if (step === 1) {
        if (code === '250') {
          send(`AUTH LOGIN\r\n`);
          step = 2;
        } else {
          reject(new Error("SMTP EHLO failed: " + lastLine));
          socket.end();
        }
      } else if (step === 2) {
        if (code === '334') {
          send(Buffer.from(user).toString('base64') + '\r\n');
          step = 3;
        } else {
          reject(new Error("SMTP AUTH LOGIN failed: " + lastLine));
          socket.end();
        }
      } else if (step === 3) {
        if (code === '334') {
          send(Buffer.from(pass).toString('base64') + '\r\n');
          step = 4;
        } else {
          reject(new Error("SMTP User login failed: " + lastLine));
          socket.end();
        }
      } else if (step === 4) {
        if (code === '235') {
          send(`MAIL FROM:<${user}>\r\n`);
          step = 5;
        } else {
          reject(new Error("SMTP Auth failed: " + lastLine));
          socket.end();
        }
      } else if (step === 5) {
        if (code === '250') {
          send(`RCPT TO:<${to}>\r\n`);
          step = 6;
        } else {
          reject(new Error("SMTP MAIL FROM failed: " + lastLine));
          socket.end();
        }
      } else if (step === 6) {
        if (code === '250') {
          send(`RCPT TO:<${to}>\r\n`);
          send(`DATA\r\n`);
          step = 7;
        } else {
          reject(new Error("SMTP RCPT TO failed: " + lastLine));
          socket.end();
        }
      } else if (step === 7) {
        if (code === '354') {
          const headers = [
            `From: ${user}`,
            `To: ${to}`,
            `Subject: ${subject}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/html; charset=utf-8`,
            `Content-Transfer-Encoding: 7bit`,
            `Date: ${new Date().toUTCString()}`,
            `Message-ID: <${Date.now()}@medisyncai.local>`,
            '',
            html,
            '.'
          ].join('\r\n') + '\r\n';
          send(headers);
          step = 8;
        } else {
          reject(new Error("SMTP DATA initialization failed: " + lastLine));
          socket.end();
        }
      } else if (step === 8) {
        if (code === '250') {
          send(`QUIT\r\n`);
          step = 9;
          resolve({ success: true });
        } else {
          reject(new Error("SMTP sending body failed: " + lastLine));
          socket.end();
        }
      }
    });

    socket.on('error', (err) => {
      reject(err);
    });
  });
}

function saveEnvConfig(updates) {
  let envContent = '';
  if (fs.existsSync('.env')) {
    envContent = fs.readFileSync('.env', 'utf8');
  }

  const lines = envContent.split('\n');
  const newLines = [];
  const appliedKeys = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      newLines.push(line);
      continue;
    }
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.substring(0, idx).trim();
      if (updates[key] !== undefined) {
        newLines.push(`${key}=${updates[key]}`);
        appliedKeys.add(key);
        process.env[key] = updates[key];
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  // Append new keys
  for (const key of Object.keys(updates)) {
    if (!appliedKeys.has(key)) {
      newLines.push(`${key}=${updates[key]}`);
      process.env[key] = updates[key];
    }
  }

  fs.writeFileSync('.env', newLines.join('\n'), 'utf8');
}

// Get SMTP Credentials settings
app.get('/api/settings', (req, res) => {
  res.json({
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: process.env.SMTP_PORT || '465',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    testEmail: process.env.TEST_EMAIL || ''
  });
});

// Update & Hot-Reload SMTP settings
app.post('/api/settings', (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUser, smtpPass, testEmail } = req.body;
    saveEnvConfig({
      SMTP_HOST: smtpHost,
      SMTP_PORT: smtpPort,
      SMTP_USER: smtpUser,
      SMTP_PASS: smtpPass,
      TEST_EMAIL: testEmail
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Test Email
app.post('/api/settings/test', async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUser, smtpPass, testEmail } = req.body;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e11d48; padding: 20px; border-radius: 8px; background-color: #09090b; color: #f4f4f5;">
        <h2 style="color: #e11d48; border-bottom: 2px solid #e11d48; padding-bottom: 10px; margin-top: 0;">MediSyncAI Test Dispatch Relay</h2>
        <p>This is a test notification confirming that the SMTP relay configuration for Gmail App Passwords is valid.</p>
        <p style="font-size: 0.85em; color: #a1a1aa; background-color: #18181b; padding: 10px; border-radius: 4px; border: 1px solid #27272a;">
          <strong>Status:</strong> Active & Hot-Reloaded<br/>
          <strong>Timestamp:</strong> ${new Date().toISOString()}<br/>
          <strong>Security:</strong> SSL/TLS Authentication
        </p>
      </div>
    `;

    await sendRawEmail({
      host: smtpHost,
      port: smtpPort,
      user: smtpUser,
      pass: smtpPass,
      to: testEmail,
      subject: "TEST ALERT: MediSyncAI SMTP Relay Verification",
      html: htmlBody
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Test email relay failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Patient SOS API trigger
app.post('/api/sos/trigger', async (req, res) => {
  try {
    const { coords, contacts } = req.body;
    
    // Broadcast SOS alert via Socket.io
    io.emit('sos-alert', { coords, contacts, timestamp: new Date() });

    // Send emails if SMTP is configured
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = process.env.SMTP_PORT || '465';

    if (user && pass && contacts && contacts.length > 0) {
      const mapsLink = coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : '';
      
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; border: 2px solid #ef4444; padding: 24px; border-radius: 8px; background-color: #09090b; color: #f4f4f5;">
          <div style="background-color: #ef4444; color: white; padding: 10px 16px; border-radius: 4px; font-weight: bold; text-align: center; font-size: 1.2em;">
            ⚠️ EMERGENCY MEDICAL SOS ALERT ⚠️
          </div>
          <p style="margin-top: 20px; font-size: 1.1em;">An emergency medical SOS broadcast was triggered by a patient.</p>
          
          <div style="margin: 20px 0; padding: 16px; background-color: #18181b; border: 1px solid #27272a; border-radius: 6px;">
            <strong style="color: #ef4444;">Last Known Location:</strong><br/>
            ${coords ? `Coordinates: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}<br/>` : 'Location Unavailable'}
            ${mapsLink ? `<a href="${mapsLink}" style="display: inline-block; margin-top: 12px; padding: 8px 16px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">View on Google Maps</a>` : ''}
          </div>

          <p style="font-size: 0.85em; color: #a1a1aa; border-top: 1px solid #27272a; padding-top: 12px; margin-top: 20px;">
            This alert was automatically dispatched via MediSyncAI Telemetry System.
          </p>
        </div>
      `;

      // Distribute to all email addresses in contacts
      const emailPromises = contacts
        .map(c => c.email)
        .filter(Boolean)
        .map(email => {
          return sendRawEmail({
            host,
            port,
            user,
            pass,
            to: email,
            subject: "🚨 EMERGENCY SOS: Patient Location Alert",
            html: emailHtml
          }).catch(err => {
            console.error(`Failed to send SOS email to ${email}:`, err.message);
          });
        });

      await Promise.all(emailPromises);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- REAL-TIME WEBSOCKET SYNC ---

// Cache to prevent calling LLM API on every single vital broadcast if notes haven't changed.
// Key: trip_id, Value: { lastNotes: string, parsedNLP: { redFlags: Array, summary: String } }
const nlpCache = new Map();

io.on('connection', (socket) => {
  console.log(`Socket Client Connected: ${socket.id}`);

  // Client subscribes to a specific ambulance
  socket.on('join-ambulance', (ambulanceId) => {
    socket.join(`ambulance:${ambulanceId}`);
    console.log(`Socket ${socket.id} joined room: ambulance:${ambulanceId}`);
  });

  // Client subscribes to the hospital dashboard
  socket.on('join-hospital', () => {
    socket.join('hospital-dashboard');
    console.log(`Socket ${socket.id} joined room: hospital-dashboard`);
  });

  // Ambulance streaming vitals, notes, and coordinates
  socket.on('ambulance-stream', async (data) => {
    const { trip_id, ambulance_id, vitals, crewNotes, location, speed, heading } = data;
    
    if (!trip_id || !ambulance_id) return;

    try {
      // 1. Log vitals to history
      await db.addVitalsLog(
        trip_id,
        vitals.hr,
        vitals.spo2,
        vitals.systolicBP || vitals.systolic_bp,
        vitals.temp,
        vitals.respRate || vitals.resp_rate,
        location.lat,
        location.lng
      );

      // Cache patient details (age/name) to avoid querying DB on every WebSocket tick
      let tripInfo = nlpCache.get(`tripInfo:${trip_id}`);
      if (!tripInfo) {
        const trip = await db.getTrip(trip_id);
        if (trip) {
          tripInfo = { patient_age: trip.patient_age, patient_name: trip.patient_name };
          nlpCache.set(`tripInfo:${trip_id}`, tripInfo);
        }
      }
      const patientAge = tripInfo?.patient_age || 45;
      const patientName = tripInfo?.patient_name || 'Patient';

      // Run end-to-end neural triage evaluation
      const triageResult = await evaluateNeuralTriage(vitals, crewNotes, patientAge, patientName);

      // Hospital Matching & Rerouting
      const hospitals = await db.getHospitals();
      const matchResult = matchHospitals(location.lat, location.lng, triageResult.redFlags, triageResult.urgency, hospitals);
      const recommendedHospitalId = matchResult.recommended ? matchResult.recommended.id : null;

      // Save update in DB
      await db.updateTripTriage(
        trip_id,
        triageResult.vitalsUrgency,
        triageResult.redFlags,
        triageResult.escalatedByFlags,
        triageResult.summary,
        triageResult.vitalsScore,
        triageResult.urgency,
        recommendedHospitalId,
        triageResult.confidence,
        triageResult.modelType
      );

      // Update Ambulance Location
      const updatedAmbulance = await db.updateAmbulanceLocation(
        ambulance_id,
        location.lat,
        location.lng,
        'enroute',
        speed || 0,
        heading || 0,
        trip_id
      );

      // Prepare broadcast package
      const broadcastData = {
        trip_id,
        ambulance_id,
        callsign: updatedAmbulance?.callsign || 'Ambulance',
        vitals: {
          ...vitals,
          news2Score: triageResult.vitalsScore
        },
        location,
        speed: speed || 0,
        heading: heading || 0,
        triage: {
          urgency: triageResult.urgency,
          vitalsUrgency: triageResult.vitalsUrgency,
          vitalsScore: triageResult.vitalsScore,
          redFlags: triageResult.redFlags,
          escalatedByFlags: triageResult.escalatedByFlags,
          summary: triageResult.summary,
          confidence: triageResult.confidence,
          modelType: triageResult.modelType
        },
        hospitalMatch: matchResult
      };

      // Broadcast to specific ambulance room and the hospital dashboard
      io.to(`ambulance:${ambulance_id}`).emit('stream-update', broadcastData);
      io.to('hospital-dashboard').emit('ambulance-live-update', broadcastData);
    } catch (err) {
      console.error("Error processing ambulance stream update:", err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket Client Disconnected: ${socket.id}`);
  });
});

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.resolve();
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`Connected Ambulance Server listening on port ${PORT}`);
  console.log(`Serving WebSockets and Express endpoints`);
  console.log(`=================================================`);
});

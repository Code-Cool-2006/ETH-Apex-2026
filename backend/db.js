import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.resolve(__dirname, 'db.json');

const SEED_DATA = {
  hospitals: [
    {
      id: "hosp-1",
      name: "Belagavi Trauma & Emergency Center",
      lat: 15.8620,
      lng: 74.5085,
      has_trauma: true,
      has_cardiac: false,
      icu_beds: 5,
      total_beds: 120,
      description: "Level 1 Trauma center optimized for severe accidents, external hemorrhage, and orthopedic stabilization."
    },
    {
      id: "hosp-2",
      name: "Apex Cardiac Hospital",
      lat: 15.8428,
      lng: 74.4890,
      has_trauma: false,
      has_cardiac: true,
      icu_beds: 3,
      total_beds: 80,
      description: "Dedicated cardiac cath lab, stroke response capabilities, and emergency coronary bypass facilities."
    },
    {
      id: "hosp-3",
      name: "District Civil General Hospital",
      lat: 15.8565,
      lng: 74.5210,
      has_trauma: true,
      has_cardiac: true,
      icu_beds: 8,
      total_beds: 250,
      description: "Comprehensive public facility with multi-disciplinary emergency units, respiratory isolation wards, and general surgeries."
    },
    {
      id: "hosp-4",
      name: "KLE Prabhakar Kore Multi-Specialty Hospital",
      lat: 15.8828,
      lng: 74.5242,
      has_trauma: true,
      has_cardiac: true,
      icu_beds: 12,
      total_beds: 400,
      description: "State-of-the-art super-specialty hospital equipped with helipads, advanced neurological care, and maximum ICU capacity."
    },
    {
      id: "hosp-5",
      name: "Lakeview Medical Center",
      lat: 15.8310,
      lng: 74.5160,
      has_trauma: false,
      has_cardiac: false,
      icu_beds: 2,
      total_beds: 60,
      description: "Community hospital specializing in respiratory medicine, acute asthma response, and outpatient care."
    }
  ],
  ambulances: [
    { id: "amb-1", callsign: "Medic-01 (Belagavi North)", status: "idle", lat: 15.8590, lng: 74.5020, speed: 0, heading: 0, current_trip_id: null },
    { id: "amb-2", callsign: "Medic-02 (Belagavi South)", status: "idle", lat: 15.8720, lng: 74.5150, speed: 0, heading: 0, current_trip_id: null },
    { id: "amb-3", callsign: "Medic-03 (Shahapur)", status: "idle", lat: 15.8450, lng: 74.4920, speed: 0, heading: 0, current_trip_id: null },
    { id: "amb-4", callsign: "Medic-04 (Tilakwadi)", status: "idle", lat: 15.8910, lng: 74.5320, speed: 0, heading: 0, current_trip_id: null },
    { id: "amb-5", callsign: "Medic-05 (Sambhaji Nagar)", status: "idle", lat: 15.8320, lng: 74.5110, speed: 0, heading: 0, current_trip_id: null }
  ],
  trips: [],
  vitals_logs: [],
  triage_results: []
};

// Helper to calculate NEWS2 score on the fly
function calculateLocalNEWS2(v) {
  let score = 0;
  const spo2 = Number(v.spo2);
  if (spo2 < 90) score += 3;
  else if (spo2 < 94) score += 1;
  const hr = Number(v.hr);
  if (hr > 130 || hr < 40) score += 2;
  else if (hr > 110 || hr < 50) score += 1;
  const sbp = Number(v.systolicBP || v.systolic_bp);
  if (sbp < 90) score += 3;
  else if (sbp < 100) score += 1;
  const temp = Number(v.temp);
  if (temp > 39.5 || temp < 35.0) score += 1;
  const rr = Number(v.respRate || v.resp_rate);
  if (rr > 24 || rr < 9) score += 3;
  else if (rr > 20) score += 1;
  return score;
}

class DBManager {
  constructor() {
    this.isPostgres = !!process.env.DATABASE_URL;
    this.pgPool = null;
    this.localData = null;

    if (this.isPostgres) {
      console.log("Database Mode: PostgreSQL (Production)");
      this.pgPool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
    } else {
      this.writeQueue = Promise.resolve();
      console.log("Database Mode: JSON Local File (Development/Fallback)");
      this.loadLocalDB();
    }
  }

  loadLocalDB() {
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        this.localData = JSON.parse(raw);
        console.log("✓ Loaded local JSON database.");
      } catch (err) {
        console.error("Failed to read JSON DB, resetting to seed:", err.message);
        this.resetLocalDB();
      }
    } else {
      this.resetLocalDB();
    }
  }

  resetLocalDB() {
    this.localData = JSON.parse(JSON.stringify(SEED_DATA));
    this.saveLocalDB();
    console.log("✓ Reset local JSON database with seed data.");
  }

  saveLocalDB() {
    if (this.isPostgres) return Promise.resolve();
    this.writeQueue = this.writeQueue.then(() => {
      return new Promise((resolve) => {
        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(this.localData, null, 2), 'utf8');
        } catch (err) {
          console.error("Error saving local JSON database:", err.message);
        }
        resolve();
      });
    });
    return this.writeQueue;
  }

  async init() {
    if (!this.isPostgres) return;

    // Database Initialization
    const queries = [
      `CREATE TABLE IF NOT EXISTS hospitals (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        has_trauma BOOLEAN DEFAULT false,
        has_cardiac BOOLEAN DEFAULT false,
        icu_beds INTEGER NOT NULL,
        total_beds INTEGER NOT NULL,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS ambulances (
        id VARCHAR(50) PRIMARY KEY,
        callsign VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        speed DOUBLE PRECISION DEFAULT 0,
        heading DOUBLE PRECISION DEFAULT 0,
        current_trip_id VARCHAR(50),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS trips (
        id VARCHAR(50) PRIMARY KEY,
        ambulance_id VARCHAR(50) REFERENCES ambulances(id),
        hospital_id VARCHAR(50) REFERENCES hospitals(id),
        patient_name VARCHAR(100) NOT NULL,
        patient_age INTEGER NOT NULL,
        symptoms TEXT,
        news2_score INTEGER DEFAULT 0,
        urgency VARCHAR(50) DEFAULT 'stable',
        live_status VARCHAR(50) DEFAULT 'enroute', -- 'enroute', 'completed', 'cancelled'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS vitals_logs (
        id SERIAL PRIMARY KEY,
        trip_id VARCHAR(50) REFERENCES trips(id) ON DELETE CASCADE,
        hr INTEGER NOT NULL,
        spo2 INTEGER NOT NULL,
        systolic_bp INTEGER NOT NULL,
        temp DOUBLE PRECISION NOT NULL,
        resp_rate INTEGER NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lng DOUBLE PRECISION NOT NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS triage_results (
        id SERIAL PRIMARY KEY,
        trip_id VARCHAR(50) REFERENCES trips(id) ON DELETE CASCADE,
        vitals_urgency VARCHAR(50) NOT NULL,
        red_flags TEXT[] NOT NULL,
        escalated_by_flags BOOLEAN NOT NULL,
        summary TEXT NOT NULL,
        raw_news2_score INTEGER NOT NULL,
        final_urgency VARCHAR(50) NOT NULL,
        confidence_stable DOUBLE PRECISION DEFAULT 0,
        confidence_urgent DOUBLE PRECISION DEFAULT 0,
        confidence_critical DOUBLE PRECISION DEFAULT 0,
        model_type VARCHAR(100) DEFAULT 'Rule-Based',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const query of queries) {
      await this.pgPool.query(query);
    }

    // Ensure all required columns exist in triage_results for older schemas
    const alterQueries = [
      "ALTER TABLE triage_results ADD COLUMN IF NOT EXISTS confidence_stable DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE triage_results ADD COLUMN IF NOT EXISTS confidence_urgent DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE triage_results ADD COLUMN IF NOT EXISTS confidence_critical DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE triage_results ADD COLUMN IF NOT EXISTS model_type VARCHAR(100) DEFAULT 'Rule-Based'"
    ];
    for (const aq of alterQueries) {
      try {
        await this.pgPool.query(aq);
      } catch (e) {
        console.warn("Could not execute column migration on Postgres, they may already exist:", e.message);
      }
    }

    // Seed if empty
    const checkHospitals = await this.pgPool.query("SELECT COUNT(*) FROM hospitals");
    if (parseInt(checkHospitals.rows[0].count) === 0) {
      console.log("Seeding Postgres database...");
      for (const h of SEED_DATA.hospitals) {
        await this.pgPool.query(
          "INSERT INTO hospitals (id, name, lat, lng, has_trauma, has_cardiac, icu_beds, total_beds, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [h.id, h.name, h.lat, h.lng, h.has_trauma, h.has_cardiac, h.icu_beds, h.total_beds, h.description]
        );
      }
      for (const a of SEED_DATA.ambulances) {
        await this.pgPool.query(
          "INSERT INTO ambulances (id, callsign, status, lat, lng, speed, heading) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [a.id, a.callsign, a.status, a.lat, a.lng, a.speed, a.heading]
        );
      }
    }
  }

  // --- QUERY METHODS ---

  async getAmbulances() {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM ambulances");
      return res.rows;
    } else {
      return this.localData.ambulances;
    }
  }

  async getAmbulance(id) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM ambulances WHERE id = $1", [id]);
      return res.rows[0] || null;
    } else {
      return this.localData.ambulances.find(a => a.id === id) || null;
    }
  }

  async updateAmbulanceLocation(id, lat, lng, status = null, speed = 0, heading = 0, currentTripId = undefined) {
    if (this.isPostgres) {
      let query = "UPDATE ambulances SET lat = $1, lng = $2, speed = $3, heading = $4";
      const params = [lat, lng, speed, heading];
      let index = 5;

      if (status !== null) {
        query += `, status = $${index}`;
        params.push(status);
        index++;
      }
      if (currentTripId !== undefined) {
        query += `, current_trip_id = $${index}`;
        params.push(currentTripId);
        index++;
      }
      query += ` WHERE id = $${index} RETURNING *`;
      params.push(id);

      const res = await this.pgPool.query(query, params);
      return res.rows[0];
    } else {
      const amb = this.localData.ambulances.find(a => a.id === id);
      if (amb) {
        amb.lat = lat;
        amb.lng = lng;
        amb.speed = speed;
        amb.heading = heading;
        if (status !== null) amb.status = status;
        if (currentTripId !== undefined) amb.current_trip_id = currentTripId;
        this.saveLocalDB();
      }
      return amb;
    }
  }

  async getHospitals() {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM hospitals");
      return res.rows;
    } else {
      return this.localData.hospitals;
    }
  }

  async getHospital(id) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM hospitals WHERE id = $1", [id]);
      return res.rows[0] || null;
    } else {
      return this.localData.hospitals.find(h => h.id === id) || null;
    }
  }

  async updateHospitalBeds(id, icu_beds) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("UPDATE hospitals SET icu_beds = $1 WHERE id = $2 RETURNING *", [icu_beds, id]);
      return res.rows[0];
    } else {
      const hosp = this.localData.hospitals.find(h => h.id === id);
      if (hosp) {
        hosp.icu_beds = Math.max(0, icu_beds);
        this.saveLocalDB();
      }
      return hosp;
    }
  }

  async getTrips() {
    if (this.isPostgres) {
      const res = await this.pgPool.query(`
        SELECT t.*, a.callsign as ambulance_callsign, h.name as hospital_name 
        FROM trips t
        JOIN ambulances a ON t.ambulance_id = a.id
        LEFT JOIN hospitals h ON t.hospital_id = h.id
        ORDER BY t.created_at DESC
      `);
      return res.rows;
    } else {
      return this.localData.trips.map(t => {
        const a = this.localData.ambulances.find(amb => amb.id === t.ambulance_id);
        const h = this.localData.hospitals.find(hosp => hosp.id === t.hospital_id);
        return {
          ...t,
          ambulance_callsign: a ? a.callsign : 'Unknown',
          hospital_name: h ? h.name : 'Unassigned'
        };
      }).sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
    }
  }

  async getTrip(id) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("SELECT * FROM trips WHERE id = $1", [id]);
      return res.rows[0] || null;
    } else {
      return this.localData.trips.find(t => t.id === id) || null;
    }
  }

  async createTrip(id, ambulanceId, hospitalId, patientName, patientAge, symptoms) {
    const created_at = new Date().toISOString();
    if (this.isPostgres) {
      const res = await this.pgPool.query(
        "INSERT INTO trips (id, ambulance_id, hospital_id, patient_name, patient_age, symptoms, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
        [id, ambulanceId, hospitalId, patientName, patientAge, symptoms, created_at]
      );
      // Update ambulance status & trip_id
      await this.updateAmbulanceLocation(ambulanceId, 0, 0, "enroute", 0, 0, id);
      return res.rows[0];
    } else {
      const newTrip = {
        id,
        ambulance_id: ambulanceId,
        hospital_id: hospitalId,
        patient_name: patientName,
        patient_age: Number(patientAge),
        symptoms,
        news2_score: 0,
        urgency: 'stable',
        live_status: 'enroute',
        created_at
      };
      this.localData.trips.push(newTrip);
      
      // Update ambulance
      const amb = this.localData.ambulances.find(a => a.id === ambulanceId);
      if (amb) {
        amb.status = 'enroute';
        amb.current_trip_id = id;
      }
      
      this.saveLocalDB();
      return newTrip;
    }
  }

  async updateTripTriage(tripId, vitalsUrgency, redFlags, escalatedByFlags, summary, rawNews2Score, finalUrgency, hospitalId = null, confidence = null, modelType = null) {
    if (this.isPostgres) {
      let query = "UPDATE trips SET news2_score = $1, urgency = $2";
      const params = [rawNews2Score, finalUrgency];
      let index = 3;
      if (hospitalId) {
        query += `, hospital_id = $${index}`;
        params.push(hospitalId);
        index++;
      }
      query += ` WHERE id = $${index} RETURNING *`;
      params.push(tripId);
      await this.pgPool.query(query, params);

      // Save triage results details
      const confStable = confidence ? (confidence.stable || 0) : 0;
      const confUrgent = confidence ? (confidence.urgent || 0) : 0;
      const confCritical = confidence ? (confidence.critical || 0) : 0;
      const mType = modelType || 'Rule-Based';

      await this.pgPool.query(
        "INSERT INTO triage_results (trip_id, vitals_urgency, red_flags, escalated_by_flags, summary, raw_news2_score, final_urgency, confidence_stable, confidence_urgent, confidence_critical, model_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        [tripId, vitalsUrgency, redFlags, escalatedByFlags, summary, rawNews2Score, finalUrgency, confStable, confUrgent, confCritical, mType]
      );
      
      // Get updated trip details
      const res = await this.pgPool.query("SELECT * FROM trips WHERE id = $1", [tripId]);
      return res.rows[0];
    } else {
      const trip = this.localData.trips.find(t => t.id === tripId);
      if (trip) {
        trip.news2_score = rawNews2Score;
        trip.urgency = finalUrgency;
        if (hospitalId) {
          trip.hospital_id = hospitalId;
        }

        // Remove old triage details if exist, then insert new
        this.localData.triage_results = this.localData.triage_results.filter(tr => tr.trip_id !== tripId);
        this.localData.triage_results.push({
          id: 'triage-' + Date.now(),
          trip_id: tripId,
          vitals_urgency: vitalsUrgency,
          red_flags: redFlags,
          escalated_by_flags: escalatedByFlags,
          summary,
          raw_news2_score: rawNews2Score,
          final_urgency: finalUrgency,
          confidence: confidence || { stable: 0, urgent: 0, critical: 0 },
          model_type: modelType || 'Rule-Based',
          updated_at: new Date().toISOString()
        });

        this.saveLocalDB();
      }
      return trip;
    }
  }

  async completeTrip(tripId, ambulanceId, hospitalId) {
    if (this.isPostgres) {
      await this.pgPool.query("UPDATE trips SET live_status = 'completed' WHERE id = $1", [tripId]);
      await this.updateAmbulanceLocation(ambulanceId, 0, 0, "idle", 0, 0, null);
      if (hospitalId) {
        // decrement ICU bed capacity if patient was admitted to ICU (if hospital has beds, just decrement one)
        const hosp = await this.getHospital(hospitalId);
        if (hosp && hosp.icu_beds > 0) {
          await this.updateHospitalBeds(hospitalId, hosp.icu_beds - 1);
        }
      }
    } else {
      const trip = this.localData.trips.find(t => t.id === tripId);
      if (trip) {
        trip.live_status = 'completed';
      }
      const amb = this.localData.ambulances.find(a => a.id === ambulanceId);
      if (amb) {
        amb.status = 'idle';
        amb.current_trip_id = null;
      }
      if (hospitalId) {
        const hosp = this.localData.hospitals.find(h => h.id === hospitalId);
        if (hosp && hosp.icu_beds > 0) {
          hosp.icu_beds = hosp.icu_beds - 1;
        }
      }
      this.saveLocalDB();
    }
  }

  async addVitalsLog(tripId, hr, spo2, systolic_bp, temp, resp_rate, lat, lng) {
    const recorded_at = new Date().toISOString();
    if (this.isPostgres) {
      const res = await this.pgPool.query(
        "INSERT INTO vitals_logs (trip_id, hr, spo2, systolic_bp, temp, resp_rate, lat, lng, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
        [tripId, hr, spo2, systolic_bp, temp, resp_rate, lat, lng, recorded_at]
      );
      return res.rows[0];
    } else {
      const newLog = {
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        trip_id: tripId,
        hr: Number(hr),
        spo2: Number(spo2),
        systolic_bp: Number(systolic_bp),
        temp: Number(temp),
        resp_rate: Number(resp_rate),
        lat: Number(lat),
        lng: Number(lng),
        recorded_at
      };
      this.localData.vitals_logs.push(newLog);
      this.saveLocalDB();
      return newLog;
    }
  }

  async getVitalsHistory(tripId) {
    if (this.isPostgres) {
      const res = await this.pgPool.query(
        "SELECT * FROM vitals_logs WHERE trip_id = $1 ORDER BY recorded_at ASC",
        [tripId]
      );
      return res.rows;
    } else {
      return this.localData.vitals_logs
        .filter(vl => vl.trip_id === tripId)
        .sort((x, y) => new Date(x.recorded_at) - new Date(y.recorded_at));
    }
  }

  async getTriageResult(tripId) {
    if (this.isPostgres) {
      const res = await this.pgPool.query(
        "SELECT * FROM triage_results WHERE trip_id = $1 ORDER BY updated_at DESC LIMIT 1",
        [tripId]
      );
      if (res.rows[0]) {
        const r = res.rows[0];
        return {
          ...r,
          redFlags: r.red_flags,
          vitalsScore: r.raw_news2_score,
          vitalsUrgency: r.vitals_urgency,
          escalatedByFlags: r.escalated_by_flags,
          confidence: {
            stable: r.confidence_stable || 0,
            urgent: r.confidence_urgent || 0,
            critical: r.confidence_critical || 0
          },
          modelType: r.model_type || 'Rule-Based'
        };
      }
      return null;
    } else {
      const tr = this.localData.triage_results.find(tr => tr.trip_id === tripId) || null;
      if (tr) {
        return {
          ...tr,
          redFlags: tr.red_flags,
          vitalsScore: tr.raw_news2_score,
          vitalsUrgency: tr.vitals_urgency,
          escalatedByFlags: tr.escalated_by_flags,
          confidence: tr.confidence || { stable: 0, urgent: 0, critical: 0 },
          modelType: tr.model_type || 'Rule-Based'
        };
      }
      return null;
    }
  }

  async clearAllTrips() {
    if (this.isPostgres) {
      await this.pgPool.query("DELETE FROM triage_results");
      await this.pgPool.query("DELETE FROM vitals_logs");
      await this.pgPool.query("DELETE FROM trips");
      
      // Seed ambulances back to default idle positions
      const defaultAmbs = [
        { id: "amb-1", lat: 15.8590, lng: 74.5020 },
        { id: "amb-2", lat: 15.8720, lng: 74.5150 },
        { id: "amb-3", lat: 15.8450, lng: 74.4920 },
        { id: "amb-4", lat: 15.8910, lng: 74.5320 },
        { id: "amb-5", lat: 15.8320, lng: 74.5110 }
      ];

      for (const a of defaultAmbs) {
        await this.pgPool.query(
          "UPDATE ambulances SET status = 'idle', current_trip_id = null, lat = $1, lng = $2, speed = 0, heading = 0 WHERE id = $3",
          [a.lat, a.lng, a.id]
        );
      }
    } else {
      this.localData.trips = [];
      this.localData.vitals_logs = [];
      this.localData.triage_results = [];
      
      // Reset ambulances positions and idle status
      const defaultAmbs = {
        "amb-1": { lat: 15.8590, lng: 74.5020 },
        "amb-2": { lat: 15.8720, lng: 74.5150 },
        "amb-3": { lat: 15.8450, lng: 74.4920 },
        "amb-4": { lat: 15.8910, lng: 74.5320 },
        "amb-5": { lat: 15.8320, lng: 74.5110 }
      };

      this.localData.ambulances.forEach(a => {
        a.status = 'idle';
        a.current_trip_id = null;
        a.speed = 0;
        a.heading = 0;
        if (defaultAmbs[a.id]) {
          a.lat = defaultAmbs[a.id].lat;
          a.lng = defaultAmbs[a.id].lng;
        }
      });
      
      this.saveLocalDB();
    }
  }

  async updateTripStatus(tripId, status) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("UPDATE trips SET live_status = $1 WHERE id = $2 RETURNING *", [status, tripId]);
      return res.rows[0];
    } else {
      const trip = this.localData.trips.find(t => t.id === tripId);
      if (trip) {
        trip.live_status = status;
        this.saveLocalDB();
      }
      return trip;
    }
  }

  async decrementHospitalBeds(hospitalId, amount = 1) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("UPDATE hospitals SET icu_beds = GREATEST(icu_beds - $1, 0) WHERE id = $2 RETURNING *", [amount, hospitalId]);
      return res.rows[0];
    } else {
      const hosp = this.localData.hospitals.find(h => h.id === hospitalId);
      if (hosp) {
        hosp.icu_beds = Math.max(0, hosp.icu_beds - amount);
        this.saveLocalDB();
      }
      return hosp;
    }
  }

  async updateTripDestination(tripId, hospitalId) {
    if (this.isPostgres) {
      const res = await this.pgPool.query("UPDATE trips SET hospital_id = $1 WHERE id = $2 RETURNING *", [hospitalId, tripId]);
      return res.rows[0];
    } else {
      const trip = this.localData.trips.find(t => t.id === tripId);
      if (trip) {
        trip.hospital_id = hospitalId;
        this.saveLocalDB();
      }
      return trip;
    }
  }
}

export default new DBManager();

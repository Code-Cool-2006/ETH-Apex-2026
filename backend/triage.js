import fs from 'fs';
import path from 'path';

// ─── Constants (kept locally for rule-based fallback) ────────────────────────

const RED_FLAGS_LIST = ["unconscious", "not breathing", "severe bleeding", "chest pain", "stroke symptoms"];
const OVERRIDE_FLAGS = ["unconscious", "not breathing", "severe bleeding", "chest pain", "stroke symptoms"];
const URGENCY_RANK = { stable: 0, urgent: 1, critical: 2 };

// ─── Python ML Service Configuration ─────────────────────────────────────────

const PYTHON_ML_URL = process.env.PYTHON_ML_URL || 'http://localhost:8000';
let pythonServiceAvailable = false;

// Health-check the Python service on startup
async function checkPythonService() {
  try {
    const res = await fetch(`${PYTHON_ML_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      pythonServiceAvailable = true;
      console.log(`✓ Python ML Service connected at ${PYTHON_ML_URL} (model_loaded: ${data.model_loaded})`);
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    pythonServiceAvailable = false;
    console.warn(`⚠ Python ML Service not reachable at ${PYTHON_ML_URL}: ${err.message}`);
    console.warn('  Falling back to rule-based triage. Start the Python service with:');
    console.warn('  cd ml_service && pip install -r requirements.txt && python server.py');
  }
}

// Auto-check on import
checkPythonService();

// Re-check periodically (every 30 seconds) if not available
setInterval(async () => {
  if (!pythonServiceAvailable) {
    await checkPythonService();
  }
}, 30000);

// ─── 1. Vitals Scoring Engine (NEWS2-style) ─────────────────────────────────

export function scoreVitals(v) {
  let score = 0;
  
  // SpO2
  const spo2 = Number(v.spo2);
  if (spo2 < 90) score += 3;
  else if (spo2 < 94) score += 1;
  
  // Heart Rate
  const hr = Number(v.hr);
  if (hr > 130 || hr < 40) score += 2;
  else if (hr > 110 || hr < 50) score += 1;
  
  // Systolic BP
  const sbp = Number(v.systolicBP || v.systolic_bp);
  if (sbp < 90) score += 3;
  else if (sbp < 100) score += 1;
  
  // Temperature
  const temp = Number(v.temp);
  if (temp > 39.5 || temp < 35.0) score += 1;
  
  // Respiratory Rate
  const rr = Number(v.respRate || v.resp_rate);
  if (rr > 24 || rr < 9) score += 3;
  else if (rr > 20) score += 1;

  let urgency = "stable";
  if (score >= 5) urgency = "critical";
  else if (score >= 2) urgency = "urgent";

  return {
    score,
    urgency
  };
}

// ─── 2. Symptom NLP Engine (Claude API with local keyword regex fallback) ───

export async function extractRedFlags(crewNotes, patientAge, patientName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (apiKey) {
    try {
      console.log("Calling Anthropic Claude API for NLP extraction...");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 300,
          system: "You are a clinical assistant. Extract red-flag symptoms (strictly choose from this list: 'unconscious', 'not breathing', 'severe bleeding', 'chest pain', 'stroke symptoms') and write a one-sentence medical handoff summary. Respond ONLY with JSON format: {\"red_flags\": string[], \"summary\": string}. Do not write any other explanation or text.",
          messages: [{ role: "user", content: `Medic Notes: "${crewNotes}". Patient: ${patientName || 'Unknown'}, Age: ${patientAge || 'Unknown'}` }]
        }),
        timeout: 5000 // 5 seconds timeout
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.content[0].text;
        const result = JSON.parse(jsonText);
        return {
          redFlags: result.red_flags || [],
          summary: result.summary || `Patient presenting with symptoms: ${crewNotes}`
        };
      } else {
        throw new Error(`Claude API returned status ${response.status}`);
      }
    } catch (err) {
      console.warn("Claude API failed or timed out. Falling back to local rules.", err.message);
    }
  }

  // Local Rule-Based NLP Parser Fallback
  console.log("Using Local Rule-Based NLP Parser Fallback.");
  const notesLower = (crewNotes || "").toLowerCase();
  const redFlags = [];

  if (notesLower.includes("unconscious") || notesLower.includes("passed out") || notesLower.includes("fainted") || notesLower.includes("unresponsive")) {
    redFlags.push("unconscious");
  }
  if (notesLower.includes("breathing") && (notesLower.includes("not") || notesLower.includes("stop") || notesLower.includes("struggling") || notesLower.includes("apnea") || notesLower.includes("arrest"))) {
    redFlags.push("not breathing");
  }
  if (notesLower.includes("bleeding") && (notesLower.includes("severe") || notesLower.includes("heavy") || notesLower.includes("hemorrhage") || notesLower.includes("arterial") || notesLower.includes("profuse"))) {
    redFlags.push("severe bleeding");
  }
  if (notesLower.includes("chest pain") || notesLower.includes("cardiac") || notesLower.includes("heart attack") || notesLower.includes("pressure in chest")) {
    redFlags.push("chest pain");
  }
  if (notesLower.includes("stroke") || notesLower.includes("slurred") || notesLower.includes("numbness") || notesLower.includes("weakness") || notesLower.includes("facial droop") || notesLower.includes("drooping")) {
    redFlags.push("stroke symptoms");
  }

  // Clean notes for summary
  const summaryText = crewNotes
    ? `${patientName || 'Patient'} (${patientAge || 'unknown age'}yo) shows: ${crewNotes.substring(0, 80)}${crewNotes.length > 80 ? '...' : ''}`
    : `Enroute patient, details pending.`;

  return {
    redFlags,
    summary: summaryText
  };
}

// ─── 3. Fusion & Decision Layer (deterministic escalate-only) ────────────────

export function fuseTriage(vitalsUrgency, redFlags) {
  let urgency = vitalsUrgency;

  const hasOverride = redFlags.some(f => OVERRIDE_FLAGS.includes(f));
  if (hasOverride && URGENCY_RANK[urgency] < URGENCY_RANK["critical"]) {
    urgency = "critical";
  } else if (redFlags.length > 0 && URGENCY_RANK[urgency] < URGENCY_RANK["urgent"]) {
    urgency = "urgent";
  }

  return {
    urgency,
    vitalsUrgency,
    redFlags,
    escalatedByFlags: urgency !== vitalsUrgency,
  };
}

// ─── 4. End-to-End Neural Network Triage Evaluator ──────────────────────────

export async function evaluateNeuralTriage(vitals, crewNotes, patientAge, patientName) {
  // Compute deterministic NEWS2 vitals baseline for tracking
  const vitalsTriage = scoreVitals(vitals);

  // ── Try Python ML service first ──
  if (pythonServiceAvailable) {
    try {
      console.log("Calling Python ML Service for triage inference...");
      const response = await fetch(`${PYTHON_ML_URL}/predict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vitals: {
            hr: Number(vitals.hr || vitals.heartRate || 75),
            spo2: Number(vitals.spo2 || 98),
            systolicBP: Number(vitals.systolicBP || vitals.systolic_bp || 120),
            temp: Number(vitals.temp || vitals.temperature || 36.6),
            respRate: Number(vitals.respRate || vitals.resp_rate || 14),
          },
          symptoms: crewNotes || "",
          age: Number(patientAge) || 45,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const pred = await response.json();
        const urgencyProbs = pred.urgency_probs;
        const redFlagsProbs = pred.red_flags_probs;

        // Classify Urgency
        const urgencyClasses = ["stable", "urgent", "critical"];
        const predUrgencyIdx = urgencyProbs.indexOf(Math.max(...urgencyProbs));
        const predictedUrgency = urgencyClasses[predUrgencyIdx];

        // Classify Red Flags (threshold 0.5)
        const predictedRedFlags = [];
        for (let j = 0; j < RED_FLAGS_LIST.length; j++) {
          if (redFlagsProbs[j] >= 0.5) {
            predictedRedFlags.push(RED_FLAGS_LIST[j]);
          }
        }

        // Generate narrative summary
        let summary = "";
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          try {
            const sRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key": apiKey,
                "content-type": "application/json",
                "anthropic-version": "2023-06-01"
              },
              body: JSON.stringify({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 150,
                system: "You are a clinical assistant. Summarize the patient's symptoms into a clean, single-sentence medical handoff narrative. Do not mention diagnosis or treatment.",
                messages: [{ role: "user", content: `Medic Notes: "${crewNotes}". Patient: ${patientName || 'Unknown'}, Age: ${patientAge || 'Unknown'}` }]
              }),
              signal: AbortSignal.timeout(3000),
            });
            if (sRes.ok) {
              const sData = await sRes.json();
              summary = sData.content[0].text.trim();
            }
          } catch (_) { /* fallback below */ }
        }

        if (!summary) {
          summary = crewNotes
            ? `${patientName || 'Patient'} (${patientAge || 'unknown age'}yo) shows: ${crewNotes.substring(0, 80)}${crewNotes.length > 80 ? '...' : ''}`
            : `Enroute patient, details pending.`;
        }

        console.log(`✓ Python ML inference complete → ${predictedUrgency} (confidence: ${(urgencyProbs[predUrgencyIdx] * 100).toFixed(1)}%)`);

        return {
          urgency: predictedUrgency,
          vitalsUrgency: vitalsTriage.urgency,
          vitalsScore: vitalsTriage.score,
          redFlags: predictedRedFlags,
          escalatedByFlags: predictedUrgency !== vitalsTriage.urgency,
          summary,
          confidence: {
            stable: urgencyProbs[0],
            urgent: urgencyProbs[1],
            critical: urgencyProbs[2]
          },
          modelType: "Python MLP Neural Net (NumPy/FastAPI)"
        };
      } else {
        throw new Error(`Python service returned HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn(`Python ML Service call failed: ${err.message}. Falling back to rules.`);
      pythonServiceAvailable = false;
      // Schedule a re-check
      setTimeout(() => checkPythonService(), 5000);
    }
  }

  // ── Fallback: rule-based triage ──
  console.warn("Using rule-based fallback triage (Python ML Service unavailable).");
  const flagsResult = await extractRedFlags(crewNotes, patientAge, patientName);
  const fusion = fuseTriage(vitalsTriage.urgency, flagsResult.redFlags);

  return {
    urgency: fusion.urgency,
    vitalsUrgency: fusion.vitalsUrgency,
    vitalsScore: vitalsTriage.score,
    redFlags: fusion.redFlags,
    escalatedByFlags: fusion.escalatedByFlags,
    summary: flagsResult.summary,
    confidence: {
      stable: fusion.urgency === "stable" ? 1.0 : 0.0,
      urgent: fusion.urgency === "urgent" ? 1.0 : 0.0,
      critical: fusion.urgency === "critical" ? 1.0 : 0.0
    },
    modelType: "Rule-Based Fallback (Python ML unavailable)"
  };
}

// ─── 5. Haversine Distance helper ───────────────────────────────────────────

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ─── 6. Hospital Matching Engine ────────────────────────────────────────────

export function matchHospitals(ambulanceLat, ambulanceLng, redFlags, finalUrgency, hospitals) {
  // Determine if specific capabilities are required
  const needsCardiac = redFlags.includes("chest pain");
  const needsTrauma = redFlags.includes("severe bleeding") || redFlags.includes("stroke symptoms") || redFlags.includes("unconscious");
  const needsICU = finalUrgency === "critical";

  const scoredHospitals = hospitals.map(h => {
    const dist = getDistance(ambulanceLat, ambulanceLng, h.lat, h.lng);
    // Speed average is 60km/h inside traffic, 1km per minute. Let's add standard delay
    const etaMin = Math.round((dist / 60) * 60 + 2); 
    
    // Check capabilities match
    let matchScore = 0;
    let missingCap = false;
    let capabilityMatches = [];

    if (needsCardiac) {
      if (h.has_cardiac) {
        matchScore += 30;
        capabilityMatches.push("Cardiac Unit");
      } else {
        matchScore -= 50; // heavily penalized
        missingCap = true;
      }
    }
    if (needsTrauma) {
      if (h.has_trauma) {
        matchScore += 30;
        capabilityMatches.push("Trauma Center");
      } else {
        matchScore -= 50;
        missingCap = true;
      }
    }
    if (needsICU) {
      if (h.icu_beds > 0) {
        matchScore += 20;
        capabilityMatches.push("ICU Bed Available");
      } else {
        matchScore -= 30; // penalized if critical but no ICU beds
      }
    }

    // Distance impact (closer is better: -5 score per km)
    matchScore -= dist * 5;

    // Capacity impact (extra beds is a minor positive)
    matchScore += Math.min(h.icu_beds, 5);

    return {
      ...h,
      distanceKm: Number(dist.toFixed(2)),
      etaMinutes: etaMin,
      matchScore,
      missingCapability: missingCap,
      matchedCapabilities: capabilityMatches
    };
  });

  // Sort by matchScore descending (higher score is better)
  scoredHospitals.sort((a, b) => b.matchScore - a.matchScore);

  // Generate justifications
  const ranked = scoredHospitals.map((h, i) => {
    let justification = "";
    if (i === 0) {
      if (h.missingCapability) {
        justification = `Recommended due to proximity (${h.etaMinutes}m ETA) despite lacking ideal specialized units.`;
      } else {
        const caps = h.matchedCapabilities.join(" & ");
        justification = `Optimal match: ${caps || 'Nearest facility'}, ${h.etaMinutes}m ETA, ${h.icu_beds} ICU beds open.`;
      }
    } else {
      if (h.missingCapability) {
        justification = `Secondary Option: Lacks critical capabilities.`;
      } else {
        justification = `Secondary Option: ${h.etaMinutes}m ETA (${h.distanceKm} km away).`;
      }
    }
    return {
      ...h,
      justification
    };
  });

  return {
    recommended: ranked[0],
    options: ranked
  };
}

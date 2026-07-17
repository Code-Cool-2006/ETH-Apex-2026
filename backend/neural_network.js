import fs from 'fs';
import path from 'path';

// Red flag target list
export const RED_FLAGS_LIST = ["unconscious", "not breathing", "severe bleeding", "chest pain", "stroke symptoms"];

// Urgency target list
export const URGENCY_CLASSES = ["stable", "urgent", "critical"];

// Vocabulary for Symptom Bag-of-Words classification
export const VOCABULARY = [
  "unconscious", "passed out", "fainted", "unresponsive",
  "breathing", "not breathing", "stop", "struggling", "apnea", "arrest", "suffocating",
  "bleeding", "severe bleeding", "heavy", "profuse", "hemorrhage",
  "chest pain", "cardiac", "heart attack", "pressure in chest",
  "stroke", "slurred", "drooping", "numbness", "weakness", "facial droop",
  "pain", "fever", "cough", "dizzy", "headache", "accident", "fall", "injury", "injured", "vomit", "nausea"
];

const WEIGHTS_FILE = path.resolve('model_weights.json');

export class NeuralNetwork {
  constructor(inputSize = 43, hiddenSize = 20, outputSizeUrgency = 3, outputSizeRedFlags = 5) {
    this.inputSize = inputSize; // 6 vitals/age + 37 vocabulary features
    this.hiddenSize = hiddenSize;
    this.outputSizeUrgency = outputSizeUrgency;
    this.outputSizeRedFlags = outputSizeRedFlags;

    this.weights1 = []; // [inputSize][hiddenSize]
    this.bias1 = [];    // [hiddenSize]

    this.weights2Urgency = []; // [hiddenSize][outputSizeUrgency]
    this.bias2Urgency = [];    // [outputSizeUrgency]

    this.weights2RedFlags = []; // [hiddenSize][outputSizeRedFlags]
    this.bias2RedFlags = [];    // [outputSizeRedFlags]

    this.initializeWeights();
  }

  initializeWeights() {
    // Xavier / Glorot Initialization
    const initWeights = (rows, cols) => {
      const limit = Math.sqrt(6.0 / (rows + cols));
      return Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => Math.random() * 2 * limit - limit)
      );
    };

    this.weights1 = initWeights(this.inputSize, this.hiddenSize);
    this.bias1 = Array(this.hiddenSize).fill(0.01);

    this.weights2Urgency = initWeights(this.hiddenSize, this.outputSizeUrgency);
    this.bias2Urgency = Array(this.outputSizeUrgency).fill(0.01);

    this.weights2RedFlags = initWeights(this.hiddenSize, this.outputSizeRedFlags);
    this.bias2RedFlags = Array(this.outputSizeRedFlags).fill(0.01);
  }

  // Sigmoid activation
  sigmoid(x) {
    return 1.0 / (1.0 + Math.exp(-Math.max(-15, Math.min(15, x))));
  }

  // ReLU activation
  relu(x) {
    return Math.max(0, x);
  }

  // Softmax activation
  softmax(arr) {
    const maxVal = Math.max(...arr);
    const exps = arr.map(x => Math.exp(Math.max(-15, Math.min(15, x - maxVal))));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / (sum || 1));
  }

  // Forward Pass
  forward(inputs) {
    // Hidden layer
    const hidden = Array(this.hiddenSize).fill(0);
    for (let j = 0; j < this.hiddenSize; j++) {
      let sum = this.bias1[j];
      for (let i = 0; i < this.inputSize; i++) {
        sum += inputs[i] * this.weights1[i][j];
      }
      hidden[j] = this.relu(sum);
    }

    // Urgency logits -> Softmax
    const urgencyLogits = Array(this.outputSizeUrgency).fill(0);
    for (let j = 0; j < this.outputSizeUrgency; j++) {
      let sum = this.bias2Urgency[j];
      for (let i = 0; i < this.hiddenSize; i++) {
        sum += hidden[i] * this.weights2Urgency[i][j];
      }
      urgencyLogits[j] = sum;
    }
    const urgencyProbs = this.softmax(urgencyLogits);

    // Red flags logits -> Sigmoid
    const redFlagsProbs = Array(this.outputSizeRedFlags).fill(0);
    for (let j = 0; j < this.outputSizeRedFlags; j++) {
      let sum = this.bias2RedFlags[j];
      for (let i = 0; i < this.hiddenSize; i++) {
        sum += hidden[i] * this.weights2RedFlags[i][j];
      }
      redFlagsProbs[j] = this.sigmoid(sum);
    }

    return {
      hidden,
      urgencyProbs,
      redFlagsProbs
    };
  }

  // Single step gradient update (Backpropagation)
  trainStep(inputs, targetUrgency, targetRedFlags, lr = 0.01) {
    const { hidden, urgencyProbs, redFlagsProbs } = this.forward(inputs);

    // Urgency gradients (dLoss/dLogit = pred - target for Cross Entropy + Softmax)
    const dUrgencyLogits = Array(this.outputSizeUrgency).fill(0);
    for (let j = 0; j < this.outputSizeUrgency; j++) {
      dUrgencyLogits[j] = urgencyProbs[j] - targetUrgency[j];
    }

    // Red flags gradients (dLoss/dLogit = pred - target for Binary Cross Entropy + Sigmoid)
    const dRedFlagsLogits = Array(this.outputSizeRedFlags).fill(0);
    for (let j = 0; j < this.outputSizeRedFlags; j++) {
      dRedFlagsLogits[j] = redFlagsProbs[j] - targetRedFlags[j];
    }

    // Backprop to hidden layer
    const dHidden = Array(this.hiddenSize).fill(0);
    for (let i = 0; i < this.hiddenSize; i++) {
      let sum = 0;
      for (let j = 0; j < this.outputSizeUrgency; j++) {
        sum += dUrgencyLogits[j] * this.weights2Urgency[i][j];
      }
      for (let j = 0; j < this.outputSizeRedFlags; j++) {
        sum += dRedFlagsLogits[j] * this.weights2RedFlags[i][j];
      }
      dHidden[i] = sum;
    }

    // ReLU derivative
    const dHiddenRelu = Array(this.hiddenSize).fill(0);
    for (let i = 0; i < this.hiddenSize; i++) {
      dHiddenRelu[i] = hidden[i] > 0 ? dHidden[i] : 0;
    }

    // Update weights and biases
    // 1. Urgency output weights/biases
    for (let j = 0; j < this.outputSizeUrgency; j++) {
      this.bias2Urgency[j] -= lr * dUrgencyLogits[j];
      for (let i = 0; i < this.hiddenSize; i++) {
        this.weights2Urgency[i][j] -= lr * dUrgencyLogits[j] * hidden[i];
      }
    }

    // 2. Red flags output weights/biases
    for (let j = 0; j < this.outputSizeRedFlags; j++) {
      this.bias2RedFlags[j] -= lr * dRedFlagsLogits[j];
      for (let i = 0; i < this.hiddenSize; i++) {
        this.weights2RedFlags[i][j] -= lr * dRedFlagsLogits[j] * hidden[i];
      }
    }

    // 3. Hidden layer weights/biases
    for (let j = 0; j < this.hiddenSize; j++) {
      this.bias1[j] -= lr * dHiddenRelu[j];
      for (let i = 0; i < this.inputSize; i++) {
        this.weights1[i][j] -= lr * dHiddenRelu[j] * inputs[i];
      }
    }

    // Loss calculation
    let loss = 0;
    // Cross entropy for Urgency
    for (let j = 0; j < this.outputSizeUrgency; j++) {
      if (targetUrgency[j] > 0) {
        loss -= Math.log(Math.max(1e-15, urgencyProbs[j]));
      }
    }
    // Binary cross entropy for red flags
    for (let j = 0; j < this.outputSizeRedFlags; j++) {
      const p = redFlagsProbs[j];
      const t = targetRedFlags[j];
      loss -= (t * Math.log(Math.max(1e-15, p)) + (1.0 - t) * Math.log(Math.max(1e-15, 1.0 - p)));
    }

    return loss;
  }

  // Save weights to json file
  saveWeights(filePath = WEIGHTS_FILE) {
    const modelState = {
      weights1: this.weights1,
      bias1: this.bias1,
      weights2Urgency: this.weights2Urgency,
      bias2Urgency: this.bias2Urgency,
      weights2RedFlags: this.weights2RedFlags,
      bias2RedFlags: this.bias2RedFlags
    };
    fs.writeFileSync(filePath, JSON.stringify(modelState, null, 2), 'utf8');
    console.log(`Weights saved successfully to ${filePath}`);
  }

  // Load weights from json file
  loadWeights(filePath = WEIGHTS_FILE) {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.weights1 = data.weights1;
      this.bias1 = data.bias1;
      this.weights2Urgency = data.weights2Urgency;
      this.bias2Urgency = data.bias2Urgency;
      this.weights2RedFlags = data.weights2RedFlags;
      this.bias2RedFlags = data.bias2RedFlags;
      console.log(`Weights loaded successfully from ${filePath}`);
      return true;
    }
    return false;
  }
}

// Map patient vitals and symptoms text to normalized MLP inputs
export function vectorizeInput(vitals, symptoms = "", age = 45) {
  const hr = Number(vitals.hr || vitals.heartRate || 75);
  const spo2 = Number(vitals.spo2 || 98);
  const sbp = Number(vitals.systolicBP || vitals.systolic_bp || 120);
  const temp = Number(vitals.temp || vitals.temperature || 36.6);
  const rr = Number(vitals.respRate || vitals.resp_rate || 14);

  // Normalizations (keeping standard inputs around 0 mean, 1 std)
  const normHR = (hr - 75) / 40;
  const normSpO2 = (spo2 - 95) / 5;
  const normSBP = (sbp - 110) / 30;
  const normTemp = (temp - 37) / 2;
  const normRR = (rr - 16) / 6;
  const normAge = (Number(age) - 45) / 25;

  const notesLower = (symptoms || "").toLowerCase();
  const wordFeatures = VOCABULARY.map(word => {
    // Binary presence feature
    return notesLower.includes(word) ? 1.0 : 0.0;
  });

  return [normHR, normSpO2, normSBP, normTemp, normRR, normAge, ...wordFeatures];
}

// Deterministic scorer helper to generate labels for synthetic training data
function calculateExpertTriage(vitals, symptoms, age) {
  // Score Vitals (NEWS2 style)
  let score = 0;
  const spo2 = Number(vitals.spo2);
  if (spo2 < 90) score += 3;
  else if (spo2 < 94) score += 1;

  const hr = Number(vitals.hr);
  if (hr > 130 || hr < 40) score += 2;
  else if (hr > 110 || hr < 50) score += 1;

  const sbp = Number(vitals.systolicBP);
  if (sbp < 90) score += 3;
  else if (sbp < 100) score += 1;

  const temp = Number(vitals.temp);
  if (temp > 39.5 || temp < 35.0) score += 1;

  const rr = Number(vitals.respRate);
  if (rr > 24 || rr < 9) score += 3;
  else if (rr > 20) score += 1;

  let vitalsUrgency = "stable";
  if (score >= 5) vitalsUrgency = "critical";
  else if (score >= 2) vitalsUrgency = "urgent";

  // Red Flags NLP Extract
  const notesLower = (symptoms || "").toLowerCase();
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

  // Precedence Escalation
  let urgency = vitalsUrgency;
  const hasOverride = redFlags.some(f => RED_FLAGS_LIST.includes(f));
  const rank = { stable: 0, urgent: 1, critical: 2 };
  
  if (hasOverride && rank[urgency] < rank["critical"]) {
    urgency = "critical";
  } else if (redFlags.length > 0 && rank[urgency] < rank["urgent"]) {
    urgency = "urgent";
  }

  return {
    score,
    vitalsUrgency,
    redFlags,
    urgency
  };
}

// Generate diverse synthetic examples
export function generateSyntheticData(count = 2000) {
  const dataset = [];
  const symptomsBank = [
    { text: "Patient reports severe chest pain radiating to left arm. Shortness of breath.", flags: ["chest pain"] },
    { text: "Unconscious male found on street, unresponsive to pain. Slow shallow breathing.", flags: ["unconscious"] },
    { text: "Not breathing, cardiac arrest. CPR is in progress.", flags: ["not breathing"] },
    { text: "Profuse arterial bleeding from leg laceration due to power tool accident.", flags: ["severe bleeding"] },
    { text: "Left sided weakness, facial droop, slurred speech started 30 mins ago.", flags: ["stroke symptoms"] },
    { text: "Mild cough and fever for 3 days. Patient is awake and talking.", flags: [] },
    { text: "Sprained ankle after falling down two steps. In mild pain.", flags: [] },
    { text: "Nausea, vomiting and abdominal distress, no other red flags.", flags: [] },
    { text: "Severe headache and dizziness. Vitals are currently stable.", flags: [] },
    { text: "Patient fainted but is now responsive. Complaining of weakness.", flags: ["unconscious"] }
  ];

  for (let i = 0; i < count; i++) {
    // Generate randomized vitals
    const hr = Math.floor(Math.random() * 120) + 35; // 35 to 155
    const spo2 = Math.floor(Math.random() * 15) + 85; // 85 to 100
    const systolicBP = Math.floor(Math.random() * 100) + 70; // 70 to 170
    const temp = Number((Math.random() * 6 + 34).toFixed(1)); // 34.0 to 40.0
    const respRate = Math.floor(Math.random() * 25) + 6; // 6 to 31
    const age = Math.floor(Math.random() * 80) + 12; // 12 to 92

    const vitals = { hr, spo2, systolicBP, temp, respRate };

    // Select random symptoms or empty
    const symptomSelect = symptomsBank[Math.floor(Math.random() * symptomsBank.length)];
    const text = Math.random() > 0.15 ? symptomSelect.text : "";

    // Evaluate ground truth labels via rule engine
    const truth = calculateExpertTriage(vitals, text, age);

    // Vectorize inputs
    const inputs = vectorizeInput(vitals, text, age);

    // Vectorize targets
    const targetUrgency = [
      truth.urgency === "stable" ? 1.0 : 0.0,
      truth.urgency === "urgent" ? 1.0 : 0.0,
      truth.urgency === "critical" ? 1.0 : 0.0
    ];

    const targetRedFlags = RED_FLAGS_LIST.map(f => truth.redFlags.includes(f) ? 1.0 : 0.0);

    dataset.push({
      inputs,
      targetUrgency,
      targetRedFlags,
      meta: { vitals, text, age, urgency: truth.urgency, redFlags: truth.redFlags }
    });
  }

  return dataset;
}

// Core training routine
export function trainModel(epochs = 150, lr = 0.015, dataCount = 2000) {
  console.log(`Generating ${dataCount} training examples...`);
  const dataset = generateSyntheticData(dataCount);
  const net = new NeuralNetwork();

  console.log(`Starting Neural Network Training for ${epochs} epochs...`);
  let lastLoss = 0;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    let epochLoss = 0;
    // Shuffle dataset
    for (let i = dataset.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dataset[i], dataset[j]] = [dataset[j], dataset[i]];
    }

    for (const sample of dataset) {
      epochLoss += net.trainStep(sample.inputs, sample.targetUrgency, sample.targetRedFlags, lr);
    }
    epochLoss /= dataset.length;
    lastLoss = epochLoss;

    if (epoch % 30 === 0 || epoch === 1 || epoch === epochs) {
      console.log(`Epoch ${epoch}/${epochs} - Average Multi-task Loss: ${epochLoss.toFixed(6)}`);
    }
  }

  // Calculate overall training accuracy
  let correctUrgency = 0;
  let correctFlags = 0;
  let totalFlagsCount = 0;

  for (const sample of dataset) {
    const pred = net.forward(sample.inputs);
    
    // Check urgency
    const predUrgencyIdx = pred.urgencyProbs.indexOf(Math.max(...pred.urgencyProbs));
    const targetUrgencyIdx = sample.targetUrgency.indexOf(1.0);
    if (predUrgencyIdx === targetUrgencyIdx) correctUrgency++;

    // Check red flags (threshold at 0.5)
    for (let j = 0; j < RED_FLAGS_LIST.length; j++) {
      const pFlag = pred.redFlagsProbs[j] >= 0.5 ? 1.0 : 0.0;
      const tFlag = sample.targetRedFlags[j];
      if (pFlag === tFlag) correctFlags++;
      totalFlagsCount++;
    }
  }

  const urgencyAcc = (correctUrgency / dataset.length) * 100;
  const flagsAcc = (correctFlags / totalFlagsCount) * 100;

  console.log(`Neural Model Trained. Urgency Accuracy: ${urgencyAcc.toFixed(2)}%, Red Flags Acc: ${flagsAcc.toFixed(2)}%, Final Loss: ${lastLoss.toFixed(6)}`);
  
  net.saveWeights();
  return { net, urgencyAcc, flagsAcc, loss: lastLoss };
}

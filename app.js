// ──────────────────────────────────────────────────────────────────────────────
// 1. GLOBALS & CONSTANTS
// ──────────────────────────────────────────────────────────────────────────────
let audioCtx = null;
let nodes = {};           // ← central place for all audio nodes (preGain, distortion, dryGain, etc.)
let bufferCache = null;
let sourceNode = null;
let analyser = null;
let waveformRunning = false;

// UI refs
let waveformCanvas, waveformCtx, meterCanvas, meterCtx;

// State
const knobState = { damage: 0, crush: 0, filter: 0, sat: 0, dirt: 25, wetdry: 70, glitch: 0 };
let glitchTimer = null;
let glitchActive = false;
let isLoadingFile = false;

// Constants
const PRESET_KEY = 'grungerPresets';
const MIN_DB = -60; // safety

// new 2026-01-13
function safeGain(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

// new 2026-01-13
function emergencyMute() {
  if (nodes.masterGain) nodes.masterGain.gain.value = 0;
  stopAudio();
  console.warn("Emergency mute triggered");
}

// new 2026-01-13
let lastParamUpdate = 0;

function throttledApply() {
  const now = performance.now();
  if (now - lastParamUpdate < 16) return; // ~60fps
  lastParamUpdate = now;
  window.applyParams();
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. AUDIO NODE FACTORY / CREATION
// ──────────────────────────────────────────────────────────────────────────────
function ensureAudio() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Create ALL nodes once here – never recreate on play!
  analyser           = audioCtx.createAnalyser();
  analyser.fftSize   = 2048;

  nodes.preGain      = audioCtx.createGain();
  nodes.distortion   = audioCtx.createWaveShaper();
  nodes.postGain     = audioCtx.createGain();     // optional makeup after distortion

  nodes.crusher      = createBitCrusher(audioCtx);
  nodes.filter       = audioCtx.createBiquadFilter();
  nodes.saturation   = audioCtx.createWaveShaper();

  nodes.dryGain      = audioCtx.createGain();
  nodes.wetGain      = audioCtx.createGain();
  nodes.masterGain   = audioCtx.createGain();

  // Default values (important!)
  nodes.preGain.gain.value     = 1;
  nodes.postGain.gain.value    = 0.9;
  nodes.dryGain.gain.value     = 1;
  nodes.wetGain.gain.value     = 0;
  nodes.masterGain.gain.value  = 0.92; // slight headroom

  nodes.filter.type            = "lowpass";
  nodes.filter.frequency.value = 20000;
  nodes.filter.Q.value         = 0.707;

  nodes.distortion.oversample  = "4x";
  nodes.saturation.oversample  = "2x";

  // Initial curves
  nodes.distortion.curve = makeDistortionCurve(0);
  nodes.saturation.curve = makeSaturationCurve(0);
}

function buildEffectChain() {
  // DIRTY chain (only connect once – reuse!)
  nodes.preGain.connect(nodes.distortion);
  nodes.distortion.connect(nodes.crusher);
  nodes.crusher.connect(nodes.filter);
  nodes.filter.connect(nodes.saturation);
  nodes.saturation.connect(nodes.wetGain);

  // Connect both paths to master
  nodes.dryGain.connect(nodes.masterGain);
  nodes.wetGain.connect(nodes.masterGain);

  // Meter & output
  nodes.masterGain.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. PLAY / STOP (only create source here – never reconnect everything)
// ──────────────────────────────────────────────────────────────────────────────
async function loadAudioFile(file) {
  if (isLoadingFile) {
    console.warn("Load already in progress — ignoring");
    return;
  }

  isLoadingFile = true;

  try {
    ensureAudio();

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    stopAudio();

    const arrayBuffer = await file.arrayBuffer();
    bufferCache = await audioCtx.decodeAudioData(arrayBuffer);

    console.log("Decoded buffer OK");
  } finally {
    isLoadingFile = false;
  }
}

function playAudio() {
  if (!audioCtx || !bufferCache) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  stopAudio();

  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = bufferCache;

  // Connect source ONCE to both paths
  sourceNode.connect(nodes.dryGain);
  sourceNode.connect(nodes.preGain);

  sourceNode.start();
  waveformRunning = true;
  drawWaveform();
  drawMeter();

  console.log("Playing – chain is stable");
}

function stopAudio() {
  if (sourceNode) {
    sourceNode.stop();
    sourceNode.disconnect();
    sourceNode = null;
  }
  stopGlitch();
  waveformRunning = false;
}

// // new 2026-01-11
window.applyParams = function () {
  try {
    if (!audioCtx) return;

    // Early exit if critical nodes are missing
    if (!nodes.dryGain || !nodes.wetGain || !nodes.masterGain) {
      console.warn("Audio nodes not ready yet");
      return;
    }

    // FX nodes can be optional (they're created on first play)
    const hasFX = !!nodes.distortion && !!nodes.preGain && !!nodes.crusher && !!nodes.filter && !!nodes.saturation;

    // Always update dry/wet even without FX
    const wet = (knobState.wetdry ?? 70) / 100;
    const dry = 1 - wet;
    const dirt = (knobState.dirt ?? 25) / 100;

    nodes.dryGain.gain.cancelScheduledValues(audioCtx.currentTime);
    nodes.wetGain.gain.cancelScheduledValues(audioCtx.currentTime);

    nodes.dryGain.gain.setTargetAtTime(safeGain(dry), audioCtx.currentTime, 0.015);
    nodes.wetGain.gain.setTargetAtTime(safeGain(dirt * wet), audioCtx.currentTime, 0.015);

    // Only apply FX params if chain exists and buffer is loaded
    if (hasFX && bufferCache) {
      const dmg   = knobState.damage || 0;
      const crush = knobState.crush  || 0;
      const filt  = knobState.filter || 0;
      const sat   = knobState.sat    || 0;

      // DAMAGE
      nodes.preGain.gain.value = 1 + dmg / 25;
      nodes.distortion.curve = makeDistortionCurve(dmg);
      nodes.postGain.gain.value = 1 - dmg / 300;

      // CRUSH
      nodes.crusher.setAmount(crush);

      // FILTER (logarithmic sweep feels analog)
      const minFreq = 120;
      const maxFreq = audioCtx.sampleRate / 2;
      const norm = filt / 100;
      const freq = minFreq * Math.pow(maxFreq / minFreq, norm);

      nodes.filter.frequency.setTargetAtTime(
        freq,
        audioCtx.currentTime,
        0.015
      );

      // SAT
      nodes.saturation.curve = makeSaturationCurve(sat);
    }

    // // new 2026-01-11
    const glitch = knobState.glitch || 0;

    if (glitch > 0 && !glitchActive) {
      startGlitch(glitch);
      glitchActive = true;
    }

    if (glitch === 0 && glitchActive) {
      stopGlitch();
      glitchActive = false;
    }
  } catch (e) {
    console.error(e);
    emergencyMute();
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// 5. UI / KNOB / SLIDER / EVENTS (your existing code – just call throttledApply)
// ──────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('.knob').forEach(knob => {
  const img = knob.querySelector('img');
  const param = knob.dataset.param;

  let isDragging = false;
  let startY = 0;
  let value = knobState[param] || 0;  // use default from knobState

  // knobState[param] = value;  // already set
  if (window.applyParams) window.applyParams();

  const MIN = 0;
  const MAX = 100;
  const BASE_SENSITIVITY = 0.25;
  

  function setRotation(val) {
    const angle = -135 + (val / 100) * 270;
    img.style.transform = `rotate(${angle}deg)`;
  }

  setRotation(value);
  

  function start(y) {
    isDragging = true;
    startY = y;
    document.body.style.cursor = 'ns-resize';
  }

  function move(y, shiftKey = false) {
    if (!isDragging) return;

    const delta = startY - y;
    const speed = shiftKey ? 0.08 : BASE_SENSITIVITY;

    value = Math.min(MAX, Math.max(MIN, value + delta * speed));
    knobState[param] = value;
    if (bufferCache) throttledApply(); // new 2026-01-13

    setRotation(value);
    startY = y;

    // 🔥 DEBUG / FUTURE AUDIO HOOK
    console.log(`${param.toUpperCase()}: ${value.toFixed(1)}`);
  }

  function stop() {
    isDragging = false;
    document.body.style.cursor = '';
  }

  // Mouse
  knob.addEventListener('mousedown', e => {
    e.preventDefault();
    start(e.clientY);
  });

  document.addEventListener('mousemove', e => move(e.clientY, e.shiftKey));
  document.addEventListener('mouseup', stop);

  // Touch
  knob.addEventListener('touchstart', e => {
    start(e.touches[0].clientY);
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    move(e.touches[0].clientY);
  }, { passive: false });

  document.addEventListener('touchend', stop);

  // Scroll wheel fine control
  knob.addEventListener('wheel', e => {
    e.preventDefault();
    value = Math.min(MAX, Math.max(MIN, value + (e.deltaY > 0 ? -1 : 1)));
    knobState[param] = value;
    if (bufferCache) throttledApply(); // new 2026-01-13
    setRotation(value);
  }, { passive: false });
});

// // new 2026-01-11
function savePreset(name) {
  if (!name) return;

  const presets = getPresets();

  presets[name] = {
    damage: knobState.damage || 0,
    crush:  knobState.crush  || 0,
    filter: knobState.filter || 0,
    sat:    knobState.sat    || 0,
    dirt:   knobState.dirt   || 25,
    wetdry: knobState.wetdry || 70,
    glitch: knobState.glitch || 0
  };

  savePresets(presets);
  console.log("Preset saved:", name);
}

// // new 2026-01-11
function loadPreset(name) {
  const presets = getPresets();
  const preset = presets[name];
  if (!preset) return;

  Object.entries(preset).forEach(([key, value]) => {
    knobState[key] = value;

    const knob = document.querySelector(`.knob[data-param="${key}"] img`);
    if (knob) {
      const angle = -135 + (value / 100) * 270;
      knob.style.transform = `rotate(${angle}deg)`;
    }

    // Handle sliders
    const slider = document.getElementById(key);
    if (slider) {
      slider.value = value;
    }
  });

  if (window.applyParams) window.applyParams();
  console.log("Preset loaded:", name);
}

// // new 2026-01-11
function resetEngine() {
  stopGlitch();
  glitchActive = false;

  ["damage", "crush", "filter", "sat"].forEach(k => {
    knobState[k] = 0;
    const knob = document.querySelector(`.knob[data-param="${k}"] img`);
    if (knob) knob.style.transform = "rotate(-135deg)";
  });

  // Reset sliders
  knobState.dirt = 25;
  knobState.wetdry = 70;
  knobState.glitch = 0;
  document.getElementById("dirtMix").value = 25;
  document.getElementById("wetDry").value = 70;

  if (window.applyParams) window.applyParams();
  console.log("Engine reset");
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. HELPERS (curves, bitcrusher, glitch, draw functions)
// ──────────────────────────────────────────────────────────────────────────────
// // new 2026-01-11
function startGlitch(amount = 0) {
  stopGlitch();
  if (amount <= 0) return;

  const rate = Math.max(40, 500 - amount * 4); // higher = more frequent
  const depth = amount / 100;

  glitchTimer = setInterval(() => {
    if (!nodes.masterGain) return;

    // Random dropout or stutter
    if (Math.random() < 0.5) {
      // Dropout
      nodes.masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.005);
      setTimeout(() => {
        nodes.masterGain.gain.setTargetAtTime(1, audioCtx.currentTime, 0.01);
      }, 20 + Math.random() * 80);
    } else {
      // Micro stutter
      nodes.masterGain.gain.setTargetAtTime(1 - depth, audioCtx.currentTime, 0.005);
      setTimeout(() => {
        nodes.masterGain.gain.setTargetAtTime(1, audioCtx.currentTime, 0.01);
      }, 30);
    }
  }, rate);
}

function stopGlitch() {
  if (glitchTimer) {
    clearInterval(glitchTimer);
    glitchTimer = null;
  }
}

// // new 2026-01-11
function drawWaveform() {
  if (!analyser || !waveformCtx || !waveformCanvas || !waveformRunning) return;

  requestAnimationFrame(drawWaveform);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  const w = waveformCanvas.width;
  const h = waveformCanvas.height;

  waveformCtx.clearRect(0, 0, w, h);

  waveformCtx.lineWidth = 2;
  waveformCtx.strokeStyle = "rgba(0,0,0,0.85)";
  waveformCtx.beginPath();

  const sliceWidth = w / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * h) / 2;

    if (i === 0) waveformCtx.moveTo(x, y);
    else waveformCtx.lineTo(x, y);

    x += sliceWidth;
  }

  waveformCtx.lineTo(w, h / 2);
  waveformCtx.stroke();
}

// // new 2026-01-11
function drawMeter() {
  if (!analyser || !meterCtx || !meterCanvas) return;

  const bufferLength = analyser.frequencyBinCount;
  const data = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(data);

  // Calculate RMS (volume)
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / bufferLength);

  const level = Math.min(1, rms * 2.5); // boost for visibility

  const w = meterCanvas.width;
  const h = meterCanvas.height;

  meterCtx.clearRect(0, 0, w, h);

  // Color by intensity
  let color = "#00ff9a";
  if (level > 0.7) color = "#ff2d2d";
  else if (level > 0.45) color = "#ffd000";

  meterCtx.fillStyle = color;
  meterCtx.fillRect(0, 0, w * level, h);

  requestAnimationFrame(drawMeter);
}

// // new 2026-01-11
function makeDistortionCurve(amount = 0) {
  const k = amount * 100;
  const n = 44100;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;

  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] =
      ((3 + k) * x * 20 * deg) /
      (Math.PI + k * Math.abs(x));
  }

  return curve;
}

// // new 2026-01-11
function makeSaturationCurve(amount = 0) {
  const n = 44100;
  const curve = new Float32Array(n);
  const drive = 1 + amount * 0.04; // gentle → aggressive

  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    // tanh-style soft clipping
    curve[i] = Math.tanh(x * drive);
  }

  return curve;
}

// // new 2026-01-11
function createBitCrusher(context) {
  const node = context.createScriptProcessor(4096, 1, 1);

  let phase = 0;
  let lastSample = 0;
  let reduction = 1;   // sample rate reduction
  let bitDepth = 16;   // bits

  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);

    const step = Math.pow(0.5, bitDepth);

    for (let i = 0; i < input.length; i++) {
      phase += reduction;
      if (phase >= 1.0) {
        phase -= 1.0;
        lastSample = Math.round(input[i] / step) * step;
      }
      output[i] = lastSample;
    }
  };

  node.setAmount = (amount) => {
    // amount: 0–100
    bitDepth = Math.max(1, 16 - Math.floor(amount / 7));
    reduction = Math.max(0.02, 1 - amount / 120);
  };

  return node;
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. INIT / DOMContentLoaded
// ──────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  console.log("Grunger Nasty Decay Engine – initializing");

  ensureAudio();        // create context + nodes once
  buildEffectChain();   // connect everything once

  // Your existing button listeners...
  const btnLoad = document.getElementById("btnLoad");
  const btnPlay = document.getElementById("btnPlay");
  const btnStop = document.getElementById("btnStop");
  const fileInput = document.getElementById("fileInput");

  if (!btnLoad || !fileInput) {
    console.error("Load button or file input missing");
    return;
  }

  btnLoad.addEventListener("click", async () => {
    console.log("LOAD clicked");

    // 🔥 FORCE AudioContext creation on user gesture
    ensureAudio();

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
      console.log("AudioContext resumed from LOAD");
    }

    fileInput.click();
  });

  fileInput.addEventListener("change", async (e) => {
    console.log("File input change fired");

    const file = e.target.files && e.target.files[0];
    console.log("File object:", file);

    if (!file) {
      console.warn("No file selected");
      return;
    }

    console.log("Selected file:", file.name, file.type, file.size);

    try {
      await loadAudioFile(file);
      console.log("Audio decoded and cached");
    } catch (err) {
      console.error("Error loading audio:", err);
    }
  });

  // // new 2026-01-11
  waveformCanvas = document.getElementById("waveform");
  if (waveformCanvas) {
    waveformCtx = waveformCanvas.getContext("2d");

    // Match canvas resolution to CSS size
    const resizeWaveform = () => {
      waveformCanvas.width = waveformCanvas.offsetWidth;
      waveformCanvas.height = waveformCanvas.height = waveformCanvas.offsetHeight;
    };

    resizeWaveform();
    window.addEventListener("resize", resizeWaveform);
  }

  // // new 2026-01-11
  meterCanvas = document.getElementById("levelMeter");
  if (meterCanvas) {
    meterCtx = meterCanvas.getContext("2d");

    const resizeMeter = () => {
      meterCanvas.width = meterCanvas.offsetWidth;
      meterCanvas.height = meterCanvas.offsetHeight;
    };

    resizeMeter();
    window.addEventListener("resize", resizeMeter);
  }

  if (btnPlay) btnPlay.addEventListener("click", playAudio);
  if (btnStop) btnStop.addEventListener("click", stopAudio);

  // // new 2026-01-11
  document.getElementById("savePresetBtn")?.addEventListener("click", () => {
    const name = document.getElementById("presetName").value.trim();
    savePreset(name);
  });

  document.getElementById("loadPresetBtn")?.addEventListener("click", () => {
    const name = document.getElementById("presetName").value.trim();
    loadPreset(name);
  });

  document.getElementById("resetBtn")?.addEventListener("click", resetEngine);

  // // new 2026-01-11
  const dirtMixSlider = document.getElementById("dirtMix");
  const wetDrySlider = document.getElementById("wetDry");

  // Set initial values // new 2026-01-13
  if (dirtMixSlider) dirtMixSlider.value = knobState.dirt ?? 25;
  if (wetDrySlider) wetDrySlider.value = knobState.wetdry ?? 70;

  if (dirtMixSlider) {
    dirtMixSlider.addEventListener("input", e => {
      knobState.dirt = Number(e.target.value);
      throttledApply(); // new 2026-01-13
    });
  }

  if (wetDrySlider) {
    wetDrySlider.addEventListener("input", e => {
      knobState.wetdry = Number(e.target.value);
      throttledApply(); // new 2026-01-13
    });
  }

  // Important: call applyParams after load/reset so defaults are applied
  window.applyParams();
});


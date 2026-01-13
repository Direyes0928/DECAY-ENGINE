console.log("app.js loaded");
// // new 2026-01-11
// DECAY ENGINE — Universal Knob Controller

const knobState = {};

document.querySelectorAll('.knob').forEach(knob => {
  const img = knob.querySelector('img');
  const param = knob.dataset.param;

  let isDragging = false;
  let startY = 0;
  let value = 0;

  knobState[param] = value;
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
    if (window.applyParams) window.applyParams();

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
    if (window.applyParams) window.applyParams();
    setRotation(value);
  }, { passive: false });
});


  // // new 2026-01-11
  document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM ready — wiring audio controls");

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
        waveformCanvas.height = waveformCanvas.offsetHeight;
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

    if (dirtMixSlider) {
      dirtMixSlider.addEventListener("input", e => {
        knobState.dirt = Number(e.target.value);
        if (window.applyParams) window.applyParams();
      });
    }

    if (wetDrySlider) {
      wetDrySlider.addEventListener("input", e => {
        knobState.wetdry = Number(e.target.value);
        if (window.applyParams) window.applyParams();
      });
    }
  });

  // Minimal audio globals and helpers (ensure these exist for the debug handlers)
  let audioCtx = null;
  let sourceNode = null;
  let bufferCache = null;
  // // new 2026-01-11
  let analyser = null;
  let waveformCtx = null;
  let waveformCanvas = null;
  // // new 2026-01-11
  let waveformRunning = false;
  // // new 2026-01-11
  let meterCanvas = null;
  let meterCtx = null;
  // // new 2026-01-11: distortion chain
  let preGain = null;
  let distortion = null;
  let postGain = null;
  // // new 2026-01-11: bitcrusher
  let crusher = null;
  let crusherGain = null;
  // // new 2026-01-11: filter node
  let filterNode = null;
  // // new 2026-01-11
  let satNode = null;
  // // new 2026-01-11
  let dryGain = null;
  let wetGain = null;
  let masterGain = null;

  // // new 2026-01-11
  let glitchTimer = null;
  let glitchActive = false;

  // // new 2026-01-11
  const PRESET_KEY = "decay_engine_presets";

  function getPresets() {
    try {
      return JSON.parse(localStorage.getItem(PRESET_KEY)) || {};
    } catch {
      return {};
    }
  }

  function savePresets(presets) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  }

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      console.log("AudioContext created");

      // // new 2026-01-11
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;

      // // new 2026-01-11: distortion chain
      preGain = audioCtx.createGain();
      distortion = audioCtx.createWaveShaper();
      postGain = audioCtx.createGain();

      preGain.gain.value = 1;
      distortion.curve = makeDistortionCurve(0);
      distortion.oversample = "4x";
      postGain.gain.value = 0.9;

      // // new 2026-01-11: bitcrusher setup
      crusher = createBitCrusher(audioCtx);
      crusherGain = audioCtx.createGain();
      crusherGain.gain.value = 1;

      // // new 2026-01-11: filter setup
      filterNode = audioCtx.createBiquadFilter();
      filterNode.type = "lowpass";
      filterNode.frequency.value = 20000; // fully open by default
      filterNode.Q.value = 0.7;

      // // new 2026-01-11
      satNode = audioCtx.createWaveShaper();
      satNode.curve = makeSaturationCurve(0);
      satNode.oversample = "2x";

      // // new 2026-01-11
      dryGain = audioCtx.createGain();
      wetGain = audioCtx.createGain();
      masterGain = audioCtx.createGain();

      dryGain.gain.value = 1;
      wetGain.gain.value = 1;
      masterGain.gain.value = 1;
    }
  }

  async function loadAudioFile(file) { // // new 2026-01-11
    ensureAudio();

    if (!audioCtx) {
      throw new Error("AudioContext not initialized");
    }

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
      console.log("AudioContext resumed");
    }

    console.log("Reading file as ArrayBuffer…");

    const arrayBuffer = await file.arrayBuffer();
    console.log("ArrayBuffer size:", arrayBuffer.byteLength);

    bufferCache = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(
        arrayBuffer,
        decoded => resolve(decoded),
        err => reject(err)
      );
    });

    console.log("Decoded buffer:", bufferCache);
  }

  function playAudio() {
    console.log("PLAY clicked");

    if (!audioCtx) {
      console.warn("No AudioContext");
      return;
    }

    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
      console.log("AudioContext resumed from PLAY");
    }

    if (!bufferCache) {
      console.warn("No audio buffer loaded");
      return;
    }

    stopAudio();

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = bufferCache;

    // CLEAN PATH
    sourceNode.connect(dryGain);
    dryGain.connect(masterGain);

    // DIRTY PATH (FX chain)
    sourceNode.connect(preGain);
    preGain.connect(distortion);
    distortion.connect(crusher);
    crusher.connect(filterNode);
    filterNode.connect(satNode);
    satNode.connect(wetGain);
    wetGain.connect(masterGain);

    // OUTPUT
    masterGain.connect(analyser);
    analyser.connect(audioCtx.destination);

    sourceNode.start();

    console.log("Playback started");

    // start drawing the waveform (only once)
    if (!waveformRunning) {
      waveformRunning = true;
      drawWaveform();
    }

    drawMeter();
  }

  function stopAudio() {
    stopGlitch();
    glitchActive = false;

    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) { /* ignore */ }
      try { sourceNode.disconnect(); } catch (e) { /* ignore */ }
      sourceNode = null;
      // stop the waveform loop
      waveformRunning = false;
      console.log("Playback stopped");
    }
  }

// // new 2026-01-11
window.applyParams = function () {
  if (!distortion || !preGain || !postGain || !crusher || !filterNode || !satNode) return;

  const dmg   = knobState.damage || 0;
  const crush = knobState.crush  || 0;
  const filt  = knobState.filter || 0;
  const sat   = knobState.sat    || 0;

  // DAMAGE
  preGain.gain.value = 1 + dmg / 25;
  distortion.curve = makeDistortionCurve(dmg);
  postGain.gain.value = 1 - dmg / 300;

  // CRUSH
  crusher.setAmount(crush);

  // FILTER (logarithmic sweep feels analog)
  const minFreq = 120;
  const maxFreq = audioCtx.sampleRate / 2;
  const norm = filt / 100;
  const freq = minFreq * Math.pow(maxFreq / minFreq, norm);

  filterNode.frequency.setTargetAtTime(
    freq,
    audioCtx.currentTime,
    0.015
  );

  // SAT
  satNode.curve = makeSaturationCurve(sat);

  // // new 2026-01-11
  const dirt = knobState.dirt ?? 25;      // how much FX signal
  const wetdry = knobState.wetdry ?? 70;  // overall wet/dry balance

  // DIRT MIX (controls FX amount)
  wetGain.gain.setTargetAtTime(
    dirt / 100,
    audioCtx.currentTime,
    0.02
  );

  // WET / DRY (master blend)
  dryGain.gain.setTargetAtTime(
    (100 - wetdry) / 100,
    audioCtx.currentTime,
    0.02
  );

  masterGain.gain.setTargetAtTime(
    wetdry / 100,
    audioCtx.currentTime,
    0.02
  );

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
};

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

// // new 2026-01-11
function startGlitch(amount = 0) {
  stopGlitch();
  if (amount <= 0) return;

  const rate = Math.max(40, 500 - amount * 4); // higher = more frequent
  const depth = amount / 100;

  glitchTimer = setInterval(() => {
    if (!masterGain) return;

    // Random dropout or stutter
    if (Math.random() < 0.5) {
      // Dropout
      masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.005);
      setTimeout(() => {
        masterGain.gain.setTargetAtTime(1, audioCtx.currentTime, 0.01);
      }, 20 + Math.random() * 80);
    } else {
      // Micro stutter
      masterGain.gain.setTargetAtTime(1 - depth, audioCtx.currentTime, 0.005);
      setTimeout(() => {
        masterGain.gain.setTargetAtTime(1, audioCtx.currentTime, 0.01);
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


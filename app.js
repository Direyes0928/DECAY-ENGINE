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

    if (btnPlay) btnPlay.addEventListener("click", playAudio);
    if (btnStop) btnStop.addEventListener("click", stopAudio);
  });

  // Minimal audio globals and helpers (ensure these exist for the debug handlers)
  let audioCtx = null;
  let sourceNode = null;
  let bufferCache = null;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      console.log("AudioContext created");
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

    sourceNode.connect(audioCtx.destination);
    sourceNode.start();

    console.log("Playback started");
  }

  function stopAudio() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) { /* ignore */ }
      try { sourceNode.disconnect(); } catch (e) { /* ignore */ }
      sourceNode = null;
      console.log("Playback stopped");
    }
  }


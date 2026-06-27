const handStyles = {
  left: { laneClass: "left", noteClass: "left-hand" },
  right: { laneClass: "right", noteClass: "right-hand" }
};

const keyboardShortcuts = [
  { key: "z", midi: 48 }, { key: "x", midi: 50 }, { key: "c", midi: 52 },
  { key: "v", midi: 53 }, { key: "b", midi: 55 }, { key: "n", midi: 57 },
  { key: "m", midi: 59 }, { key: ",", midi: 60 }, { key: ".", midi: 62 },
  { key: "/", midi: 64 }, { key: "a", midi: 65 }, { key: "s", midi: 67 },
  { key: "d", midi: 69 }, { key: "f", midi: 71 }, { key: "g", midi: 72 },
  { key: "h", midi: 74 }, { key: "j", midi: 76 }, { key: "k", midi: 77 },
  { key: "l", midi: 79 }, { key: ";", midi: 81 }
];

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const appState = {
  speed: 1,
  bpm: 110,
  playing: false,
  startedAt: 0,
  pausedBeat: 0,
  approachBeats: 10,
  hitWindow: 0.28,
  score: 0,
  combo: 0,
  audioReady: false,
  autoPlay: false,
  activeKeys: new Map(),
  keysByMidi: new Map(),
  noteData: [],
  audioContext: null,
  masterGain: null,
  noteBuffers: new Map(),
  activeVoices: [],
  hintUntil: 0,
  judgeFlashTimer: null,
  preRendered: false,
  songMeta: null,
  keyRange: { min: 36, max: 101 },
  hideLeftHandVisuals: false,
  simplifyArrangement: true,
  powerSaveMode: false,
  frameIntervalMs: 16,
  lastRenderTimestamp: 0,
  totalInteractiveNotes: 0,
  visibleRange: { start: 0, end: -1 },
  songLibrary: [],
  selectedSongId: null,
  stageFocusMode: false,
  noteCanvasContext: null
};

const dom = {
  stage: document.getElementById("stage"),
  keyboard: document.getElementById("keyboard"),
  laneLayer: document.getElementById("laneLayer"),
  noteCanvas: document.getElementById("noteCanvas"),
  startButton: document.getElementById("startButton"),
  restartButton: document.getElementById("restartButton"),
  fullscreenButton: document.getElementById("fullscreenButton"),
  songSelect: document.getElementById("songSelect"),
  speedRange: document.getElementById("speedRange"),
  speedValue: document.getElementById("speedValue"),
  autoplayToggle: document.getElementById("autoplayToggle"),
  phraseLabel: document.getElementById("phraseLabel"),
  scoreLabel: document.getElementById("scoreLabel"),
  comboLabel: document.getElementById("comboLabel"),
  hintLabel: document.getElementById("hintLabel"),
  judgeLine: document.querySelector(".judge-line"),
  pageTitle: document.querySelector(".hero-copy h1"),
  pageLead: document.querySelector(".lede"),
  metaValues: document.querySelectorAll(".meta-row strong"),
  infoCardTitle: document.querySelector(".info-card h2"),
  infoCards: document.querySelectorAll(".info-card"),
  stageCard: document.querySelector(".stage-card")
};

function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

function pitchNameFromMidi(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${noteNames[midi % 12]}${octave}`;
}

function shortcutForMidi(midi) {
  const match = keyboardShortcuts.find((item) => item.midi === midi);
  return match ? match.key.toUpperCase() : "";
}

function mediaMatches(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function shouldUsePowerSaveMode() {
  return mediaMatches("(max-width: 820px)")
    || mediaMatches("(pointer: coarse)")
    || mediaMatches("(prefers-reduced-motion: reduce)");
}

function applyPerformanceProfile({ notify = false } = {}) {
  const nextMode = shouldUsePowerSaveMode();
  const changed = appState.powerSaveMode !== nextMode;

  appState.powerSaveMode = nextMode;
  appState.frameIntervalMs = nextMode ? 32 : 16;
  document.body.classList.toggle("power-save", nextMode);

  if (notify && changed) {
    setHint(
      nextMode
        ? "已切换到手机省电模式，减少特效和刷新频率"
        : "已恢复标准模式，画面效果更完整",
      1200
    );
  }
}

function syncFullscreenUI() {
  const focused = document.fullscreenElement === dom.stageCard || appState.stageFocusMode;
  document.body.classList.toggle("stage-focus", focused);
  dom.stageCard?.classList.toggle("is-fullscreen", focused);

  if (dom.fullscreenButton) {
    dom.fullscreenButton.textContent = focused ? "退出全屏" : "全屏瀑布流";
  }
}

async function toggleStageFullscreen() {
  if (!dom.stageCard) {
    return;
  }

  const currentlyFocused = document.fullscreenElement === dom.stageCard || appState.stageFocusMode;
  if (currentlyFocused) {
    appState.stageFocusMode = false;
    if (document.fullscreenElement === dom.stageCard) {
      await document.exitFullscreen();
    } else {
      syncFullscreenUI();
      onResize();
    }
    return;
  }

  if (!document.fullscreenEnabled || !dom.stageCard.requestFullscreen) {
    appState.stageFocusMode = true;
    syncFullscreenUI();
    onResize();
    setHint("已切换到专注模式", 900);
    return;
  }

  if (document.fullscreenElement === dom.stageCard) {
    await document.exitFullscreen();
    return;
  }

  try {
    await dom.stageCard.requestFullscreen();
  } catch (error) {
    appState.stageFocusMode = true;
    syncFullscreenUI();
    onResize();
    setHint("已切换到专注模式", 900);
  }
}

function normalizePracticeMidi(midi, hand) {
  let nextMidi = midi;

  if (hand === "left") {
    while (nextMidi < 48) {
      nextMidi += 12;
    }
    while (nextMidi > 60) {
      nextMidi -= 12;
    }
    return nextMidi;
  }

  while (nextMidi < 60) {
    nextMidi += 12;
  }
  while (nextMidi > 84) {
    nextMidi -= 12;
  }
  return nextMidi;
}

function groupNotesByStart(notes) {
  const groups = new Map();

  for (const note of notes) {
    const key = note.start.toFixed(6);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(note);
  }

  return [...groups.entries()]
    .map(([key, items]) => ({
      start: Number(key),
      notes: items.sort((a, b) => a.midi - b.midi)
    }))
    .sort((a, b) => a.start - b.start);
}

function simplifySong(song) {
  const rightGroups = groupNotesByStart(song.notes.filter((note) => note.hand === "right"));
  const leftGroups = groupNotesByStart(song.notes.filter((note) => note.hand === "left"));

  const simplifiedRight = rightGroups.map((group, index) => {
    const topNote = group.notes[group.notes.length - 1];
    const midi = normalizePracticeMidi(topNote.midi, "right");
    return {
      ...topNote,
      id: `right-${index}`,
      midi,
      interactive: true,
      label: pitchNameFromMidi(midi)
    };
  });

  const simplifiedLeft = leftGroups.map((group, index) => {
    const bassNote = group.notes[0];
    const nextStart = leftGroups[index + 1]?.start;
    const duration = nextStart ? Math.max(0.5, nextStart - group.start) : bassNote.duration;
    const midi = normalizePracticeMidi(bassNote.midi, "left");
    return {
      ...bassNote,
      id: `left-${index}`,
      midi,
      duration,
      end: group.start + duration,
      interactive: true,
      label: pitchNameFromMidi(midi)
    };
  });

  const notes = [...simplifiedRight, ...simplifiedLeft].sort((a, b) => a.start - b.start || a.midi - b.midi);
  return {
    ...song,
    originalRightHandCount: song.rightHandCount,
    originalLeftHandCount: song.leftHandCount,
    originalNoteCount: song.noteCount,
    rightHandCount: simplifiedRight.length,
    leftHandCount: simplifiedLeft.length,
    noteCount: notes.length,
    notes
  };
}

function buildKeyboard() {
  const keys = [];
  let whiteIndex = 0;

  for (let midi = appState.keyRange.min; midi <= appState.keyRange.max; midi += 1) {
    const black = isBlackKey(midi);
    if (!black) {
      keys.push({ midi, black, xUnits: whiteIndex });
      whiteIndex += 1;
    } else {
      keys.push({ midi, black, xUnits: whiteIndex });
    }
  }

  return { keys, whiteCount: whiteIndex };
}

function renderKeyboard() {
  const { keys, whiteCount } = buildKeyboard();
  dom.keyboard.innerHTML = "";

  const keyboardWidth = dom.keyboard.clientWidth;
  const whiteWidth = keyboardWidth / whiteCount;
  const blackWidth = whiteWidth * 0.62;

  dom.keyboard.style.setProperty("--white-key-width", `${whiteWidth}px`);
  dom.keyboard.style.setProperty("--black-key-width", `${blackWidth}px`);
  appState.keysByMidi.clear();

  for (const key of keys) {
    const button = document.createElement("button");
    button.className = `key ${key.black ? "black" : "white"}`;
    button.dataset.midi = String(key.midi);

    if (key.black) {
      button.style.left = `${key.xUnits * whiteWidth - blackWidth / 2}px`;
      button.style.width = `${blackWidth}px`;
    } else {
      button.style.left = `${key.xUnits * whiteWidth}px`;
      button.style.width = `${whiteWidth}px`;
    }

    button.innerHTML = `
      <span class="key-label">
        <span class="degree">${pitchNameFromMidi(key.midi)}</span>
        <span class="pitch">${key.midi}</span>
        <span class="shortcut">${shortcutForMidi(key.midi)}</span>
      </span>
    `;

    button.addEventListener("pointerdown", (event) => {
      button.setPointerCapture?.(event.pointerId);
      ensureAudio().catch(() => {});
      handleKeyPress(key.midi, false, true);
    });

    button.addEventListener("pointerup", (event) => {
      button.releasePointerCapture?.(event.pointerId);
      releaseKey(key.midi);
    });

    button.addEventListener("pointercancel", (event) => {
      button.releasePointerCapture?.(event.pointerId);
      releaseKey(key.midi);
    });

    button.addEventListener("pointerleave", () => {
      releaseKey(key.midi);
    });

    dom.keyboard.appendChild(button);
    appState.keysByMidi.set(key.midi, button);
  }
}

function populateSongSelect() {
  if (!dom.songSelect) {
    return;
  }

  dom.songSelect.innerHTML = "";

  for (const song of appState.songLibrary) {
    const option = document.createElement("option");
    option.value = song.id;
    option.textContent = song.subtitle ? `${song.title} · ${song.subtitle}` : song.title;
    dom.songSelect.appendChild(option);
  }

  if (appState.selectedSongId) {
    dom.songSelect.value = appState.selectedSongId;
  }
}

function createLanes() {
  dom.laneLayer.innerHTML = "";
  const visibleNotes = appState.noteData.filter((note) => !(appState.hideLeftHandVisuals && note.hand === "left"));
  const usedMidis = [...new Set(visibleNotes.map((note) => note.midi))];
  const stageRect = dom.stage.getBoundingClientRect();

  for (const midi of usedMidis) {
    const key = appState.keysByMidi.get(midi);
    if (!key) {
      continue;
    }

    const belongsToLeft = visibleNotes.some((note) => note.midi === midi && note.hand === "left");
    const belongsToRight = visibleNotes.some((note) => note.midi === midi && note.hand === "right");
    const keyRect = key.getBoundingClientRect();
    const lane = document.createElement("div");
    lane.className = "lane";

    if (belongsToLeft && belongsToRight) {
      lane.classList.add("both");
    } else if (belongsToLeft) {
      lane.classList.add("left");
    } else {
      lane.classList.add("right");
    }

    lane.style.left = `${keyRect.left - stageRect.left}px`;
    lane.style.width = `${keyRect.width}px`;
    dom.laneLayer.appendChild(lane);
  }
}

function resizeNoteCanvas() {
  if (!dom.noteCanvas) {
    return;
  }

  const rect = dom.stage.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  dom.noteCanvas.width = Math.max(1, Math.round(rect.width * ratio));
  dom.noteCanvas.height = Math.max(1, Math.round(rect.height * ratio));
  dom.noteCanvas.style.width = `${rect.width}px`;
  dom.noteCanvas.style.height = `${rect.height}px`;
  appState.noteCanvasContext = dom.noteCanvas.getContext("2d");

  if (appState.noteCanvasContext) {
    appState.noteCanvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}

function layoutNoteGeometry() {
  const stageRect = dom.stage.getBoundingClientRect();
  const hitLineY = stageRect.height - 22;
  const travel = hitLineY - 18;
  const dualHandMidis = new Set();

  for (const midi of new Set(appState.noteData.map((note) => note.midi))) {
    const hands = new Set(appState.noteData.filter((note) => note.midi === midi).map((note) => note.hand));
    if (hands.size > 1) {
      dualHandMidis.add(midi);
    }
  }

  for (const note of appState.noteData) {
    const key = appState.keysByMidi.get(note.midi);
    if (!key) {
      continue;
    }

    const keyRect = key.getBoundingClientRect();
    const width = Math.min(Math.max(keyRect.width * 0.92, note.hand === "right" ? 48 : 42), note.hand === "right" ? 74 : 66);
    const offsetX = dualHandMidis.has(note.midi)
      ? (note.hand === "right" ? Math.min(14, width * 0.18) : -Math.min(14, width * 0.18))
      : 0;
    const noteHeight = Math.max(note.hand === "right" ? 28 : 20, (note.duration / appState.approachBeats) * travel);
    note.render = {
      centerX: keyRect.left - stageRect.left + keyRect.width / 2,
      width,
      offsetX,
      hitLineY,
      travel,
      noteHeight,
      x: keyRect.left - stageRect.left + keyRect.width / 2 - width / 2 + offsetX,
      isBlack: isBlackKey(note.midi)
    };
  }
}

function currentBeat() {
  if (!appState.playing) {
    return appState.pausedBeat;
  }

  const elapsedMs = performance.now() - appState.startedAt;
  const beatsElapsed = (elapsedMs / 60000) * appState.bpm * appState.speed;
  return appState.pausedBeat + beatsElapsed;
}

function setHint(text, durationMs = 0) {
  dom.hintLabel.textContent = text;
  appState.hintUntil = durationMs > 0 ? performance.now() + durationMs : 0;
}

function syncDefaultHint(defaultText) {
  if (!appState.hintUntil || performance.now() >= appState.hintUntil) {
    dom.hintLabel.textContent = defaultText;
    appState.hintUntil = 0;
  }
}

function flashJudgeLine(mode) {
  dom.judgeLine.classList.remove("good", "auto", "miss");
  void dom.judgeLine.offsetWidth;
  dom.judgeLine.classList.add(mode);

  if (appState.judgeFlashTimer) {
    clearTimeout(appState.judgeFlashTimer);
  }

  appState.judgeFlashTimer = window.setTimeout(() => {
    dom.judgeLine.classList.remove("good", "auto", "miss");
  }, 180);
}

function activateKey(midi, hand = "right") {
  activateKeyForDuration(midi, hand, hand === "left" ? 210 : 160);
}

function activateKeyForDuration(midi, hand = "right", durationMs = 160) {
  const key = appState.keysByMidi.get(midi);
  if (!key) {
    return;
  }

  key.classList.add("active");
  key.dataset.hand = hand;

  const activeState = appState.activeKeys.get(midi);
  if (activeState?.timeoutId) {
    clearTimeout(activeState.timeoutId);
  }

  const timeoutId = window.setTimeout(() => {
    const latestState = appState.activeKeys.get(midi);
    if (latestState?.held) {
      return;
    }

    key.classList.remove("active");
    delete key.dataset.hand;
    appState.activeKeys.delete(midi);
  }, durationMs);

  appState.activeKeys.set(midi, {
    held: activeState?.held ?? false,
    timeoutId
  });
}

function holdKey(midi, hand = "right") {
  const key = appState.keysByMidi.get(midi);
  if (!key) {
    return;
  }

  const activeState = appState.activeKeys.get(midi);
  if (activeState?.timeoutId) {
    clearTimeout(activeState.timeoutId);
  }

  key.classList.add("active");
  key.dataset.hand = hand;
  appState.activeKeys.set(midi, {
    held: true,
    timeoutId: null
  });
}

function releaseKey(midi, durationMs = 120) {
  const activeState = appState.activeKeys.get(midi);
  if (!activeState) {
    return;
  }

  const key = appState.keysByMidi.get(midi);
  if (!key) {
    appState.activeKeys.delete(midi);
    return;
  }

  if (activeState.timeoutId) {
    clearTimeout(activeState.timeoutId);
  }

  const timeoutId = window.setTimeout(() => {
    const latestState = appState.activeKeys.get(midi);
    if (latestState?.held) {
      return;
    }

    key.classList.remove("active");
    delete key.dataset.hand;
    appState.activeKeys.delete(midi);
  }, durationMs);

  appState.activeKeys.set(midi, {
    held: false,
    timeoutId
  });
}

function createPianoLikeBuffer(context, baseMidi = 72) {
  const duration = 2.8;
  const sampleRate = context.sampleRate;
  const frameCount = Math.floor(sampleRate * duration);
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);
  const baseFrequency = 440 * 2 ** ((baseMidi - 69) / 12);

  for (let index = 0; index < frameCount; index += 1) {
    const t = index / sampleRate;
    const attack = Math.min(1, t / 0.008);
    const decay = Math.exp(-3.2 * t);
    const brightness = Math.exp(-4.4 * t);
    const partial1 = Math.sin(2 * Math.PI * baseFrequency * t);
    const partial2 = 0.5 * Math.sin(2 * Math.PI * baseFrequency * 2.01 * t + 0.22);
    const partial3 = 0.24 * Math.sin(2 * Math.PI * baseFrequency * 3.98 * t + 0.58);
    const hammer = (Math.random() * 2 - 1) * 0.06 * brightness;
    const sympathetic = 0.08 * Math.sin(2 * Math.PI * baseFrequency * 0.5 * t) * Math.exp(-1.8 * t);
    channel[index] = (partial1 + partial2 + partial3 + sympathetic) * attack * decay + hammer;
  }

  return buffer;
}

function buildSampleMidiSet() {
  const anchors = [36, 43, 48, 55, 60, 67, 72, 79, 84, 91, 96];
  return anchors.filter((midi) => midi >= appState.keyRange.min - 3 && midi <= appState.keyRange.max + 3);
}

function nearestSampleMidi(midi) {
  const sampleMidis = [...appState.noteBuffers.keys()];
  if (sampleMidis.length === 0) {
    return midi;
  }

  let nearest = sampleMidis[0];
  let bestDistance = Math.abs(midi - nearest);

  for (const sampleMidi of sampleMidis) {
    const distance = Math.abs(midi - sampleMidi);
    if (distance < bestDistance) {
      nearest = sampleMidi;
      bestDistance = distance;
    }
  }

  return nearest;
}

function maxPolyphony() {
  return appState.powerSaveMode ? 8 : 14;
}

function releaseVoice(voice, fadeOutSeconds = 0.04) {
  if (!voice || voice.released) {
    return;
  }

  voice.released = true;
  const context = appState.audioContext;
  if (!context) {
    return;
  }

  const now = context.currentTime;
  try {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeOutSeconds);
    voice.source.stop(now + fadeOutSeconds + 0.01);
  } catch {
    try {
      voice.source.stop();
    } catch {
      // ignore stop races
    }
  }
}

function pruneVoices() {
  const now = appState.audioContext?.currentTime ?? 0;
  appState.activeVoices = appState.activeVoices.filter((voice) => !voice.released && voice.endsAt > now - 0.05);
}

function stopAllVoices() {
  for (const voice of appState.activeVoices) {
    releaseVoice(voice, 0.02);
  }
  appState.activeVoices = [];
}

async function ensureAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  if (!appState.audioContext) {
    appState.audioContext = new AudioContextClass();
    appState.masterGain = appState.audioContext.createGain();
    appState.masterGain.gain.value = 0.2;
    appState.masterGain.connect(appState.audioContext.destination);
  }

  if (appState.audioContext.state === "suspended") {
    await appState.audioContext.resume();
  }

  if (!appState.preRendered) {
    for (const sampleMidi of buildSampleMidiSet()) {
      appState.noteBuffers.set(sampleMidi, createPianoLikeBuffer(appState.audioContext, sampleMidi));
    }
    appState.preRendered = true;
  }

  appState.audioReady = true;
}

function playTone(midi, velocity = 1) {
  if (!appState.audioReady || !appState.audioContext || !appState.masterGain || appState.noteBuffers.size === 0) {
    return;
  }

  pruneVoices();
  const polyphonyLimit = maxPolyphony();
  if (appState.activeVoices.length >= polyphonyLimit) {
    const voiceToRelease = appState.activeVoices[0];
    releaseVoice(voiceToRelease, 0.02);
    appState.activeVoices.shift();
  }

  const source = appState.audioContext.createBufferSource();
  const gain = appState.audioContext.createGain();
  const now = appState.audioContext.currentTime;
  const sampleMidi = nearestSampleMidi(midi);
  const playbackRate = 2 ** ((midi - sampleMidi) / 12);
  const isLeftHand = velocity <= 0.86;
  const useFilter = !appState.powerSaveMode && !isLeftHand;
  const attackPeak = appState.powerSaveMode ? 0.24 : (isLeftHand ? 0.22 : 0.34);
  const sustainLevel = appState.powerSaveMode ? 0.08 : (isLeftHand ? 0.09 : 0.14);
  const releaseSeconds = appState.powerSaveMode ? (isLeftHand ? 1.0 : 1.2) : (isLeftHand ? 1.25 : 1.8);
  const totalLifetime = releaseSeconds + 0.08;

  source.buffer = appState.noteBuffers.get(sampleMidi);
  source.playbackRate.value = playbackRate;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(attackPeak * velocity, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(sustainLevel * velocity, now + 0.14);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds);

  if (!useFilter) {
    source.connect(gain);
  } else {
    const filter = appState.audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(5200 - Math.max(0, midi - 72) * 24, now);
    filter.frequency.exponentialRampToValueAtTime(1550, now + 0.95);
    source.connect(filter);
    filter.connect(gain);
  }

  gain.connect(appState.masterGain);
  source.start(now);
  source.stop(now + totalLifetime);

  const voice = {
    source,
    gain,
    endsAt: now + totalLifetime,
    released: false
  };
  source.addEventListener("ended", () => {
    voice.released = true;
    appState.activeVoices = appState.activeVoices.filter((item) => item !== voice);
  });
  appState.activeVoices.push(voice);
}

function triggerAutoRightNote(note) {
  note.autoPlayed = true;
  note.hit = true;
  appState.score += 1;
  appState.combo += 1;
  dom.comboLabel.textContent = String(appState.combo);
  flashJudgeLine("auto");
  setHint("正在自动示范按键", 360);
  activateKeyForDuration(note.midi, note.hand, Math.max(180, note.duration * 60000 / appState.bpm));
  playTone(note.midi, 1);
}

function findFirstNoteIndex(minStartBeat) {
  let low = 0;
  let high = appState.noteData.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (appState.noteData[mid].start < minStartBeat) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function findLastNoteIndex(maxStartBeat) {
  let low = 0;
  let high = appState.noteData.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (appState.noteData[mid].start <= maxStartBeat) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low - 1;
}

function updateVisibleRange(beat) {
  const lookBehindBeats = appState.powerSaveMode ? 10 : 14;
  const lookAheadBeats = appState.approachBeats + (appState.powerSaveMode ? 1.5 : 2.5);
  const nextStart = Math.max(0, findFirstNoteIndex(beat - lookBehindBeats) - 2);
  const nextEnd = Math.min(appState.noteData.length - 1, findLastNoteIndex(beat + lookAheadBeats) + 2);

  appState.visibleRange = { start: nextStart, end: nextEnd };
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const nextRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + nextRadius, y);
  context.arcTo(x + width, y, x + width, y + height, nextRadius);
  context.arcTo(x + width, y + height, x, y + height, nextRadius);
  context.arcTo(x, y + height, x, y, nextRadius);
  context.arcTo(x, y, x + width, y, nextRadius);
  context.closePath();
}

function drawNoteCanvas(beat) {
  const context = appState.noteCanvasContext;
  if (!context || !dom.noteCanvas) {
    return 0;
  }

  const rect = dom.stage.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);

  let activeNotes = 0;

  for (let index = appState.visibleRange.start; index <= appState.visibleRange.end; index += 1) {
    const note = appState.noteData[index];
    const render = note?.render;
    if (!render) {
      continue;
    }

    const y = render.hitLineY - render.noteHeight - ((note.start - beat) / appState.approachBeats) * render.travel;
    const visibleByTime = beat >= note.start - appState.approachBeats - 0.5 && beat <= note.end + 1.25;
    const visible = visibleByTime && !(appState.hideLeftHandVisuals && note.hand === "left");

    if (!visible) {
      continue;
    }

    activeNotes += 1;
    const drawY = appState.powerSaveMode ? Math.round(y) : y;
    const alpha = note.missed ? 0.18 : note.hit ? (note.hand === "left" ? 0.24 : 0.4) : (note.hand === "left" ? 0.9 : 1);
    const radius = render.isBlack ? (note.hand === "right" ? 14 : 12) : (note.hand === "right" ? 18 : 14);
    const gradient = context.createLinearGradient(0, drawY, 0, drawY + render.noteHeight);

    if (note.hand === "right" && !render.isBlack) {
      gradient.addColorStop(0, "#8fd9ff");
      gradient.addColorStop(1, "#3d86ea");
    } else if (note.hand === "right" && render.isBlack) {
      gradient.addColorStop(0, "#294662");
      gradient.addColorStop(1, "#0f1722");
    } else if (note.hand === "left" && !render.isBlack) {
      gradient.addColorStop(0, "#ffd098");
      gradient.addColorStop(1, "#d97b35");
    } else {
      gradient.addColorStop(0, "#6f4628");
      gradient.addColorStop(1, "#3a2416");
    }

    context.save();
    context.globalAlpha = alpha;
    drawRoundedRect(context, render.x, drawY, render.width, render.noteHeight, radius);
    context.fillStyle = gradient;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = render.isBlack ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.24)";
    context.stroke();

    if (!appState.powerSaveMode) {
      context.beginPath();
      context.moveTo(render.x + 4, drawY + 4);
      context.lineTo(render.x + render.width - 4, drawY + 4);
      context.strokeStyle = "rgba(255,255,255,0.18)";
      context.stroke();
    }

    context.fillStyle = render.isBlack ? "rgba(245,248,252,0.96)" : "#fffdf7";
    context.font = `${appState.powerSaveMode ? 13 : 16}px "Noto Serif SC", "Songti SC", serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(pitchNameFromMidi(note.midi), render.x + render.width / 2, drawY + Math.min(render.noteHeight / 2, 20));
    context.restore();
  }

  return activeNotes;
}

function updateScene(timestamp = performance.now()) {
  if (timestamp - appState.lastRenderTimestamp < appState.frameIntervalMs) {
    requestAnimationFrame(updateScene);
    return;
  }

  appState.lastRenderTimestamp = timestamp;
  const beat = currentBeat();
  let activeNotes = 0;

  const duration = appState.songMeta?.durationSeconds ?? 0;
  const currentSeconds = (beat * 60) / appState.bpm;
  const progressText = `${Math.floor(currentSeconds / 60)}:${String(Math.floor(currentSeconds % 60)).padStart(2, "0")} / ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`;
  dom.phraseLabel.textContent = progressText;
  updateVisibleRange(beat);

  for (let index = appState.visibleRange.start; index <= appState.visibleRange.end; index += 1) {
    const note = appState.noteData[index];
    if (!note) {
      continue;
    }

    if (appState.autoPlay && appState.playing && note.interactive && !note.autoPlayed && beat >= note.start) {
      triggerAutoRightNote(note);
    }

    if (!appState.autoPlay && note.interactive && !note.hit && !note.missed && beat > note.start + appState.hitWindow) {
      note.missed = true;
      appState.combo = 0;
      dom.comboLabel.textContent = "0";
      flashJudgeLine("miss");
      setHint("有音符漏按了，试着对准点击线", 700);
    }
  }

  activeNotes = drawNoteCanvas(beat);

  syncDefaultHint(activeNotes > 0 ? "蓝色右手、暖色左手，现在双手都需要自己弹" : "下一段旋律即将进入");

  if (appState.songMeta && currentSeconds > appState.songMeta.durationSeconds + 1) {
    appState.playing = false;
    appState.pausedBeat = 0;
    setHint("演示结束，可以重新开始", 0);
  }

  dom.scoreLabel.textContent = `${appState.score} / ${appState.totalInteractiveNotes}`;
  requestAnimationFrame(updateScene);
}

function handleKeyPress(midi, fromAutoPlay, hold = false) {
  const beat = currentBeat();
  const pending = appState.noteData
    .filter((note) => note.midi === midi && note.interactive && !note.hit && !note.missed)
    .sort((a, b) => Math.abs(a.start - beat) - Math.abs(b.start - beat));
  const target = pending[0];

  if (hold) {
    holdKey(midi, target?.hand || "right");
  } else {
    const sustainMs = target ? Math.max(160, target.duration * 60000 / appState.bpm) : 160;
    activateKeyForDuration(midi, target?.hand || "right", sustainMs);
  }
  playTone(midi, target?.hand === "left" ? 0.85 : 1);

  if (target && Math.abs(target.start - beat) <= appState.hitWindow + (fromAutoPlay ? 0.25 : 0)) {
    target.hit = true;
    appState.score += 1;
    appState.combo += 1;
    dom.comboLabel.textContent = String(appState.combo);
    flashJudgeLine(fromAutoPlay ? "auto" : "good");
    setHint(fromAutoPlay ? "正在自动示范按键" : `${target.hand === "left" ? "左手" : "右手"}命中`, 360);
  } else if (!fromAutoPlay) {
    appState.combo = 0;
    dom.comboLabel.textContent = "0";
    flashJudgeLine("miss");
    setHint("再等音符落到点击线附近会更容易", 700);
  }
}

function resetTimeline() {
  stopAllVoices();
  appState.noteData = appState.songMeta.notes.map((note) => ({
    ...note,
    hit: false,
    missed: false,
    autoPlayed: false
  }));
  appState.totalInteractiveNotes = appState.noteData.filter((note) => note.interactive).length;
  appState.visibleRange = { start: 0, end: -1 };
  appState.lastRenderTimestamp = 0;
  appState.score = 0;
  appState.combo = 0;
  appState.pausedBeat = 0;
  dom.scoreLabel.textContent = "0";
  dom.comboLabel.textContent = "0";
  setHint("蓝色右手、暖色左手都需要你来弹", 0);
  layoutNoteGeometry();
}

function togglePlayback() {
  if (appState.playing) {
    appState.pausedBeat = currentBeat();
    appState.playing = false;
    setHint("已暂停", 0);
    return;
  }

  appState.startedAt = performance.now();
  appState.playing = true;
  setHint(appState.autoPlay ? "正在自动示范按键" : "跟着双手音符点击", 500);
}

function restartPlayback() {
  appState.playing = false;
  resetTimeline();
}

async function loadSongById(songId) {
  const songRef = appState.songLibrary.find((item) => item.id === songId);
  if (!songRef) {
    throw new Error(`Unknown song: ${songId}`);
  }

  const response = await fetch(songRef.file);
  if (!response.ok) {
    throw new Error(`Failed to load song file: ${songRef.file}`);
  }

  const song = await response.json();
  appState.selectedSongId = songId;
  configurePage(song);
  resetTimeline();
  onResize();
}

function handleKeyboardShortcut(event) {
  const shortcut = keyboardShortcuts.find((item) => item.key === event.key.toLowerCase());
  if (!shortcut) {
    return;
  }

  ensureAudio().catch(() => {});
  handleKeyPress(shortcut.midi, false);
}

async function handleSongChange(event) {
  const nextSongId = event.target.value;
  if (!nextSongId || nextSongId === appState.selectedSongId) {
    return;
  }

  appState.playing = false;
  appState.pausedBeat = 0;
  await loadSongById(nextSongId);
  setHint("已切换到新的简化练习曲目", 900);
}

function onResize() {
  applyPerformanceProfile({ notify: true });
  renderKeyboard();
  createLanes();
  resizeNoteCanvas();
  layoutNoteGeometry();
}

function configurePage(song) {
  const practiceSong = appState.simplifyArrangement ? simplifySong(song) : song;
  appState.songMeta = practiceSong;
  appState.bpm = practiceSong.bpm;
  const visibleNotes = practiceSong.notes;
  const visibleMin = Math.min(...visibleNotes.map((note) => note.midi));
  const visibleMax = Math.max(...visibleNotes.map((note) => note.midi));
  appState.keyRange = {
    min: Math.max(24, visibleMin - 2),
    max: Math.min(108, visibleMax + 2)
  };

  dom.pageTitle.textContent = `《${song.title}》钢琴指引演示`;
  dom.pageLead.textContent = `这个页面现在支持多首 MIDI 曲目切换。当前曲目是《${song.title}》，并继续使用新手简化编配：右手保留主旋律，左手改成低音骨架，方便同时看见双手。`;
  dom.metaValues[0].textContent = "Imported MIDI";
  dom.metaValues[1].textContent = `${practiceSong.bpm} BPM`;
  dom.metaValues[2].textContent = appState.simplifyArrangement ? "新手简化版" : "MIDI 瀑布流";

  const cards = [...dom.infoCards];
  cards[0].innerHTML = `
    <h2>这版先验证什么</h2>
    <ul>
      <li>支持多首 MIDI 曲目切换</li>
      <li>右手保留主旋律：${practiceSong.rightHandCount} 个音符</li>
      <li>左手简化成低音骨架：${practiceSong.leftHandCount} 个音符</li>
      <li>双手都需要自己弹，不自动播放左手</li>
      <li>整首时长约 ${practiceSong.durationSeconds.toFixed(1)} 秒</li>
    </ul>
  `;

  cards[1].innerHTML = `
    <h2>简化信息</h2>
    <div class="mapping-grid">
      <span>BPM = ${practiceSong.bpm}</span>
      <span>原始总音符 = ${song.noteCount}</span>
      <span>简化后总音符 = ${practiceSong.noteCount}</span>
      <span>右手：原 ${song.rightHandCount} -> 简 ${practiceSong.rightHandCount}</span>
      <span>左手：原 ${song.leftHandCount} -> 简 ${practiceSong.leftHandCount}</span>
      <span>练习音域 = ${pitchNameFromMidi(visibleMin)} 到 ${pitchNameFromMidi(visibleMax)}</span>
      <span>当前曲目 = ${song.title}</span>
    </div>
  `;

  cards[2].innerHTML = `
    <h2>说明</h2>
    <p>
      当前版本直接使用文件 <code>${song.sourceFile}</code> 生成页面数据。
      这 4 首曲子都会统一走同一套新手简化规则：
      右手如果同一时刻有叠音，只保留最上面的主旋律音；左手每次和弦只保留最低音骨架。
      同时把双手都压进更容易练的音区里，减少跨度，让手机上练习也更容易跟上。
    </p>
  `;
}

async function loadSongData() {
  const response = await fetch("./song-library.json");
  if (!response.ok) {
    throw new Error("Failed to load song-library.json");
  }

  const library = await response.json();
  appState.songLibrary = library.songs || [];
  appState.selectedSongId = library.defaultSongId || appState.songLibrary[0]?.id || null;
  populateSongSelect();

  if (!appState.selectedSongId) {
    throw new Error("No songs available");
  }

  await loadSongById(appState.selectedSongId);
}

async function init() {
  applyPerformanceProfile();
  await loadSongData();

  dom.startButton.addEventListener("click", () => {
    ensureAudio().catch(() => {});
    togglePlayback();
  });

  dom.restartButton.addEventListener("click", () => {
    restartPlayback();
  });

  dom.speedRange.addEventListener("input", (event) => {
    appState.speed = Number(event.target.value);
    dom.speedValue.textContent = `${appState.speed.toFixed(2)}x`;
  });

  dom.autoplayToggle.addEventListener("change", (event) => {
    appState.autoPlay = event.target.checked;
    setHint(`自动示范双手${appState.autoPlay ? "已开启" : "已关闭"}`, 900);
  });

  dom.songSelect?.addEventListener("change", (event) => {
    handleSongChange(event).catch((error) => {
      console.error(error);
      setHint("??????", 0);
    });
  });

  dom.fullscreenButton?.addEventListener("click", () => {
    toggleStageFullscreen().catch((error) => {
      console.error(error);
      setHint("??????", 0);
    });
  });

  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", handleKeyboardShortcut);
  document.addEventListener("fullscreenchange", () => {
    syncFullscreenUI();
    onResize();
  });
  syncFullscreenUI();
  requestAnimationFrame(updateScene);
}

init().catch((error) => {
  console.error(error);
  setHint("加载 MIDI 数据失败", 0);
});

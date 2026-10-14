import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@2.3.0/+esm";

const KEY = "com.geezsheets.geezradio/state";
const SAVED_KEY = "geezradio/playlists/v1";
const $ = (id) => document.getElementById(id);
const blank = () => ({ queue: [], index: -1, playing: false, position: 0, updatedAt: Date.now(), loop: "off", revision: 0, sounds: [], soundEvent: null });
let state = blank();
let gm = false;
let musicPlayer = null;
let soundPlayer = null;
let musicReady = false;
let soundReady = false;
let unlocked = false;
let activeId = null;
let observedRevision = -1;
let observedSoundNonce = null;
let writeBusy = false;
let playlists = loadLocal();

function say(message) { $("status").textContent = message; }

function parseYouTubeId(input) {
  const value = String(input || "").trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id;
    if (host === "youtu.be") id = url.pathname.split("/")[1];
    if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(shorts|live|embed)\//.test(url.pathname)) id = url.pathname.split("/")[2];
    }
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
}

function cleanTrack(track) {
  const id = parseYouTubeId(typeof track === "string" ? track : track?.id);
  if (!id) return null;
  return { id, name: String(typeof track === "object" ? track.name || "" : "").trim().slice(0, 100) || `YouTube ${id}` };
}

function cleanState(value) {
  if (!value || typeof value !== "object") return blank();
  const queue = (Array.isArray(value.queue) ? value.queue : []).map(cleanTrack).filter(Boolean).slice(0, 60);
  const sounds = (Array.isArray(value.sounds) ? value.sounds : []).map(cleanTrack).filter(Boolean).slice(0, 30);
  const soundEvent = value.soundEvent && typeof value.soundEvent === "object"
    ? { id: parseYouTubeId(value.soundEvent.id), nonce: String(value.soundEvent.nonce || ""), stop: value.soundEvent.stop === true }
    : null;
  return {
    queue,
    sounds,
    soundEvent,
    index: Math.max(-1, Math.min(Number.isInteger(value.index) ? value.index : -1, queue.length - 1)),
    playing: value.playing === true,
    position: Math.max(0, Number(value.position) || 0),
    updatedAt: Number(value.updatedAt) || Date.now(),
    loop: ["off", "all", "one"].includes(value.loop) ? value.loop : "off",
    revision: Number(value.revision) || 0
  };
}

async function commit(change) {
  if (!gm || writeBusy) return;
  writeBusy = true;
  try {
    const metadata = await OBR.room.getMetadata();
    const previous = cleanState(metadata[KEY]);
    const next = cleanState(typeof change === "function" ? change(previous) : { ...previous, ...change });
    next.revision = previous.revision + 1;
    next.updatedAt = Date.now();
    await OBR.room.setMetadata({ [KEY]: next });
  } catch (error) { say(`Room update failed: ${error.message}`); }
  finally { writeBusy = false; }
}

function currentTrack() { return state.queue[state.index] || null; }
function elapsed() { return state.playing ? state.position + Math.max(0, (Date.now() - state.updatedAt) / 1000) : state.position; }
function makeButton(label, action, title = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", action);
  return button;
}

function renderQueue() {
  const list = $("queue");
  list.replaceChildren();
  if (!state.queue.length) { list.textContent = "Queue is empty"; return; }
  state.queue.forEach((track, i) => {
    const row = document.createElement("div");
    row.className = `queueItem${i === state.index ? " active" : ""}`;
    const name = document.createElement("span");
    name.textContent = `${i + 1}. ${track.name}${i === state.index ? " · now" : ""}`;
    row.append(name);
    if (gm) {
      row.append(makeButton("▶", () => commit(s => ({ ...s, index: i, playing: true, position: 0 })), "Play this track"));
      row.append(makeButton("✎", () => {
        const replacement = window.prompt("Rename track", track.name);
        if (replacement === null || !replacement.trim()) return;
        commit(s => ({ ...s, queue: s.queue.map((t, j) => j === i ? { ...t, name: replacement.trim().slice(0, 100) } : t) }));
      }, "Rename"));
      row.append(makeButton("×", () => commit(s => {
        const queue = s.queue.filter((_, j) => j !== i);
        const index = i < s.index ? s.index - 1 : i === s.index ? Math.min(i, queue.length - 1) : s.index;
        return { ...s, queue, index, playing: queue.length ? s.playing && i !== s.index : false, position: 0 };
      }), "Remove"));
    }
    list.append(row);
  });
}

function renderSounds() {
  const list = $("soundButtons");
  list.replaceChildren();
  if (!state.sounds.length) { list.textContent = "No sound effects yet"; return; }
  state.sounds.forEach((sound, i) => {
    const card = document.createElement("div");
    card.className = "soundCard";
    const trigger = makeButton(`▶ ${sound.name}`, () => commit(s => ({ ...s, soundEvent: { id: sound.id, nonce: `${Date.now()}-${Math.random()}`, stop: false } })));
    trigger.disabled = !gm;
    card.append(trigger);
    if (gm) card.append(makeButton("×", () => commit(s => ({ ...s, sounds: s.sounds.filter((_, j) => j !== i) })), "Remove sound"));
    list.append(card);
  });
}

function display() {
  const track = currentTrack();
  $("nowTitle").textContent = track?.name || "Nothing playing";
  $("nowId").textContent = track ? `youtube.com/watch?v=${track.id}` : "";
  $("playPause").textContent = state.playing ? "⏸ Pause" : "▶ Play";
  $("loop").textContent = `Loop: ${state.loop[0].toUpperCase() + state.loop.slice(1)}`;
  for (const id of ["playPause", "skip"]) $(id).disabled = !gm || !track;
  for (const id of ["loop", "clear"]) $(id).disabled = !gm || (id === "clear" && !state.queue.length);
  $("stopSound").disabled = !gm;
  $("gmSection").hidden = !gm;
  $("soundFormArea").hidden = !gm;
  renderQueue();
  renderSounds();
}

function syncMusic(force = false) {
  if (!musicReady || !musicPlayer) return;
  const track = currentTrack();
  if (!track) { if (activeId) musicPlayer.stopVideo(); activeId = null; return; }
  const position = elapsed();
  if (activeId !== track.id || force) {
    activeId = track.id;
    if (unlocked && state.playing) musicPlayer.loadVideoById({ videoId: track.id, startSeconds: position });
    else musicPlayer.cueVideoById({ videoId: track.id, startSeconds: position });
  } else if (unlocked && state.playing) {
    if (Math.abs(musicPlayer.getCurrentTime() - position) > 3) musicPlayer.seekTo(position, true);
    musicPlayer.playVideo();
  } else musicPlayer.pauseVideo();
  musicPlayer.setVolume(Number($("volume").value));
}

function syncSound() {
  const event = state.soundEvent;
  if (!soundReady || !event || event.nonce === observedSoundNonce) return;
  observedSoundNonce = event.nonce;
  if (event.stop) { soundPlayer.stopVideo(); return; }
  if (event.id) {
    if (unlocked) soundPlayer.loadVideoById(event.id);
    else { soundPlayer.cueVideoById(event.id); say("Press Enable audio to hear soundboard clips."); }
    soundPlayer.setVolume(Number($("volume").value));
  }
}

function receive(metadata) {
  const next = cleanState(metadata[KEY]);
  if (next.revision === observedRevision) return;
  const oldId = currentTrack()?.id;
  state = next;
  observedRevision = next.revision;
  display();
  syncMusic(oldId !== currentTrack()?.id);
  syncSound();
}

function advance() {
  commit(s => {
    if (!s.queue.length) return { ...s, playing: false };
    if (s.loop === "one") return { ...s, playing: true, position: 0 };
    if (s.index + 1 >= s.queue.length) {
      return s.loop === "all" ? { ...s, index: 0, playing: true, position: 0 } : { ...s, playing: false, position: 0 };
    }
    return { ...s, index: s.index + 1, playing: true, position: 0 };
  });
}

function loadLocal() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return Array.isArray(list) ? list.filter(x => x && typeof x.name === "string" && Array.isArray(x.queue)).slice(0, 50) : [];
  } catch { return []; }
}

function saveLocal() { localStorage.setItem(SAVED_KEY, JSON.stringify(playlists)); }

function renderPlaylists() {
  const list = $("playlists");
  list.replaceChildren();
  if (!playlists.length) { list.textContent = "No saved playlists"; return; }
  playlists.forEach((playlist, i) => {
    const row = document.createElement("div");
    row.className = "queueItem";
    const title = document.createElement("span");
    title.textContent = `${playlist.name} (${playlist.queue.length} tracks)`;
    row.append(title);
    if (gm) row.append(makeButton("Load", () => commit(s => ({ ...s, queue: playlist.queue.map(cleanTrack).filter(Boolean), index: playlist.queue.length ? 0 : -1, position: 0, playing: false })), "Replace shared queue"));
    row.append(makeButton("×", () => { playlists.splice(i, 1); saveLocal(); renderPlaylists(); }, "Delete local playlist"));
    list.append(row);
  });
}

function loadYouTube() {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = resolve;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => reject(new Error("Couldn't load YouTube API"));
    document.head.append(script);
  });
}

async function start() {
  await OBR.onReady(async () => {
    gm = (await OBR.player.getRole()) === "GM";
    $("role").textContent = gm ? "GM controls" : "Player listening";
    $("connection").textContent = "Connected";
    receive(await OBR.room.getMetadata());
    OBR.room.onMetadataChange(receive);
    OBR.player.onChange(p => { gm = p.role === "GM"; $("role").textContent = gm ? "GM controls" : "Player listening"; display(); renderPlaylists(); });
    await loadYouTube();
    musicPlayer = new YT.Player("player", {
      height: "195", width: "350", playerVars: { playsinline: 1, controls: 1, origin: location.origin },
      events: {
        onReady() { musicReady = true; syncMusic(true); },
        onStateChange(event) { if (event.data === YT.PlayerState.ENDED && gm && state.playing) advance(); },
        onError(event) { say(`Music video error ${event.data}. Video may not allow embedding.`); },
        onAutoplayBlocked() { say("Browser blocked autoplay. Press Enable audio and play inside YouTube if needed."); }
      }
    });
    soundPlayer = new YT.Player("soundPlayer", {
      height: "90", width: "160", playerVars: { playsinline: 1, controls: 1, origin: location.origin },
      events: {
        onReady() { soundReady = true; /* Do not replay old sound events on initial load */ observedSoundNonce = state.soundEvent?.nonce || null; },
        onError(event) { say(`Sound effect error ${event.data}. Video may block embeds.`); }
      }
    });
  });
}

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => {
    for (const tab of document.querySelectorAll(".tab")) tab.hidden = tab.id !== `tab-${button.dataset.tab}`;
    for (const control of document.querySelectorAll("[data-tab]")) control.classList.toggle("selected", control === button);
  });
}

$("addForm").addEventListener("submit", event => {
  event.preventDefault();
  const id = parseYouTubeId($("url").value);
  if (!id) return say("Please paste a valid YouTube video link or ID.");
  if (state.queue.length >= 60) return say("Queue limit is 60 tracks.");
  const name = $("trackName").value.trim() || `YouTube ${id}`;
  commit(s => ({ ...s, queue: [...s.queue, { id, name }], index: s.index < 0 ? 0 : s.index }));
  $("url").value = "";
  $("trackName").value = "";
});
$("playPause").onclick = () => commit(s => ({ ...s, playing: !s.playing, position: s.playing ? (musicReady ? musicPlayer.getCurrentTime() : elapsed()) : s.position }));
$("skip").onclick = advance;
$("loop").onclick = () => commit(s => ({ ...s, loop: { off: "all", all: "one", one: "off" }[s.loop] }));
$("clear").onclick = () => commit(s => ({ ...s, queue: [], index: -1, playing: false, position: 0 }));
$("enable").onclick = () => {
  unlocked = true;
  if (musicReady && currentTrack()) {
    musicPlayer.unMute();
    musicPlayer.loadVideoById({ videoId: currentTrack().id, startSeconds: elapsed() });
    if (!state.playing) musicPlayer.pauseVideo();
  }
  if (soundReady) soundPlayer.unMute();
  $("enable").textContent = "✓ Audio enabled";
  say("Keep this panel open. YouTube may require a click inside the player for initial playback.");
};
$("volume").oninput = () => {
  $("volumeNumber").textContent = `${$("volume").value}%`;
  if (musicReady) musicPlayer.setVolume(Number($("volume").value));
  if (soundReady) soundPlayer.setVolume(Number($("volume").value));
};
$("savePlaylistForm").onsubmit = event => {
  event.preventDefault();
  const name = $("playlistName").value.trim();
  if (!name || !state.queue.length) return say("Name the playlist and add some tracks first.");
  const existing = playlists.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing >= 0 && !window.confirm(`Replace saved playlist “${name}”?`)) return;
  if (existing >= 0) playlists.splice(existing, 1);
  playlists.push({ name, queue: state.queue.map(t => ({ ...t })) });
  if (playlists.length > 50) playlists.shift();
  try { saveLocal(); renderPlaylists(); say(`Saved playlist: ${name}`); } catch { say("Unable to save: browser storage is unavailable or full."); }
};
$("exportPlaylists").onclick = () => {
  const blob = new Blob([JSON.stringify({ format: "geezradio-playlists-v1", playlists }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "geezradio-playlists.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("importPlaylists").onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== "geezradio-playlists-v1" || !Array.isArray(data.playlists)) throw new Error("Unsupported file");
    const imported = data.playlists.slice(0, 50).filter(x => x && typeof x.name === "string" && Array.isArray(x.queue)).map(x => ({ name: x.name.slice(0, 70), queue: x.queue.map(cleanTrack).filter(Boolean).slice(0, 60) }));
    const byName = new Map(playlists.map(p => [p.name.toLowerCase(), p]));
    for (const item of imported) byName.set(item.name.toLowerCase(), item);
    playlists = [...byName.values()].slice(-50);
    saveLocal(); renderPlaylists(); say(`Imported ${imported.length} playlists.`);
  } catch (error) { say(`Import failed: ${error.message}`); }
  event.target.value = "";
};
$("soundForm").onsubmit = event => {
  event.preventDefault();
  const id = parseYouTubeId($("soundUrl").value);
  const name = $("soundName").value.trim();
  if (!id || !name) return say("Enter a sound name and valid YouTube URL.");
  if (state.sounds.length >= 30) return say("Soundboard limit is 30 clips.");
  commit(s => ({ ...s, sounds: [...s.sounds, { id, name }] }));
  $("soundUrl").value = ""; $("soundName").value = "";
};
$("stopSound").onclick = () => commit(s => ({ ...s, soundEvent: { id: null, nonce: `${Date.now()}-${Math.random()}`, stop: true } }));
renderPlaylists();
start().catch(error => { $("connection").textContent = "Error"; say(`Startup failed: ${error.message}`); });

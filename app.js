import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@2.3.0/+esm";

const ROOT = "https://geezjonny.github.io/geezradio/";
const GITHUB = "https://api.github.com/repos/geezjonny/geezradio/contents/";
const KEY = "com.geezsheets.geezradio/state";
const SAVED_KEY = "geezradio/playlists/v2";
const AUDIO_EXTENSIONS = /\.(mp3|ogg|wav|m4a)$/i;
const $ = id => document.getElementById(id);

const music = new Audio();
const effect = new Audio();
music.preload = "auto";
effect.preload = "auto";

let gm = false;
let unlocked = false;
let roomState = emptyState();
let stateSeen = "";
let currentMusicPath = "";
let currentSoundNonce = null;
let library = { music: [], sounds: [] };
let playlists = loadPlaylists();
let pendingWrites = Promise.resolve();

function emptyState() {
  return {
    queue: [], index: -1, playing: false, position: 0,
    updatedAt: Date.now(), loop: "off", revision: 0,
    soundEvent: null, playbackId: "", updateId: ""
  };
}

function status(message) { $("status").textContent = message; }

function audioPath(value, folder = "music") {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  let path = raw;
  if (raw.startsWith(ROOT)) path = raw.slice(ROOT.length);
  if (!path.includes("/")) path = `${folder}/${path}`;
  const chunks = path.split("/").map(piece => {
    try { return decodeURIComponent(piece); } catch { return piece; }
  });
  if (chunks.length < 2 || !["music", "sounds"].includes(chunks[0]) ||
      chunks.some(piece => !piece || piece === "." || piece === "..") ||
      !AUDIO_EXTENSIONS.test(chunks.at(-1))) return null;
  return chunks.map(encodeURIComponent).join("/");
}

function playableUrl(path) { return ROOT + path; }
function titleForPath(path) {
  return decodeURIComponent(path.split("/").pop()).replace(AUDIO_EXTENSIONS, "")
    .replace(/[_-]+/g, " ").trim();
}
function cleanTrack(item) {
  const path = audioPath(typeof item === "string" ? item : item?.path);
  if (!path) return null;
  const name = String(typeof item === "object" ? item.name || "" : "").trim();
  return { path, name: (name || titleForPath(path)).slice(0, 100) };
}
function cleanState(input) {
  if (!input || typeof input !== "object") return emptyState();
  const queue = (Array.isArray(input.queue) ? input.queue : [])
    .map(cleanTrack).filter(Boolean).slice(0, 40);
  const rawEvent = input.soundEvent;
  const soundEvent = rawEvent && typeof rawEvent === "object" ? {
    path: rawEvent.path ? audioPath(rawEvent.path, "sounds") : null,
    nonce: String(rawEvent.nonce || ""),
    stop: rawEvent.stop === true,
    at: Number(rawEvent.at) || 0
  } : null;
  return {
    queue,
    index: Math.max(-1, Math.min(Number.isInteger(input.index) ? input.index : -1, queue.length - 1)),
    playing: input.playing === true,
    position: Math.max(0, Number(input.position) || 0),
    updatedAt: Number(input.updatedAt) || Date.now(),
    loop: ["off", "all", "one"].includes(input.loop) ? input.loop : "off",
    revision: Number(input.revision) || 0,
    soundEvent,
    playbackId: String(input.playbackId || ""),
    updateId: String(input.updateId || "")
  };
}

function commit(change, { restart = false } = {}) {
  if (!gm) return Promise.resolve();
  pendingWrites = pendingWrites.then(async () => {
    if (!gm) return;
    const existing = cleanState((await OBR.room.getMetadata())[KEY]);
    const changed = change(existing);
    if (changed === existing) return;
    const updated = cleanState(changed);
    updated.revision = existing.revision + 1;
    updated.updateId = crypto.randomUUID();
    if (restart) updated.playbackId = crypto.randomUUID();
    const oldPath = existing.queue[existing.index]?.path;
    const newPath = updated.queue[updated.index]?.path;
    const unchangedPlayback = !restart && oldPath === newPath &&
      existing.playing === updated.playing &&
      existing.position === updated.position;
    updated.updatedAt = unchangedPlayback ? existing.updatedAt : Date.now();
    await OBR.room.setMetadata({ [KEY]: updated });
  }).catch(error => {
    status(`Unable to update room: ${error.message}`);
  });
  return pendingWrites;
}

function currentTrack() { return roomState.queue[roomState.index] || null; }
function elapsed(state = roomState) {
  return state.playing
    ? state.position + Math.max(0, (Date.now() - state.updatedAt) / 1000)
    : state.position;
}
function button(label, handler, tooltip = "") {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.title = tooltip;
  el.addEventListener("click", handler);
  return el;
}

function renderQueue() {
  const parent = $("queue");
  parent.replaceChildren();
  if (!roomState.queue.length) { parent.textContent = "No tracks queued."; return; }
  roomState.queue.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = `queueItem${index === roomState.index ? " active" : ""}`;
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${track.name}`;
    row.append(label);
    if (gm) {
      row.append(button("▶", () => commit(s => ({ ...s, index, playing: true, position: 0 }), { restart: true }), "Play"));
      row.append(button("↑", () => moveTrack(index, -1), "Move up"));
      row.append(button("↓", () => moveTrack(index, 1), "Move down"));
      row.append(button("×", () => commit(s => {
        const queue = s.queue.filter((_, i) => i !== index);
        const nextIndex = index < s.index ? s.index - 1 :
          index === s.index ? Math.min(index, queue.length - 1) : s.index;
        return { ...s, queue, index: nextIndex,
          playing: index === s.index ? false : s.playing, position: index === s.index ? 0 : elapsed(s) };
      }), "Remove"));
    }
    parent.append(row);
  });
}
function moveTrack(index, direction) {
  commit(s => {
    const target = index + direction;
    if (target < 0 || target >= s.queue.length) return s;
    const queue = [...s.queue];
    [queue[index], queue[target]] = [queue[target], queue[index]];
    const selected = s.index === index ? target : s.index === target ? index : s.index;
    return { ...s, queue, index: selected, position: elapsed(s) };
  });
}

function renderSoundboard() {
  const parent = $("soundButtons");
  parent.replaceChildren();
  if (!library.sounds.length) {
    parent.textContent = "Upload audio files to sounds/, then press Refresh sounds.";
    return;
  }
  for (const track of library.sounds) {
    const control = button(`▶ ${track.name}`, () => {
      commit(s => ({ ...s, soundEvent: {
        path: track.path, nonce: `${Date.now()}-${Math.random()}`, at: Date.now(), stop: false
      } }));
    });
    control.disabled = !gm;
    parent.append(control);
  }
}

function display() {
  const track = currentTrack();
  $("nowTitle").textContent = track?.name || "Nothing playing";
  $("nowPath").textContent = track?.path || "";
  $("playPause").textContent = roomState.playing ? "⏸ Pause" : "▶ Play";
  $("loop").textContent = `Loop: ${roomState.loop}`;
  for (const id of ["playPause", "skip"]) $(id).disabled = !gm || !track;
  for (const id of ["loop", "clear"]) $(id).disabled = !gm;
  $("stopSound").disabled = !gm;
  $("gmMusic").hidden = !gm;
  renderQueue();
  renderSoundboard();
}

function musicSync(force = false) {
  const track = currentTrack();
  const path = track?.path || "";
  if (path !== currentMusicPath) {
    music.pause();
    currentMusicPath = path;
    music.removeAttribute("src");
    if (path) music.src = playableUrl(path);
    music.load();
    force = true;
  }
  if (!track) return;
  const seek = () => {
    if (path !== currentMusicPath) return;
    const target = elapsed();
    try {
      if (Number.isFinite(target) && (force || Math.abs(music.currentTime - target) > 2.5)) {
        music.currentTime = target;
      }
    } catch { /* Metadata is not loaded yet. */ }
  };
  if (music.readyState >= 1) seek();
  else music.addEventListener("loadedmetadata", seek, { once: true });
  if (roomState.playing && unlocked) {
    music.play().catch(() => status("Playback blocked. Click Enable audio to resume."));
  } else {
    music.pause();
  }
}

function soundSync() {
  const event = roomState.soundEvent;
  if (!event || event.nonce === currentSoundNonce) return;
  currentSoundNonce = event.nonce;
  effect.pause();
  if (event.stop || !event.path) { effect.removeAttribute("src"); return; }
  // Don't play sound effects fired before this listener was enabled.
  if (!unlocked || Date.now() - event.at > 12000) return;
  effect.src = playableUrl(event.path);
  effect.currentTime = 0;
  effect.play().catch(() => status("Sound blocked. Click Enable audio."));
}

function receive(metadata) {
  const next = cleanState(metadata[KEY]);
  const signature = JSON.stringify(next);
  if (signature === stateSeen) return;
  const old = roomState;
  const oldTrack = old.queue[old.index]?.path;
  roomState = next;
  stateSeen = signature;
  display();
  const newTrack = currentTrack()?.path;
  const playbackChanged = old.playing !== next.playing ||
    old.position !== next.position || old.updatedAt !== next.updatedAt;
  const restarted = old.playbackId !== next.playbackId;
  if (oldTrack !== newTrack || playbackChanged || restarted) musicSync(oldTrack !== newTrack || restarted);
  soundSync();
}

function advance() {
  return commit(s => {
    if (!s.queue.length) return { ...s, playing: false };
    if (s.loop === "one") return { ...s, playing: true, position: 0 };
    if (s.index + 1 < s.queue.length) {
      return { ...s, index: s.index + 1, playing: true, position: 0 };
    }
    return s.loop === "all"
      ? { ...s, index: 0, position: 0, playing: true }
      : { ...s, position: 0, playing: false };
  }, { restart: true });
}
music.addEventListener("ended", () => { if (gm && roomState.playing) advance(); });
music.addEventListener("error", () => {
  if (music.src) status("Cannot load music. Confirm the MP3 exists in GitHub Pages.");
});
effect.addEventListener("error", () => {
  if (effect.src) status("Cannot load sound effect. Check the sounds/ filename.");
});

async function fetchFolder(folder) {
  const response = await fetch(`${GITHUB}${folder}?ref=main`, { cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const items = await response.json();
  if (!Array.isArray(items)) throw new Error("Expected a GitHub folder");
  return items.filter(item => item.type === "file" && AUDIO_EXTENSIONS.test(item.name))
    .map(item => cleanTrack({ path: item.path, name: titleForPath(item.path) }))
    .filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
async function refreshFolder(folder) {
  try {
    const results = await fetchFolder(folder);
    library[folder] = results;
    if (folder === "music") {
      const select = $("musicLibrary");
      select.replaceChildren();
      for (const song of results) {
        const option = document.createElement("option");
        option.value = song.path;
        option.textContent = song.name;
        select.append(option);
      }
    }
    renderSoundboard();
    status(`Loaded ${results.length} ${folder} files from GitHub.`);
  } catch (error) {
    status(`Couldn't list ${folder}/: ${error.message}. You can still enter a music file path manually.`);
  }
}

function loadPlaylists() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return cleanPlaylists(saved);
  } catch { return []; }
}
function cleanPlaylists(items) {
  return (Array.isArray(items) ? items : []).filter(item => item && typeof item === "object")
    .slice(0, 50).map(item => ({
      name: String(item.name || "Unnamed").slice(0, 70),
      queue: (Array.isArray(item.queue) ? item.queue : []).map(cleanTrack).filter(Boolean).slice(0, 40)
    }));
}
function savePlaylists() { localStorage.setItem(SAVED_KEY, JSON.stringify(playlists)); }
function renderPlaylists() {
  const parent = $("playlists");
  parent.replaceChildren();
  if (!playlists.length) { parent.textContent = "No playlists saved yet."; return; }
  playlists.forEach((playlist, index) => {
    const row = document.createElement("div");
    row.className = "queueItem";
    const label = document.createElement("span");
    label.textContent = `${playlist.name} (${playlist.queue.length} tracks)`;
    row.append(label);
    if (gm) row.append(button("Load", () => commit(s => ({
      ...s, queue: playlist.queue.map(cleanTrack).filter(Boolean),
      index: playlist.queue.length ? 0 : -1, playing: false, position: 0
    }))));
    row.append(button("×", () => {
      playlists.splice(index, 1);
      savePlaylists(); renderPlaylists();
    }, "Delete playlist on this device"));
    parent.append(row);
  });
}

for (const tabButton of document.querySelectorAll("[data-tab]")) {
  tabButton.addEventListener("click", () => {
    for (const tab of document.querySelectorAll(".tab")) {
      tab.hidden = tab.id !== `tab-${tabButton.dataset.tab}`;
    }
    for (const button of document.querySelectorAll("[data-tab]")) {
      button.classList.toggle("selected", button === tabButton);
    }
  });
}

$("enable").onclick = async () => {
  unlocked = true;
  // A user gesture is required by some browsers before sound is allowed.
  music.volume = Number($("volume").value) / 100;
  effect.volume = Number($("sfxVolume").value) / 100;
  musicSync(true);
  $("enable").textContent = "✓ Audio enabled";
  status("Audio enabled. Keep this panel open on each device.");
};
$("volume").oninput = () => {
  $("volumeNumber").textContent = `${$("volume").value}%`;
  music.volume = Number($("volume").value) / 100;
};
$("sfxVolume").oninput = () => {
  $("sfxVolumeNumber").textContent = `${$("sfxVolume").value}%`;
  effect.volume = Number($("sfxVolume").value) / 100;
};
$("playPause").onclick = () => commit(s => ({
  ...s, playing: !s.playing, position: elapsed(s)
}));
$("skip").onclick = advance;
$("loop").onclick = () => commit(s => ({
  ...s, loop: { off: "all", all: "one", one: "off" }[s.loop], position: elapsed(s)
}));
$("clear").onclick = () => commit(s => ({
  ...s, queue: [], index: -1, playing: false, position: 0
}));
$("refreshLibrary").onclick = () => refreshFolder("music");
$("refreshSounds").onclick = () => refreshFolder("sounds");
$("addFromLibrary").onclick = () => {
  const track = library.music.find(track => track.path === $("musicLibrary").value);
  if (!track) return status("Choose a track from the library first.");
  if (roomState.queue.length >= 40) return status("Queue limit is 40 tracks.");
  commit(s => ({ ...s, queue: [...s.queue, track], index: s.index < 0 ? 0 : s.index, position: elapsed(s) }));
};
$("addForm").onsubmit = event => {
  event.preventDefault();
  const path = audioPath($("url").value);
  if (!path) return status("Enter a path such as music/boss-theme.mp3");
  if (roomState.queue.length >= 40) return status("Queue limit is 40 tracks.");
  const track = { path, name: $("trackName").value.trim().slice(0, 100) || titleForPath(path) };
  commit(s => ({ ...s, queue: [...s.queue, track], index: s.index < 0 ? 0 : s.index, position: elapsed(s) }));
  $("url").value = "";
  $("trackName").value = "";
};
$("stopSound").onclick = () => commit(s => ({ ...s, soundEvent: {
  path: null, stop: true, nonce: `${Date.now()}-${Math.random()}`, at: Date.now()
} }));
$("savePlaylistForm").onsubmit = event => {
  event.preventDefault();
  const name = $("playlistName").value.trim();
  if (!name || !roomState.queue.length) return status("Add songs to the queue first.");
  const at = playlists.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (at >= 0 && !confirm(`Replace “${name}”?`)) return;
  if (at >= 0) playlists.splice(at, 1);
  playlists.push({ name, queue: roomState.queue.map(t => ({ ...t })) });
  playlists = playlists.slice(-50);
  try { savePlaylists(); renderPlaylists(); status(`Saved playlist: ${name}`); }
  catch (error) { status(`Save failed: ${error.message}`); }
};
$("exportPlaylists").onclick = () => {
  const blob = new Blob([JSON.stringify({ format: "geezradio-mp3-v2", playlists }, null, 2)],
    { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "geezradio-playlists.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("importPlaylists").onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== "geezradio-mp3-v2" || !Array.isArray(data.playlists)) {
      throw new Error("Expected a GeezRadio v2 playlist export");
    }
    const imported = cleanPlaylists(data.playlists);
    const combined = new Map(playlists.map(p => [p.name.toLowerCase(), p]));
    for (const item of imported) combined.set(item.name.toLowerCase(), item);
    playlists = [...combined.values()].slice(-50);
    savePlaylists(); renderPlaylists(); status(`Imported ${imported.length} playlists.`);
  } catch (error) { status(`Import failed: ${error.message}`); }
  event.target.value = "";
};

async function start() {
  await OBR.onReady(async () => {
    gm = (await OBR.player.getRole()) === "GM";
    $("role").textContent = gm ? "GM controls" : "Player listener";
    $("connection").textContent = "Connected";
    const metadata = await OBR.room.getMetadata();
    // Ignore stale sound events when initially joining.
    currentSoundNonce = metadata[KEY]?.soundEvent?.nonce || null;
    receive(metadata);
    renderPlaylists();
    OBR.room.onMetadataChange(receive);
    OBR.player.onChange(player => {
      gm = player.role === "GM";
      $("role").textContent = gm ? "GM controls" : "Player listener";
      display(); renderPlaylists();
    });
    await Promise.all([refreshFolder("music"), refreshFolder("sounds")]);
  });
}

// Correct minor clock drift while music is playing, without resetting the source.
setInterval(() => {
  if (!unlocked || !roomState.playing || !currentTrack() || music.readyState < 1) return;
  if (Math.abs(music.currentTime - elapsed()) > 4) musicSync();
}, 12000);
renderPlaylists();
start().catch(error => {
  $("connection").textContent = "Error";
  status(`Startup failed: ${error.message}`);
});

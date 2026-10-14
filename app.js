import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@2.3.0/+esm";

const KEY = "com.geezsheets.geezradio/state";
const $ = (id) => document.getElementById(id);
const initial = () => ({ queue: [], index: -1, playing: false, position: 0, updatedAt: Date.now(), loop: "off", revision: 0 });
let state = initial();
let gm = false;
let player = null;
let apiReady = false;
let playerReady = false;
let unlocked = false;
let activeId = null;
let observedRevision = -1;
let writeBusy = false;

function parseYouTubeId(input) {
  const value = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = null;
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
    else if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(shorts|live|embed)\//.test(url.pathname)) id = url.pathname.split("/")[2];
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function cleanState(value) {
  if (!value || typeof value !== "object") return initial();
  const queue = Array.isArray(value.queue) ? value.queue.filter((x) => typeof x === "string" && /^[\w-]{11}$/.test(x)).slice(0, 60) : [];
  return {
    queue,
    index: Math.max(-1, Math.min(Number.isInteger(value.index) ? value.index : -1, queue.length - 1)),
    playing: value.playing === true,
    position: Math.max(0, Number(value.position) || 0),
    updatedAt: Number(value.updatedAt) || Date.now(),
    loop: ["off", "all", "one"].includes(value.loop) ? value.loop : "off",
    revision: Number(value.revision) || 0
  };
}

async function commit(changes) {
  if (!gm || writeBusy) return;
  writeBusy = true;
  try {
    const data = await OBR.room.getMetadata();
    const previous = cleanState(data[KEY]);
    const next = cleanState(typeof changes === "function" ? changes(previous) : { ...previous, ...changes });
    next.revision = previous.revision + 1;
    next.updatedAt = Date.now();
    await OBR.room.setMetadata({ [KEY]: next });
  } catch (error) {
    say(`Couldn't update queue: ${error.message}`);
  } finally {
    writeBusy = false;
  }
}

function currentVideo() {
  return state.queue[state.index] || null;
}

function elapsed() {
  return state.playing ? state.position + Math.max(0, (Date.now() - state.updatedAt) / 1000) : state.position;
}

function say(message) { $("status").textContent = message; }

function display() {
  const id = currentVideo();
  $("nowTitle").textContent = id ? `YouTube video · ${id}` : "Nothing playing";
  $("nowId").textContent = id ? `youtube.com/watch?v=${id}` : "";
  $("playPause").textContent = state.playing ? "⏸ Pause" : "▶ Play";
  $("loop").textContent = `Loop: ${state.loop[0].toUpperCase() + state.loop.slice(1)}`;
  $("playPause").disabled = !gm || !id;
  $("skip").disabled = !gm || !id;
  $("loop").disabled = !gm;
  $("clear").disabled = !gm || !state.queue.length;
  $("gmSection").hidden = !gm;
  const list = $("queue");
  list.replaceChildren();
  if (!state.queue.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "No songs yet";
    list.append(empty);
  }
  state.queue.forEach((videoId, i) => {
    const row = document.createElement("div");
    row.className = `queueItem${i === state.index ? " active" : ""}`;
    const text = document.createElement("span");
    text.textContent = `${i + 1}. ${videoId}${i === state.index ? " · now" : ""}`;
    row.append(text);
    if (gm) {
      const play = document.createElement("button");
      play.textContent = "Play";
      play.onclick = () => commit((s) => ({ ...s, index: i, playing: true, position: 0 }));
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = "Remove";
      remove.onclick = () => commit((s) => {
        const q = s.queue.filter((_, j) => j !== i);
        const newIndex = i < s.index ? s.index - 1 : i === s.index ? Math.min(i, q.length - 1) : s.index;
        return { ...s, queue: q, index: newIndex, playing: q.length ? s.playing && i !== s.index : false, position: 0 };
      });
      row.append(play, remove);
    }
    list.append(row);
  });
}

function syncPlayer(force = false) {
  if (!playerReady || !player) return;
  const id = currentVideo();
  if (!id) {
    if (activeId !== null) player.stopVideo();
    activeId = null;
    return;
  }
  const offset = elapsed();
  if (activeId !== id || force) {
    activeId = id;
    if (unlocked && state.playing) player.loadVideoById({ videoId: id, startSeconds: offset });
    else player.cueVideoById({ videoId: id, startSeconds: offset });
  } else if (unlocked && state.playing) {
    const now = player.getCurrentTime();
    if (Math.abs(now - offset) > 3) player.seekTo(offset, true);
    player.playVideo();
  } else player.pauseVideo();
  player.setVolume(Number($("volume").value));
}

function receive(metadata) {
  const next = cleanState(metadata[KEY]);
  if (next.revision === observedRevision) return;
  const prior = state;
  state = next;
  observedRevision = next.revision;
  display();
  const changed = currentVideo() !== (prior.queue[prior.index] || null);
  syncPlayer(changed);
}

function advance() {
  commit((s) => {
    if (!s.queue.length) return { ...s, playing: false };
    if (s.loop === "one") return { ...s, position: 0, playing: true };
    const next = s.index + 1;
    if (next >= s.queue.length) {
      if (s.loop === "all") return { ...s, index: 0, position: 0, playing: true };
      return { ...s, playing: false, position: 0 };
    }
    return { ...s, index: next, position: 0, playing: true };
  });
}

function loadYouTube() {
  return new Promise((resolve) => {
    if (window.YT?.Player) { resolve(); return; }
    window.onYouTubeIframeAPIReady = resolve;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => say("YouTube player couldn't load. Check your network/browser.");
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
    OBR.player.onChange((p) => {
      const previous = gm;
      gm = p.role === "GM";
      if (gm !== previous) display();
    });
    await loadYouTube();
    apiReady = true;
    player = new YT.Player("player", {
      height: "195", width: "350",
      playerVars: { playsinline: 1, controls: 1, origin: location.origin },
      events: {
        onReady() {
          playerReady = true;
          syncPlayer(true);
        },
        onStateChange(event) {
          if (event.data === YT.PlayerState.ENDED && gm && state.playing) advance();
        },
        onAutoplayBlocked() { say("Audio blocked by browser. Press Enable audio and then Play inside the YouTube player."); },
        onError(event) { say(`YouTube error ${event.data}. This video may not allow embedding; GM can skip it.`); }
      }
    });
  });
}

$("addForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = parseYouTubeId($("url").value);
  if (!id) { say("Paste a valid YouTube video URL (not a playlist URL alone)."); return; }
  if (state.queue.length >= 60) { say("Queue limit is 60 videos."); return; }
  commit((s) => ({
    ...s,
    queue: [...s.queue, id],
    index: s.index < 0 ? 0 : s.index
  }));
  $("url").value = "";
});

$("playPause").onclick = () => commit((s) => ({
  ...s, playing: !s.playing,
  position: s.playing ? (playerReady ? player.getCurrentTime() : elapsed()) : s.position
}));
$("skip").onclick = () => advance();
$("loop").onclick = () => commit((s) => ({ ...s, loop: { off: "all", all: "one", one: "off" }[s.loop] }));
$("clear").onclick = () => commit({ ...initial(), loop: state.loop });
$("enable").onclick = () => {
  unlocked = true;
  if (playerReady && currentVideo()) {
    player.unMute();
    player.loadVideoById({ videoId: currentVideo(), startSeconds: elapsed() });
    if (!state.playing) player.pauseVideo();
  }
  $("enable").textContent = "✓ Audio enabled";
  say("Keep this panel open to listen. Some browsers require pressing Play directly in the YouTube video.");
};
$("volume").oninput = () => {
  $("volumeNumber").textContent = `${$("volume").value}%`;
  if (playerReady) player.setVolume(Number($("volume").value));
};

start().catch((error) => {
  $("connection").textContent = "Error";
  say(`Startup failed: ${error.message}`);
});

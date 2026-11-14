// Icons: every emoji in the game is swapped for a drawn icon file from the "icons" folder.
// The pictures are Microsoft's Fluent Emoji (flat), MIT licence. To change one, replace its .svg file.
(function () {
  const MAP = {"⏭": "next-track-button", "⏳": "hourglass-not-done", "⏸": "pause-button", "▶": "play-button", "⚡": "high-voltage", "⛈": "cloud-with-lightning-and-rain", "⛏": "pick", "⛑": "rescue-workers-helmet", "⛓": "chains", "⛰": "mountain", "⛽": "fuel-pump", "✅": "check-mark-button", "➕": "plus", "⭐": "star", "🌀": "cyclone", "🌊": "water-wave", "🌧": "cloud-with-rain", "🌴": "palm-tree", "🍌": "banana", "🎉": "party-popper", "🎩": "top-hat", "🎭": "performing-arts", "🎮": "video-game", "🎲": "game-die", "🏃": "person-running", "🏝": "desert-island", "🐊": "crocodile", "🐻": "bear", "👀": "eyes", "👊": "oncoming-fist", "👋": "waving-hand", "👑": "crown", "👟": "running-shoe", "👹": "ogre", "💥": "collision", "💦": "sweat-droplets", "💨": "dashing-away", "💪": "flexed-biceps", "💫": "dizzy", "📖": "open-book", "🔇": "muted-speaker", "🔊": "speaker-high-volume", "🔌": "electric-plug", "🔓": "unlocked", "🔔": "bell", "🔗": "link", "🔥": "fire", "🔩": "nut-and-bolt", "🕳": "hole", "🕸": "spider-web", "😈": "smiling-face-with-horns", "😜": "winking-face-with-tongue", "😝": "squinting-face-with-tongue", "😡": "pouting-face", "😱": "face-screaming-in-fear", "🚣": "person-rowing-boat", "🚤": "speedboat", "🚨": "police-car-light", "🛟": "ring-buoy", "🛠": "hammer-and-wrench", "🛢": "oil-drum", "🤝": "handshake", "🤧": "sneezing-face", "🤫": "shushing-face", "🥶": "cold-face", "🦁": "lion", "🦺": "safety-vest", "🧊": "ice", "🧠": "brain", "🧢": "billed-cap", "🧰": "toolbox", "🩹": "adhesive-bandage", "🪂": "parachute", "🪓": "axe", "🪝": "hook", "🪢": "knot", "🪤": "mouse-trap", "🪵": "wood", "🫸": "rightwards-pushing-hand"};
  const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);
  const RE = new RegExp('(' + keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?', 'g');
  const imgs = {}; let left = 0, done; const ready = new Promise(r => done = r);
  for (const k of keys) { const im = new Image(); left++; im.onload = im.onerror = () => { if (--left === 0) { ICO.loaded = true; done(); } }; im.src = 'icons/' + MAP[k] + '.svg'; imgs[k] = im; }
  function split(text) {   // "a 🔥 b" -> [{t:'a '},{k:'🔥'},{t:' b'}]
    const out = []; let i = 0; RE.lastIndex = 0; let m;
    while ((m = RE.exec(text))) { if (m.index > i) out.push({ t: text.slice(i, m.index) }); out.push({ k: m[1] }); i = m.index + m[0].length; }
    if (i < text.length) out.push({ t: text.slice(i) }); return out;
  }
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, OPTION: 1, SELECT: 1, INPUT: 1, TITLE: 1 };
  function fixText(node) {
    const t = node.data; RE.lastIndex = 0; if (!t || !RE.test(t)) return;
    const p = node.parentNode; if (!p || SKIP[p.nodeName] || (p.closest && p.closest('#left'))) return;
    const parts = split(t), frag = document.createDocumentFragment();
    let first = parts[0] && parts[0].t !== undefined ? parts.shift().t : '';
    for (const s of parts) { if (s.t !== undefined) frag.appendChild(document.createTextNode(s.t)); else { const im = document.createElement('img'); im.className = 'ic'; im.alt = ''; im.draggable = false; im.src = imgs[s.k].src; frag.appendChild(im); } }
    node.data = first; p.insertBefore(frag, node.nextSibling);
  }
  function walk(root) {
    if (root.nodeType === 3) { fixText(root); return; } if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = []; while (w.nextNode()) list.push(w.currentNode); list.forEach(fixText);
  }
  const ICO = window.ICO = { MAP, RE, imgs, ready, loaded: false, split, walk };
  function boot() {
    walk(document.body);
    new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') fixText(m.target); else m.addedNodes.forEach(walk); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();

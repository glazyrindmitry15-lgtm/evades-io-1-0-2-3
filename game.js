(function () {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const authLoginEl = document.getElementById("auth-login");
  const authPassEl = document.getElementById("auth-pass");
  const authNickEl = document.getElementById("auth-nick");
  const authRegisterEl = document.getElementById("auth-register");
  const authSigninEl = document.getElementById("auth-signin");
  const authLogoutEl = document.getElementById("auth-logout");
  const authStatusEl = document.getElementById("auth-status");
  const authUserEl = document.getElementById("auth-user");
  const authWrapEl = document.getElementById("auth-wrap");

  let W = 1280;
  let H = 800;
  let ARENA = { x: 0, y: 0, w: 0, h: 0 };
  let NPC_LEFT = 0;
  let NPC_RIGHT = 0;
  let EXIT_W = 52;
  let LEFT_SAFE = 96;
  let RIGHT_SAFE = 96;
  let HEADER_H = 64;
  let FOOTER_H = 100;
  let BORDER_L = 20;
  let BORDER_T = 16;

  const MAX_AREA = 50;
  const HARD_GREAD_AREA = MAX_AREA + 1;
  const SAVE_KEY = "evades_cc_save_v2";
  const SETTINGS_KEY = "evades_cc_settings_v1";
  const AUTH_KEY = "evades_cc_auth_v1";
  const MAX_UP = 8;
  const ADMIN_SECRET = "123";
  const WS_URL =
    (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  let adminAuth = false;
  let godMode = false;
  let chatFocused = false;
  let maxAreaReached = 1;
  let finishedRun = false;
  let gameMode = "normal";
  const clearedAreas = new Set();

  const playerId = "p_" + Math.random().toString(36).slice(2, 10);
  let netName = "Игрок-" + Math.floor(1000 + Math.random() * 9000);
  let authToken = "";
  let authUsername = "";
  let remoteSaveTimer = 0;
  let ws = null;
  let wsOpen = false;
  let lastSentAt = 0;
  const otherPlayers = new Map();
  const REMOTE_LERP_SPEED = 14;
  const REMOTE_STALE_MS = 2200;
  const SLOW_AURA_RADIUS = 170;
  const REVIVE_TOUCH_RADIUS = 46;
  const ENEMY_AURA_RADIUS = 120;
  const ENEMY_AURA_SLOW = 0.58;
  let leaderboardEntries = [];
  const CROWNS = ["Платиновая", "Серебряная", "Бронзовая"];
  const FULL_RUN_CROWN = "Платиновая";

  function getViewRadius() {
    return Math.round(
      Math.max(100, Math.min(320, Math.min(W, H) * 0.24))
    );
  }

  const THEMES = {
    soft: {
      bg: "#0b1118",
      bg2: "#141d28",
      teal: "#4ca69e",
      tealDark: "#2a5f63",
      floorA: "#4b5563",
      floorB: "#3e4652",
      exitA: "#3a8f7d",
      exitB: "#71b8a9",
    },
    dusk: {
      bg: "#10101a",
      bg2: "#1e1a2c",
      teal: "#6f8ac1",
      tealDark: "#44537a",
      floorA: "#58506f",
      floorB: "#403c55",
      exitA: "#7e7ccf",
      exitB: "#b2a8ff",
    },
    mono: {
      bg: "#0f1113",
      bg2: "#1b2026",
      teal: "#7a8694",
      tealDark: "#505c67",
      floorA: "#595f66",
      floorB: "#4a4f55",
      exitA: "#6f7a84",
      exitB: "#9ca7b2",
    },
  };

  const settings = {
    theme: "soft",
    softFx: true,
    showGrid: true,
    zoom: 1.5,
    uiScale: 1,
  };

  function getTheme() {
    return THEMES[settings.theme] || THEMES.soft;
  }

  function getCameraZoom() {
    return settings.zoom;
  }

  function relayout() {
    W = Math.max(320, window.innerWidth || 800);
    H = Math.max(240, window.innerHeight || 600);
    canvas.width = W;
    canvas.height = H;

    HEADER_H = Math.round(Math.max(48, Math.min(80, H * 0.09)));
    FOOTER_H = Math.round(Math.max(72, Math.min(118, H * 0.14)));

    const SIDE = Math.max(6, Math.min(24, Math.floor(W * 0.006)));
    const vGap = 6;
    const midH = H - HEADER_H - FOOTER_H - vGap * 2;
    const ARENA_W = W - SIDE * 2;
    const ARENA_H = Math.max(
      140,
      Math.min(Math.floor(midH * 0.92), midH - 4)
    );
    const ARENA_Y =
      HEADER_H + vGap + Math.floor((midH - ARENA_H) / 2);

    ARENA = { x: SIDE, y: ARENA_Y, w: ARENA_W, h: ARENA_H };

    LEFT_SAFE = Math.round(
      Math.max(72, Math.min(180, ARENA.w * 0.075))
    );
    RIGHT_SAFE = LEFT_SAFE;
    EXIT_W = Math.round(
      Math.max(36, Math.min(70, ARENA.w * 0.02))
    );

    NPC_LEFT = ARENA.x + LEFT_SAFE;
    NPC_RIGHT = ARENA.x + ARENA.w - EXIT_W - RIGHT_SAFE;

    BORDER_L = Math.round(Math.max(10, Math.min(28, ARENA.w * 0.014)));
    BORDER_T = Math.round(Math.max(8, Math.min(22, ARENA.h * 0.055)));

    clampPlayer();
  }

  const HEROES = [
    {
      id: 0,
      className: "Factorb",
      displayName: "Factorb",
      playerName: "proffe",
      body: "#6b4423",
      stroke: "#8b6239",
      ring: "#c9a227",
      hasBoost: true,
      boostMul: 1.78,
      slowCostMult: 1,
      speedBonus: 0,
      desc: "Рывок (Space) и замедление врагов (Shift).",
    },
    {
      id: 1,
      className: "Veil",
      displayName: "Veil",
      playerName: "Spectre",
      body: "#3d5a80",
      stroke: "#6b8cc4",
      ring: "#9fd0ff",
      hasBoost: false,
      boostMul: 1,
      slowCostMult: 0.58,
      speedBonus: 35,
      desc: "Shift дешевле. Без рывка.",
    },
    {
      id: 2,
      className: "Iron",
      displayName: "Iron",
      playerName: "Bulwark",
      body: "#4a4a4a",
      stroke: "#8a8a8a",
      ring: "#d0d0d0",
      hasBoost: true,
      boostMul: 1.52,
      slowCostMult: 0.92,
      speedBonus: -45,
      desc: "Слабее рывок, плотный контроль.",
    },
  ];

  const UPGRADE_DEFS = [
    { key: "speed", title: "Скорость", unit: "+55 пикс/с / ур." },
    { key: "energy", title: "Энергия", unit: "+5 макс / ур." },
    { key: "slow", title: "Замедление", unit: "−8% расхода / ур." },
    { key: "boost", title: "Сила рывка", unit: "+0.09 множ. / ур." },
  ];

  function defaultSave() {
    return {
      points: 0,
      heroId: 0,
      up: { speed: 0, energy: 0, slow: 0, boost: 0 },
      unlockedCrowns: [],
      selectedCrown: "",
    };
  }

  let save = defaultSave();

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      save.points = Math.max(0, Number(p.points) || 0);
      save.heroId = Math.min(HEROES.length - 1, Math.max(0, Number(p.heroId) || 0));
      save.up = save.up || {};
      for (const k of ["speed", "energy", "slow", "boost"]) {
        save.up[k] = Math.min(MAX_UP, Math.max(0, Number(p.up && p.up[k]) || 0));
      }
      save.unlockedCrowns = Array.isArray(p.unlockedCrowns)
        ? p.unlockedCrowns.filter((x) => CROWNS.includes(x))
        : [];
      save.selectedCrown = CROWNS.includes(p.selectedCrown) ? p.selectedCrown : "";
    } catch (e) {
      save = defaultSave();
    }
  }

  function persistSave() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (e) {}
    scheduleRemoteSave();
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (typeof p.theme === "string" && THEMES[p.theme]) settings.theme = p.theme;
        settings.softFx = p.softFx !== false;
        settings.showGrid = p.showGrid !== false;
        if (typeof p.zoom === "number") settings.zoom = Math.max(1.25, Math.min(1.85, p.zoom));
        if (typeof p.uiScale === "number") settings.uiScale = Math.max(0.9, Math.min(1.25, p.uiScale));
      }
    } catch {}
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  function upgradeCost(level) {
    if (level >= MAX_UP) return Infinity;
    return Math.floor(18 + level * 22 + level * level * 5);
  }

  function addPoints(n) {
    save.points += n;
    persistSave();
  }

  function buyUpgrade(key) {
    const lv = save.up[key] || 0;
    if (lv >= MAX_UP) {
      appendChatLine("[система] " + key + ": уже максимум.", "line-err");
      return false;
    }
    const cost = upgradeCost(lv);
    if (save.points < cost) {
      appendChatLine("[система] Не хватает очков (" + cost + ").", "line-err");
      return false;
    }
    save.points -= cost;
    save.up[key] = lv + 1;
    persistSave();
    applyHeroStats();
    appendChatLine(
      "[система] Улучшено: " + key + " -> " + save.up[key] + "/" + MAX_UP + ".",
      "line-sys"
    );
    return true;
  }

  function handleInGameUpgradeHotkey(code) {
    if (screen !== "game") return;
    if (code === "Digit1") buyUpgrade("speed");
    else if (code === "Digit2") buyUpgrade("energy");
    else if (code === "Digit3") buyUpgrade("slow");
    else if (code === "Digit4") buyUpgrade("boost");
  }

  const PLAYER = {
    x: 0,
    y: 0,
    r: 16,
    movePerSec: 360,
    boostMul: 1.7,
    energy: 30,
    energyMax: 30,
    regenPerSec: 3.4,
    boostCostPerSec: 15,
    slowCostPerSec: 11,
  };

  let hero = HEROES[0];
  const keyDown = {};
  let area = 1;
  let npcs = [];
  let alive = true;
  let downedUntil = 0;
  let won = false;
  let startTime = performance.now();
  let lastNow = performance.now();
  let transitionLock = 0;
  let boosting = false;
  let slowing = false;
  let lastReviveAttemptAt = 0;

  let screen = "menu";
  let menuButtons = [];
  let heroCards = [];
  let upgradeRows = [];
  let winButtons = [];
  let crownButtons = [];
  let settingsButtons = [];

  function getHero() {
    return HEROES[save.heroId] || HEROES[0];
  }

  function applyHeroStats() {
    hero = getHero();
    const u = save.up;
    PLAYER.movePerSec =
      320 + u.speed * 55 + hero.speedBonus + u.energy * 8;
    PLAYER.energyMax = 30 + u.energy * 5;
    PLAYER.regenPerSec = 3.2 + u.energy * 0.28;
    const slowEff = 1 - 0.08 * u.slow;
    PLAYER.slowCostPerSec = 11 * Math.max(0.35, slowEff) * hero.slowCostMult;
    PLAYER.boostMul = hero.boostMul + (hero.hasBoost ? u.boost * 0.09 : 0);
    if (PLAYER.energy > PLAYER.energyMax) PLAYER.energy = PLAYER.energyMax;
  }

  function reviveWindowMs() {
    if (gameMode === "hard") return 60000;
    return area <= 10 ? 20000 : 60000;
  }

  function setHint(t) {
    hintEl.textContent = t || "";
  }

  function crownForRank(rank) {
    if (rank === 1) return "Платиновая";
    if (rank === 2) return "Серебряная";
    if (rank === 3) return "Бронзовая";
    return "";
  }

  function unlockFullRunCrown() {
    if (!save.unlockedCrowns.includes(FULL_RUN_CROWN)) {
      save.unlockedCrowns.push(FULL_RUN_CROWN);
      persistSave();
      appendChatLine(
        "[система] Награда за полное прохождение: корона " + FULL_RUN_CROWN + ".",
        "line-sys"
      );
    }
  }

  function updateLeaderboardUi() {
    const listEl = document.getElementById("leaderboard-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!leaderboardEntries.length) {
      const empty = document.createElement("div");
      empty.className = "lb-row";
      empty.textContent = "Пока пусто";
      listEl.appendChild(empty);
      return;
    }
    leaderboardEntries.slice(0, 10).forEach((e, idx) => {
      const row = document.createElement("div");
      row.className = "lb-row";
      const left = document.createElement("div");
      left.className = "lb-left";
      left.textContent =
        idx + 1 + ". " + e.name + (e.crown ? " — " + e.crown : "");
      const right = document.createElement("div");
      right.className = "lb-right";
      right.textContent = "Зона: " + e.bestArea;
      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);
    });
  }

  function setAuthStatus(text, isErr) {
    if (!authStatusEl) return;
    authStatusEl.textContent = text || "";
    authStatusEl.style.color = isErr ? "#f85149" : "#8b949e";
  }

  function persistAuth() {
    try {
      if (!authToken || !authUsername) {
        localStorage.removeItem(AUTH_KEY);
        return;
      }
      localStorage.setItem(
        AUTH_KEY,
        JSON.stringify({ token: authToken, username: authUsername })
      );
    } catch {}
  }

  function refreshAuthUi() {
    if (!authUserEl) return;
    if (authUsername) {
      authUserEl.textContent = "Вошел: " + authUsername + " (" + netName + ")";
    } else {
      authUserEl.textContent = "Гость";
    }
  }

  async function apiFetch(url, method, body, needAuth) {
    const headers = { "Content-Type": "application/json" };
    if (needAuth && authToken) headers.Authorization = "Bearer " + authToken;
    const res = await fetch(url, {
      method: method || "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || "Ошибка сервера");
    }
    return data || {};
  }

  function applyRemoteProfile(profile) {
    if (!profile) return;
    if (profile.nickname) netName = String(profile.nickname).slice(0, 24);
    if (authNickEl && netName) authNickEl.value = netName;
    if (typeof profile.bestArea === "number") {
      maxAreaReached = Math.max(maxAreaReached, Math.max(1, profile.bestArea));
    }
    if (profile.progress && typeof profile.progress === "object") {
      const p = profile.progress;
      save.points = Math.max(0, Number(p.points) || 0);
      save.heroId = Math.min(HEROES.length - 1, Math.max(0, Number(p.heroId) || 0));
      save.up = save.up || {};
      for (const k of ["speed", "energy", "slow", "boost"]) {
        save.up[k] = Math.min(MAX_UP, Math.max(0, Number(p.up && p.up[k]) || 0));
      }
      save.unlockedCrowns = Array.isArray(p.unlockedCrowns)
        ? p.unlockedCrowns.filter((x) => CROWNS.includes(x))
        : [];
      save.selectedCrown = CROWNS.includes(p.selectedCrown) ? p.selectedCrown : "";
      persistSave();
      applyHeroStats();
    } else if (Array.isArray(profile.unlockedCrowns)) {
      save.unlockedCrowns = profile.unlockedCrowns.filter((x) => CROWNS.includes(x));
      persistSave();
    }
    refreshAuthUi();
  }

  async function uploadProgressNow() {
    if (!authToken || !authUsername) return;
    try {
      await apiFetch(
        "/api/save",
        "POST",
        {
          nickname: netName,
          bestArea: Math.max(1, maxAreaReached),
          progress: save,
        },
        true
      );
    } catch (err) {
      setAuthStatus("Сохранение: " + err.message, true);
    }
  }

  function scheduleRemoteSave() {
    if (!authToken || !authUsername) return;
    if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
    remoteSaveTimer = setTimeout(() => {
      remoteSaveTimer = 0;
      uploadProgressNow();
    }, 700);
  }

  async function tryRestoreSession() {
    let raw = null;
    try {
      raw = localStorage.getItem(AUTH_KEY);
    } catch {}
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      authToken = String(parsed.token || "");
      authUsername = String(parsed.username || "");
    } catch {
      authToken = "";
      authUsername = "";
      persistAuth();
      return;
    }
    if (!authToken || !authUsername) return;
    try {
      const me = await apiFetch("/api/me", "GET", null, true);
      applyRemoteProfile(me);
      setAuthStatus("Аккаунт подключен", false);
    } catch {
      authToken = "";
      authUsername = "";
      persistAuth();
      setAuthStatus("Сессия истекла. Войдите снова.", true);
    }
  }

  function sendWs(type, payload) {
    if (!wsOpen || !ws) return;
    ws.send(JSON.stringify({ type, payload }));
  }

  function publishLeaderboardUpdate() {
    sendWs("leaderboard_update", { by: netName });
  }

  function connectWs() {
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      appendChatLine("[сеть] Ошибка запуска WebSocket: " + err.message, "line-err");
      return;
    }
    ws.addEventListener("open", () => {
      wsOpen = true;
      appendChatLine("[сеть] Подключено к серверу.", "line-sys");
      sendWs("hello", {
        id: playerId,
        name: netName,
        crown: save.selectedCrown || "",
        token: authToken || "",
      });
      sendWs("score", {
        id: playerId,
        name: netName,
        bestArea: maxAreaReached,
        token: authToken || "",
      });
    });
    ws.addEventListener("close", () => {
      wsOpen = false;
      appendChatLine("[сеть] Соединение закрыто.", "line-err");
    });
    ws.addEventListener("message", (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (!msg || !msg.type) return;
      if (msg.type === "players" && Array.isArray(msg.payload)) {
        const now = performance.now();
        const seen = new Set();
        msg.payload.forEach((p) => {
          if (!p || p.id === playerId) return;
          seen.add(p.id);
          const prev = otherPlayers.get(p.id);
          const targetX = Number(p.x) || 0;
          const targetY = Number(p.y) || 0;
          if (!prev) {
            otherPlayers.set(p.id, {
              ...p,
              x: targetX,
              y: targetY,
              tx: targetX,
              ty: targetY,
              lastSeenAt: now,
            });
            return;
          }
          prev.tx = targetX;
          prev.ty = targetY;
          prev.r = typeof p.r === "number" ? p.r : prev.r;
          prev.name = p.name || prev.name || "Игрок";
          prev.crown = p.crown || "";
          prev.alive = p.alive !== false;
          prev.downedUntil = Number(p.downedUntil) || 0;
          prev.area = Number(p.area) || prev.area || 1;
          prev.mode = p.mode || prev.mode || "normal";
          prev.lastSeenAt = now;
        });
        for (const [id, rp] of otherPlayers) {
          if (seen.has(id)) continue;
          if (now - (rp.lastSeenAt || 0) > REMOTE_STALE_MS) {
            otherPlayers.delete(id);
          }
        }
      } else if (msg.type === "chat" && msg.payload) {
        appendChatLine(msg.payload.name + ": " + msg.payload.text, "line-sys");
      } else if (msg.type === "leaderboard" && Array.isArray(msg.payload)) {
        leaderboardEntries = msg.payload;
        updateLeaderboardUi();
      } else if (msg.type === "crown_grants" && Array.isArray(msg.payload)) {
        let gotAny = false;
        msg.payload.forEach((grant) => {
          if (!grant || !CROWNS.includes(grant.crown)) return;
          const own =
            (authUsername && grant.account === authUsername) ||
            grant.legacyId === playerId ||
            grant.id === playerId;
          if (!own) return;
          if (!save.unlockedCrowns.includes(grant.crown)) {
            save.unlockedCrowns.push(grant.crown);
            gotAny = true;
          }
        });
        if (gotAny) {
          persistSave();
          appendChatLine("[система] Тебе выдали корону. Выбери ее в меню.", "line-sys");
        }
      } else if (msg.type === "system" && msg.payload && msg.payload.text) {
        appendChatLine("[сервер] " + msg.payload.text, "line-sys");
      } else if (msg.type === "revived" && msg.payload && msg.payload.id === playerId) {
        alive = true;
        downedUntil = 0;
        statusEl.textContent = "Тебя возродили союзники!";
        PLAYER.energy = Math.max(PLAYER.energy, Math.round(PLAYER.energyMax * 0.4));
      }
    });
  }

  function randomInRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function bossCountForArea(a) {
    if (a === 10) return 1;
    if (a === 20) return 2;
    if (a === 30) return 3;
    return 0;
  }

  function normalNpcCountForArea(a) {
    return 16 + a * 3 + Math.floor(a / 5) * 3;
  }

  function spawnNpcNormal() {
    const r = randomInRange(9, 15);
    return {
      x: randomInRange(NPC_LEFT + r + 14, NPC_RIGHT - r - 14),
      y: randomInRange(ARENA.y + r + 18, ARENA.y + ARENA.h - r - 18),
      r,
      vx: randomInRange(-320, 320) || 160,
      vy: randomInRange(-320, 320) || 160,
      kind: Math.random() < 0.34 ? "white" : "purple",
      boss: false,
    };
  }

  function spawnBoss() {
    const r = randomInRange(36, 46) * 5;
    return {
      x: randomInRange(NPC_LEFT + r + 20, NPC_RIGHT - r - 24),
      y: randomInRange(ARENA.y + r + 22, ARENA.y + ARENA.h - r - 22),
      r,
      vx: randomInRange(-130, 130) || 90,
      vy: randomInRange(-130, 130) || 90,
      kind: "boss",
      boss: true,
    };
  }

  function spawnAuraNpc() {
    const r = randomInRange(13, 19);
    return {
      x: randomInRange(NPC_LEFT + r + 14, NPC_RIGHT - r - 14),
      y: randomInRange(ARENA.y + r + 18, ARENA.y + ARENA.h - r - 18),
      r,
      vx: randomInRange(-220, 220) || 120,
      vy: randomInRange(-220, 220) || 120,
      kind: "aura",
      boss: false,
      auraR: ENEMY_AURA_RADIUS,
      auraSlow: ENEMY_AURA_SLOW,
    };
  }

  function spawnHunterNpc() {
    const r = randomInRange(12, 18);
    return {
      x: randomInRange(NPC_LEFT + r + 14, NPC_RIGHT - r - 14),
      y: randomInRange(ARENA.y + r + 18, ARENA.y + ARENA.h - r - 18),
      r,
      vx: randomInRange(-120, 120) || 90,
      vy: randomInRange(-120, 120) || 90,
      kind: "hunter",
      boss: false,
      chaseRange: randomInRange(170, 260),
      chaseSpeed: randomInRange(210, 275),
      aimJitter: randomInRange(18, 72),
      turnRate: randomInRange(2.1, 3.3),
      retargetAt: 0,
    };
  }

  function dist2(ax0, ay0, bx, by) {
    const dx = ax0 - bx;
    const dy = ay0 - by;
    return dx * dx + dy * dy;
  }

  function overlapsOthers(c, list) {
    for (const o of list) {
      const rr = c.r + o.r + 6;
      if (dist2(c.x, c.y, o.x, o.y) < rr * rr) return true;
    }
    return false;
  }

  function overlapsSpawn(c) {
    const sx = ARENA.x + LEFT_SAFE * 0.45 + PLAYER.r + 10;
    const sy = ARENA.y + ARENA.h / 2;
    const pad = PLAYER.r + c.r + 48;
    return dist2(c.x, c.y, sx, sy) < pad * pad;
  }

  function buildNpcsForArea(a) {
    const list = [];
    const n = normalNpcCountForArea(a);
    const b = bossCountForArea(a);
    const auraCount = Math.max(1, Math.floor(a / 3));
    let guard = 0;
    while (list.length < n && guard++ < 6000) {
      const c = spawnNpcNormal();
      if (!overlapsOthers(c, list) && !overlapsSpawn(c)) list.push(c);
    }
    for (let i = 0; i < auraCount; i++) {
      let gAura = 0;
      while (gAura++ < 1200) {
        const c = spawnAuraNpc();
        if (!overlapsOthers(c, list) && !overlapsSpawn(c)) {
          list.push(c);
          break;
        }
      }
    }
    for (let i = 0; i < b; i++) {
      let g2 = 0;
      while (g2++ < 900) {
        const c = spawnBoss();
        if (!overlapsOthers(c, list) && !overlapsSpawn(c)) {
          list.push(c);
          break;
        }
      }
    }
    return list;
  }

  function buildHardGreadNpcs() {
    const list = [];
    const normal = 44;
    const hunters = 16;
    const aura = 8;
    let guard = 0;
    while (list.length < normal && guard++ < 12000) {
      const c = spawnNpcNormal();
      if (!overlapsOthers(c, list) && !overlapsSpawn(c)) list.push(c);
    }
    for (let i = 0; i < aura; i++) {
      let gAura = 0;
      while (gAura++ < 2000) {
        const c = spawnAuraNpc();
        if (!overlapsOthers(c, list) && !overlapsSpawn(c)) {
          list.push(c);
          break;
        }
      }
    }
    for (let i = 0; i < hunters; i++) {
      let g2 = 0;
      while (g2++ < 2600) {
        const c = spawnHunterNpc();
        if (!overlapsOthers(c, list) && !overlapsSpawn(c)) {
          list.push(c);
          break;
        }
      }
    }
    list.push(spawnBoss(), spawnBoss(), spawnBoss());
    return list;
  }

  function spawnPlayerLeft() {
    PLAYER.x = ARENA.x + PLAYER.r + 48;
    PLAYER.y = ARENA.y + ARENA.h / 2;
  }

  function awardZoneClear() {
    const key = gameMode + ":" + area;
    if (clearedAreas.has(key)) return;
    addPoints(10 + area * 2 + (gameMode === "hard" ? 30 : 0));
    clearedAreas.add(key);
  }

  function startCampaign() {
    applyHeroStats();
    gameMode = "normal";
    area = 1;
    maxAreaReached = Math.max(maxAreaReached, area);
    finishedRun = false;
    won = false;
    alive = true;
    PLAYER.energy = PLAYER.energyMax;
    npcs = buildNpcsForArea(area);
    spawnPlayerLeft();
    startTime = performance.now();
    lastNow = performance.now();
    transitionLock = 0;
    boosting = false;
    slowing = false;
    statusEl.textContent = "";
    screen = "game";
    setHint(
      "Как в evades.io: вид сверху · WASD — движение · Space — аура замедления ·" +
        (hero.hasBoost ? " Shift — рывок ·" : "") +
        " выход справа · синяя полоса слева — назад · касание союзника = revive · R — арена 1"
    );
    sendWs("score", {
      id: playerId,
      name: netName,
      bestArea: maxAreaReached,
      token: authToken || "",
    });
  }

  function startHardGread() {
    applyHeroStats();
    gameMode = "hard";
    area = HARD_GREAD_AREA;
    won = false;
    alive = true;
    PLAYER.energy = PLAYER.energyMax;
    npcs = buildHardGreadNpcs();
    spawnPlayerLeft();
    startTime = performance.now();
    lastNow = performance.now();
    transitionLock = 0;
    boosting = false;
    slowing = false;
    statusEl.textContent = "";
    screen = "game";
    setHint("Hard Gread: есть шары-преследователи. Q — перезапуск hard зоны.");
  }

  function retryArea() {
    applyHeroStats();
    alive = true;
    downedUntil = 0;
    PLAYER.energy = PLAYER.energyMax;
    npcs = gameMode === "hard" ? buildHardGreadNpcs() : buildNpcsForArea(area);
    spawnPlayerLeft();
    transitionLock = 0;
    boosting = false;
    slowing = false;
    statusEl.textContent = "";
  }

  function respawnToArea1() {
    gameMode = "normal";
    area = 1;
    applyHeroStats();
    alive = true;
    won = false;
    downedUntil = 0;
    PLAYER.energy = PLAYER.energyMax;
    npcs = buildNpcsForArea(area);
    spawnPlayerLeft();
    transitionLock = performance.now() + 300;
    statusEl.textContent = "Не успели возродить. Телепорт на арену 1.";
  }

  function goMenu() {
    screen = "menu";
    won = false;
    alive = true;
    statusEl.textContent = "";
    setHint("Меню — клик по кнопкам. Без 3D, только 2D.");
  }

  function nextArea(now) {
    if (gameMode === "hard") {
      awardZoneClear();
      won = true;
      alive = false;
      statusEl.textContent = "Hard Gread пройден! R — заново.";
      return;
    }
    if (area >= MAX_AREA) {
      awardZoneClear();
      won = true;
      finishedRun = true;
      alive = false;
      unlockFullRunCrown();
      statusEl.textContent = "Финиш! R или кнопки на экране.";
      sendWs("score", {
        id: playerId,
        name: netName,
        bestArea: MAX_AREA,
        finished: true,
        token: authToken || "",
      });
      return;
    }
    awardZoneClear();
    area += 1;
    maxAreaReached = Math.max(maxAreaReached, area);
    if (area > MAX_AREA) {
      won = true;
      alive = false;
      return;
    }
    npcs = buildNpcsForArea(area);
    spawnPlayerLeft();
    transitionLock = now + 450;
    sendWs("score", {
      id: playerId,
      name: netName,
      bestArea: maxAreaReached,
      token: authToken || "",
    });
  }

  function prevArea() {
    if (gameMode !== "normal") return;
    if (area <= 1) return;
    area -= 1;
    npcs = buildNpcsForArea(area);
    spawnPlayerLeft();
    transitionLock = performance.now() + 300;
    statusEl.textContent = "Возврат на арену " + area;
  }

  function playerInSafeZone() {
    const px = PLAYER.x;
    if (px <= ARENA.x + LEFT_SAFE + PLAYER.r * 0.35) return true;
    const rs = ARENA.x + ARENA.w - EXIT_W - RIGHT_SAFE;
    if (px >= rs - PLAYER.r * 0.35) return true;
    return false;
  }

  function updateEnergy(dt) {
    if (won || screen !== "game") return;
    let drain = 0;
    if (boosting && alive && hero.hasBoost) drain += PLAYER.boostCostPerSec * dt;
    if (slowing && alive) drain += PLAYER.slowCostPerSec * dt;
    if (drain > 0) {
      PLAYER.energy -= drain;
      if (PLAYER.energy <= 0) {
        PLAYER.energy = 0;
        boosting = false;
        slowing = false;
      }
    } else if (alive && PLAYER.energy < PLAYER.energyMax) {
      PLAYER.energy = Math.min(
        PLAYER.energyMax,
        PLAYER.energy + PLAYER.regenPerSec * dt
      );
    }
  }

  function clampPlayer() {
    PLAYER.x = Math.max(
      ARENA.x + PLAYER.r,
      Math.min(ARENA.x + ARENA.w - PLAYER.r, PLAYER.x)
    );
    PLAYER.y = Math.max(
      ARENA.y + PLAYER.r,
      Math.min(ARENA.y + ARENA.h - PLAYER.r, PLAYER.y)
    );
  }

  function updatePlayer(dt) {
    if (!alive || won || screen !== "game") return;

    const sh =
      keyDown["ShiftLeft"] ||
      keyDown["ShiftRight"] ||
      keyDown["Shift"];
    slowing = (keyDown["Space"] || keyDown[" "]) && PLAYER.energy > 0;

    boosting =
      hero.hasBoost &&
      sh &&
      PLAYER.energy > 0;

    let enemyAuraSlow = 1;
    for (const b of npcs) {
      if (!b || b.kind !== "aura") continue;
      const rr = (b.auraR || ENEMY_AURA_RADIUS) + PLAYER.r;
      if (dist2(PLAYER.x, PLAYER.y, b.x, b.y) <= rr * rr) {
        enemyAuraSlow = Math.min(enemyAuraSlow, Number(b.auraSlow) || ENEMY_AURA_SLOW);
      }
    }
    const playerSlow = (slowing ? 0.68 : 1) * enemyAuraSlow;
    const sp =
      PLAYER.movePerSec *
      (boosting ? PLAYER.boostMul : 1) *
      playerSlow *
      dt;

    if (keyDown["KeyW"] || keyDown["ArrowUp"]) PLAYER.y -= sp;
    if (keyDown["KeyS"] || keyDown["ArrowDown"]) PLAYER.y += sp;
    if (keyDown["KeyA"] || keyDown["ArrowLeft"]) PLAYER.x -= sp;
    if (keyDown["KeyD"] || keyDown["ArrowRight"]) PLAYER.x += sp;

    clampPlayer();

    if (
      gameMode === "normal" &&
      area === 1 &&
      PLAYER.y <= ARENA.y + PLAYER.r + 2 &&
      PLAYER.x <= ARENA.x + LEFT_SAFE + 48
    ) {
      startHardGread();
      return;
    }

    const exitLeft = ARENA.x + ARENA.w - EXIT_W;
    if (
      performance.now() >= transitionLock &&
      PLAYER.x >= exitLeft - PLAYER.r * 0.15
    ) {
      nextArea(performance.now());
    }

    const backRight = ARENA.x + EXIT_W;
    if (
      performance.now() >= transitionLock &&
      PLAYER.x <= backRight + PLAYER.r * 0.15
    ) {
      prevArea();
    }
  }

  function bounceNpc(b) {
    const left = NPC_LEFT + b.r;
    const right = NPC_RIGHT - b.r;
    const top = ARENA.y + b.r;
    const bottom = ARENA.y + ARENA.h - b.r;

    if (b.x < left) {
      b.x = left;
      b.vx = Math.abs(b.vx);
    } else if (b.x > right) {
      b.x = right;
      b.vx = -Math.abs(b.vx);
    }
    if (b.y < top) {
      b.y = top;
      b.vy = Math.abs(b.vy);
    } else if (b.y > bottom) {
      b.y = bottom;
      b.vy = -Math.abs(b.vy);
    }
  }

  function updateNpcs(dt) {
    const auraOn = slowing && alive && screen === "game";
    const auraR2 = SLOW_AURA_RADIUS * SLOW_AURA_RADIUS;
    const now = performance.now();
    for (const b of npcs) {
      if (b.kind === "hunter") {
        const dx = PLAYER.x - b.x;
        const dy = PLAYER.y - b.y;
        const d2 = dx * dx + dy * dy;
        const rr = (b.chaseRange || 200) * (b.chaseRange || 200);
        if (d2 < rr && d2 > 0.0001) {
          if (now >= (b.retargetAt || 0)) {
            const jitter = b.aimJitter || 36;
            b.targetX = PLAYER.x + randomInRange(-jitter, jitter);
            b.targetY = PLAYER.y + randomInRange(-jitter, jitter);
            b.retargetAt = now + randomInRange(120, 280);
          }
          const tx = typeof b.targetX === "number" ? b.targetX : PLAYER.x;
          const ty = typeof b.targetY === "number" ? b.targetY : PLAYER.y;
          const tdx = tx - b.x;
          const tdy = ty - b.y;
          const td2 = tdx * tdx + tdy * tdy;
          if (td2 > 0.0001) {
            const d = Math.sqrt(td2);
            const sp = b.chaseSpeed || 240;
            const desiredVx = (tdx / d) * sp;
            const desiredVy = (tdy / d) * sp;
            const turn = Math.min(1, dt * (b.turnRate || 2.5));
            b.vx += (desiredVx - b.vx) * turn;
            b.vy += (desiredVy - b.vy) * turn;
          }
        }
      }
      let mul = 1;
      if (auraOn) {
        const dxA = b.x - PLAYER.x;
        const dyA = b.y - PLAYER.y;
        if (dxA * dxA + dyA * dyA <= auraR2) mul = 0.34;
      }
      b.x += b.vx * mul * dt;
      b.y += b.vy * mul * dt;
      bounceNpc(b);
    }
  }

  function updateRemotePlayers(dt, now) {
    const k = Math.min(1, dt * REMOTE_LERP_SPEED);
    for (const [id, p] of otherPlayers) {
      if (!p) continue;
      const tx = typeof p.tx === "number" ? p.tx : p.x;
      const ty = typeof p.ty === "number" ? p.ty : p.y;
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
      if (now - (p.lastSeenAt || 0) > REMOTE_STALE_MS + 1000) {
        otherPlayers.delete(id);
      }
    }
  }

  function checkHits() {
    if (!alive || won || screen !== "game") return;
    if (godMode) return;
    if (playerInSafeZone()) return;
    for (const b of npcs) {
      if (b.kind === "aura") {
        const ar = b.auraR || ENEMY_AURA_RADIUS;
        if (dist2(PLAYER.x, PLAYER.y, b.x, b.y) < ar * ar) {
          statusEl.textContent = "Ты в замедляющей ауре!";
        }
      }
      const rr = PLAYER.r + b.r;
      if (dist2(PLAYER.x, PLAYER.y, b.x, b.y) < rr * rr) {
        alive = false;
        downedUntil = performance.now() + reviveWindowMs();
        boosting = false;
        slowing = false;
        statusEl.textContent = gameMode === "hard"
          ? "Ты нокнут! 60с на возрождение другим игроком."
          : "Ты нокнут! Нужен союзник: E рядом для возрождения.";
        break;
      }
    }
  }

  function updateDownedState(now) {
    if (alive || won || screen !== "game") return;
    if (downedUntil <= 0) return;
    const left = Math.max(0, Math.ceil((downedUntil - now) / 1000));
    statusEl.textContent = "Нокнут: " + left + "с. Союзник рядом + E.";
    if (now >= downedUntil) {
      respawnToArea1();
    }
  }

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + "m " + (sec < 10 ? "0" : "") + sec + "s";
  }

  function drawBackground() {
    const t = getTheme();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, t.bg2);
    g.addColorStop(1, t.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawViewportVignette(vr) {
    const cx = W / 2;
    const cy = H / 2;
    const g = ctx.createRadialGradient(
      cx,
      cy,
      vr * 0.55,
      cx,
      cy,
      vr
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.82, settings.softFx ? "rgba(0,0,0,0.16)" : "rgba(0,0,0,0.25)");
    g.addColorStop(1, settings.softFx ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.88)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = settings.softFx ? "rgba(180,200,220,0.2)" : "rgba(46,196,182,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, vr, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawWorldInViewport() {
    const zoom = getCameraZoom();
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-PLAYER.x, -PLAYER.y);
    drawArena();
    drawNpcs();
    drawRemotePlayers();
    drawPlayerBody();
    drawPlayerOverhead();
    ctx.restore();
  }

  function drawSafeZones() {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(ARENA.x, ARENA.y, LEFT_SAFE, ARENA.h);
    const rx = ARENA.x + ARENA.w - EXIT_W - RIGHT_SAFE;
    ctx.fillRect(rx, ARENA.y, RIGHT_SAFE, ARENA.h);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ARENA.x, ARENA.y, LEFT_SAFE, ARENA.h);
    ctx.strokeRect(rx, ARENA.y, RIGHT_SAFE, ARENA.h);
    ctx.fillStyle = "rgba(200,210,220,0.2)";
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(ARENA.x + LEFT_SAFE / 2, ARENA.y + ARENA.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("SAFE", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(rx + RIGHT_SAFE / 2, ARENA.y + ARENA.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("SAFE", 0, 0);
    ctx.restore();
    ctx.textAlign = "left";
  }

  function drawArena() {
    const t = getTheme();
    const floorGrad = ctx.createLinearGradient(
      ARENA.x,
      ARENA.y,
      ARENA.x,
      ARENA.y + ARENA.h
    );
    floorGrad.addColorStop(0, t.floorA);
    floorGrad.addColorStop(1, t.floorB);
    ctx.fillStyle = t.tealDark;
    ctx.fillRect(ARENA.x - BORDER_L, ARENA.y, BORDER_L, ARENA.h);
    ctx.fillStyle = t.teal;
    ctx.fillRect(
      ARENA.x - BORDER_L,
      ARENA.y - BORDER_T,
      ARENA.w + BORDER_L,
      BORDER_T
    );
    ctx.fillStyle = floorGrad;
    ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.strokeStyle = settings.showGrid ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0)";
    ctx.lineWidth = 1;
    if (settings.showGrid) {
      for (let gx = ARENA.x + 24; gx < ARENA.x + ARENA.w; gx += 24) {
        ctx.beginPath();
        ctx.moveTo(gx, ARENA.y);
        ctx.lineTo(gx, ARENA.y + ARENA.h);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = "#2a3038";
    ctx.lineWidth = 2;
    ctx.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    drawSafeZones();

    const bx = ARENA.x;
    const bgBack = ctx.createLinearGradient(bx, ARENA.y, bx + EXIT_W, ARENA.y);
    bgBack.addColorStop(0, "#2b7fff");
    bgBack.addColorStop(1, "#78b0ff");
    ctx.fillStyle = bgBack;
    ctx.fillRect(bx, ARENA.y, EXIT_W, ARENA.h);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.strokeRect(bx, ARENA.y, EXIT_W, ARENA.h);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.save();
    ctx.translate(bx + EXIT_W / 2, ARENA.y + ARENA.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("BACK", 0, 0);
    ctx.restore();

    const ex = ARENA.x + ARENA.w - EXIT_W;
    const g = ctx.createLinearGradient(ex, ARENA.y, ex + EXIT_W, ARENA.y);
    g.addColorStop(0, t.exitA);
    g.addColorStop(1, t.exitB);
    ctx.fillStyle = g;
    ctx.fillRect(ex, ARENA.y, EXIT_W, ARENA.h);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.strokeRect(ex, ARENA.y, EXIT_W, ARENA.h);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.save();
    ctx.translate(ex + EXIT_W / 2, ARENA.y + ARENA.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("EXIT", 0, 0);
    ctx.restore();

    if (gameMode === "normal" && area === 1) {
      const upW = Math.max(56, Math.round(LEFT_SAFE * 0.9));
      const upH = 14;
      const upX = ARENA.x + 6;
      const upY = ARENA.y;
      const upGrad = ctx.createLinearGradient(upX, upY, upX + upW, upY);
      upGrad.addColorStop(0, "#9258ff");
      upGrad.addColorStop(1, "#d59cff");
      ctx.fillStyle = upGrad;
      ctx.fillRect(upX, upY, upW, upH);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.strokeRect(upX, upY, upW, upH);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("UP -> HARD", upX + 3, upY + upH + 14);
    }
  }

  function drawNpcs() {
    for (const b of npcs) {
      if (b.kind === "aura") {
        const ar = b.auraR || ENEMY_AURA_RADIUS;
        const ag = ctx.createRadialGradient(b.x, b.y, b.r, b.x, b.y, ar);
        ag.addColorStop(0, "rgba(255,140,80,0.22)");
        ag.addColorStop(1, "rgba(255,140,80,0)");
        ctx.fillStyle = ag;
        ctx.beginPath();
        ctx.arc(b.x, b.y, ar, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      if (b.kind === "boss") {
        ctx.fillStyle = "#c45c26";
        ctx.fill();
        ctx.strokeStyle = "#ff9a56";
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (b.kind === "white") {
        ctx.fillStyle = "#e8eaed";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (b.kind === "hunter") {
        ctx.fillStyle = "#d73a49";
        ctx.fill();
        ctx.strokeStyle = "#ff7b72";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(b.x - b.r * 0.5, b.y);
        ctx.lineTo(b.x + b.r * 0.5, b.y);
        ctx.strokeStyle = "rgba(255,255,255,0.65)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (b.kind === "aura") {
        ctx.fillStyle = "#f0883e";
        ctx.fill();
        ctx.strokeStyle = "#ffd0a8";
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y, Math.max(4, b.r * 0.42), 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = "#7b4397";
        ctx.fill();
        ctx.strokeStyle = "#b565d8";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function drawRemotePlayers() {
    for (const p of otherPlayers.values()) {
      if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
      if (Number(p.area || 1) !== area) continue;
      if ((p.mode || "normal") !== gameMode) continue;
      const r = typeof p.r === "number" ? p.r : PLAYER.r;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      const isDown = p.alive === false && Number(p.downedUntil) > Date.now();
      ctx.fillStyle = isDown ? "#a371f7" : "#2f81f7";
      ctx.fill();
      ctx.strokeStyle = isDown ? "#c9a2ff" : "#8cc2ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      const titleBase = p.crown ? p.name + " " + p.crown : p.name;
      const title = isDown ? titleBase + " [DOWN]" : titleBase;
      ctx.fillText(title || "Игрок", p.x, p.y - r - 12);
      ctx.textAlign = "left";
    }
  }

  function drawPlayerOverhead() {
    const px = PLAYER.x;
    const py = PLAYER.y;
    ctx.textAlign = "center";
    ctx.strokeStyle = boosting ? "#ffe066" : slowing ? "#88c0ff" : hero.ring;
    ctx.lineWidth = boosting || slowing ? 3 : 2;
    ctx.beginPath();
    ctx.arc(px, py - PLAYER.r - 9, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px system-ui, sans-serif";
    const nameWithCrown = save.selectedCrown
      ? hero.playerName + " " + save.selectedCrown
      : hero.playerName;
    ctx.fillText(nameWithCrown, px, py - PLAYER.r - 28);
    const bw = 72;
    const bh = 7;
    const bx = px - bw / 2;
    const by = py - PLAYER.r - 18;
    ctx.fillStyle = "#1e3a5f";
    ctx.fillRect(bx, by, bw, bh);
    const frac = alive || won ? PLAYER.energy / PLAYER.energyMax : 0;
    ctx.fillStyle = slowing ? "#6eb5ff" : boosting ? "#7ee787" : "#3d8fd1";
    ctx.fillRect(bx, by, bw * frac, bh);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.textAlign = "left";
  }

  function drawPlayerBody() {
    if (slowing && alive) {
      const g = ctx.createRadialGradient(
        PLAYER.x,
        PLAYER.y,
        PLAYER.r,
        PLAYER.x,
        PLAYER.y,
        SLOW_AURA_RADIUS
      );
      g.addColorStop(0, "rgba(88,166,255,0.26)");
      g.addColorStop(1, "rgba(88,166,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(PLAYER.x, PLAYER.y, SLOW_AURA_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(PLAYER.x, PLAYER.y, PLAYER.r, 0, Math.PI * 2);
    ctx.fillStyle = alive || won ? hero.body : "#4a4a4a";
    ctx.fill();
    ctx.strokeStyle = alive || won ? hero.stroke : "#666";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawHeader(now) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px system-ui, sans-serif";
    const title =
      won
        ? (gameMode === "hard" ? "Hard Gread — финиш" : "Central Core — финиш")
        : (gameMode === "hard" ? "Hard Gread" : "Central Core: Area " + area);
    ctx.fillText(title, W / 2, 30);
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillStyle = "#b1bac4";
    ctx.fillText(formatTime(now - startTime), W / 2, 52);
    ctx.fillStyle = "#8b949e";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(
      "Очки: " + save.points + " · Режим: " + (gameMode === "hard" ? "Hard Gread" : "Normal"),
      W / 2,
      72
    );
    if (godMode) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#3fb950";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText("GOD MODE", W - 12, 30);
    }
    ctx.textAlign = "left";
  }

  function drawFooter() {
    const ui = settings.uiScale || 1;
    const fy = H - FOOTER_H;
    const panel = ctx.createLinearGradient(0, fy, 0, H);
    panel.addColorStop(0, "rgba(18, 23, 32, 0.96)");
    panel.addColorStop(1, "rgba(8, 10, 14, 0.96)");
    ctx.fillStyle = panel;
    ctx.fillRect(0, fy, W, FOOTER_H);
    const pad = Math.round(20 * ui);
    const cy = fy + FOOTER_H / 2 + 10;

    const energyW = Math.min(440, Math.max(260, W * 0.36));
    const energyH = Math.round(18 * ui);
    const ex = W / 2 - energyW / 2;
    const ey = fy + 34;
    const eFrac = Math.max(0, Math.min(1, PLAYER.energy / PLAYER.energyMax));
    ctx.fillStyle = "#12263f";
    ctx.fillRect(ex, ey, energyW, energyH);
    const eg = ctx.createLinearGradient(ex, ey, ex + energyW, ey);
    eg.addColorStop(0, "#2ec4b6");
    eg.addColorStop(1, "#3d8fd1");
    ctx.fillStyle = eg;
    ctx.fillRect(ex, ey, energyW * eFrac, energyH);
    ctx.strokeStyle = "rgba(255,255,255,0.24)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ex, ey, energyW, energyH);

    const cur =
      PLAYER.movePerSec *
      (boosting && hero.hasBoost ? PLAYER.boostMul : 1) *
      (slowing ? 0.68 : 1);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e6edf3";
    ctx.font = "bold " + Math.round(16 * ui) + "px system-ui, sans-serif";
    ctx.fillText(
      "ENERGY " + Math.ceil(PLAYER.energy) + " / " + PLAYER.energyMax,
      W / 2,
      ey - 8
    );
    ctx.font = Math.round(13 * ui) + "px system-ui, sans-serif";
    ctx.fillStyle = "#8b949e";
    ctx.fillText(
      "Speed: " + Math.round(cur) + "  |  Regen: " + PLAYER.regenPerSec.toFixed(1),
      W / 2,
      ey + energyH + 16
    );

    const slot = Math.round(70 * ui);
    const gap = Math.round(12 * ui);
    const sy = fy + 22;

    const drawSkill = (x, active, title, key, onColor, offColor) => {
      ctx.fillStyle = active ? onColor : offColor;
      ctx.fillRect(x, sy, slot, slot);
      ctx.strokeStyle = active ? "#dbeafe" : "#596271";
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.strokeRect(x, sy, slot, slot);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(title, x + slot / 2, sy + slot / 2 - 6);
      ctx.fillStyle = "#b6c0cc";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(key, x + slot / 2, sy + slot / 2 + 14);
    };

    const leftX = pad;
    const leftX2 = leftX + slot + gap;
    const rightX2 = W - pad - slot;
    const rightX = rightX2 - slot - gap;

    drawSkill(
      leftX,
      hero.hasBoost && boosting,
      "BOOST",
      "Shift",
      "rgba(40,120,72,0.9)",
      "rgba(35,42,52,0.95)"
    );
    drawSkill(
      leftX2,
      slowing,
      "SLOW",
      "Space",
      "rgba(32,74,124,0.92)",
      "rgba(35,42,52,0.95)"
    );
    drawSkill(
      rightX,
      hero.hasBoost && boosting,
      "BOOST",
      "Shift",
      "rgba(40,120,72,0.9)",
      "rgba(35,42,52,0.95)"
    );
    drawSkill(
      rightX2,
      slowing,
      "SLOW",
      "Space",
      "rgba(32,74,124,0.92)",
      "rgba(35,42,52,0.95)"
    );

    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.fillText(hero.className + " · Zone " + area, pad, fy + 16);
    ctx.textAlign = "right";
    ctx.fillStyle = "#8b949e";
    ctx.fillText("Очки: " + save.points, W - pad, fy + 16);
    ctx.fillStyle = "#6e7681";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("UPG: 1 Speed  2 Energy  3 Slow  4 Boost", W - pad, fy + 32);
    ctx.textAlign = "left";
  }

  function drawWinOverlay() {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, HEADER_H, W, H - HEADER_H - FOOTER_H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 36px system-ui, sans-serif";
    ctx.fillText("Финиш!", W / 2, H / 2 - 55);
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = "#c9d1d9";
    ctx.fillText(MAX_AREA + " зон пройдено", W / 2, H / 2 - 12);
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillText("Очков: " + save.points, W / 2, H / 2 + 18);
    winButtons = [];
    const bw = 240;
    const bh = 48;
    const bx = W / 2 - bw / 2;
    const by1 = H / 2 + 48;
    const by2 = by1 + bh + 12;
    drawMenuBtn(bx, by1, bw, bh, "Снова (R)");
    drawMenuBtn(bx, by2, bw, bh, "В меню");
    winButtons.push(
      { x: bx, y: by1, w: bw, h: bh, action: "winRestart" },
      { x: bx, y: by2, w: bw, h: bh, action: "winMenu" }
    );
  }

  function drawMenuBtn(x, y, w, h, label) {
    ctx.fillStyle = "rgba(32, 42, 58, 0.96)";
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w / 2, y + h / 2 + 5);
    ctx.textAlign = "left";
  }

  function hit(mx, my, b) {
    return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
  }

  function drawMenuBg() {
    drawBackground();
    ctx.strokeStyle = settings.softFx ? "rgba(190,200,220,0.08)" : "rgba(46,196,182,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 64, 0);
      ctx.lineTo(i * 64 + 120, H);
      ctx.stroke();
    }
  }

  function drawMainMenu() {
    drawMenuBg();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.fillText("CENTRAL CORE", W / 2, 140);
    ctx.fillStyle = "#8b949e";
    ctx.font = "17px system-ui, sans-serif";
    ctx.fillText("Стиль evades.io — 2D сверху", W / 2, 182);
    ctx.fillStyle = "#58a6ff";
    ctx.font = "bold 19px system-ui, sans-serif";
    ctx.fillText("Очков: " + save.points, W / 2, 232);
    ctx.fillStyle = "#6e7681";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Герой: " + getHero().displayName, W / 2, 260);
    menuButtons = [];
    const bw = Math.min(300, W - 36);
    const bh = 50;
    const bx = W / 2 - bw / 2;
    let y = Math.min(310, Math.max(220, H * 0.36));
    const add = (label, action) => {
      drawMenuBtn(bx, y, bw, bh, label);
      menuButtons.push({ x: bx, y, w: bw, h: bh, action });
      y += bh + 14;
    };
    add("Играть", "play");
    add("Выбор героя", "heroes");
    add("Улучшения", "upgrades");
    add("Короны", "crowns");
    add("Настройки", "settings");
    ctx.textAlign = "left";
  }

  function drawCrownsMenu() {
    drawMenuBg();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("Короны", W / 2, 82);
    ctx.fillStyle = "#8b949e";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Награды топ-3 лидерборда", W / 2, 112);

    crownButtons = [];
    const rw = Math.min(620, W - 34);
    const lx = (W - rw) / 2;
    let y = 150;
    const rowH = 56;
    const rows = [{ id: "", title: "Без короны" }].concat(
      CROWNS.map((c) => ({ id: c, title: c }))
    );

    rows.forEach((row) => {
      const unlocked = row.id === "" || save.unlockedCrowns.includes(row.id);
      const selected = save.selectedCrown === row.id;
      ctx.fillStyle = selected ? "rgba(46,196,182,0.15)" : "rgba(20,26,36,0.95)";
      ctx.strokeStyle = selected ? "#2ec4b6" : "#30363d";
      ctx.fillRect(lx, y, rw, rowH);
      ctx.strokeRect(lx, y, rw, rowH);
      ctx.textAlign = "left";
      ctx.fillStyle = unlocked ? "#fff" : "#6e7681";
      ctx.font = "bold 15px system-ui, sans-serif";
      ctx.fillText(row.title, lx + 14, y + 23);
      ctx.fillStyle = unlocked ? "#8b949e" : "#f85149";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(unlocked ? "Доступно" : "Недоступно", lx + 14, y + 42);
      if (unlocked) crownButtons.push({ x: lx, y, w: rw, h: rowH, crown: row.id });
      y += rowH + 10;
    });

    menuButtons = [];
    const bbw = 200;
    const bbh = 44;
    drawMenuBtn(W / 2 - bbw / 2, y + 18, bbw, bbh, "Назад");
    menuButtons.push({
      x: W / 2 - bbw / 2,
      y: y + 18,
      w: bbw,
      h: bbh,
      action: "backMenu",
    });
    ctx.textAlign = "left";
  }

  function wrapText(text, x, y, maxW, lineH) {
    const words = text.split(" ");
    let line = "";
    let yy = y;
    for (let n = 0; n < words.length; n++) {
      const test = line + words[n] + " ";
      if (ctx.measureText(test).width > maxW && n > 0) {
        ctx.fillText(line, x, yy);
        line = words[n] + " ";
        yy += lineH;
      } else line = test;
    }
    ctx.fillText(line, x, yy);
  }

  function drawHeroSelect() {
    const t = getTheme();
    drawMenuBg();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("Герои", W / 2, 88);
    ctx.fillStyle = "#8b949e";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Клик по карточке", W / 2, 118);
    heroCards = [];
    const gap = Math.max(8, Math.round(W * 0.015));
    const cardW = Math.min(380, Math.max(200, Math.floor((W - 48 - gap * 2) / 3)));
    const cardH = Math.min(168, Math.max(130, Math.round(H * 0.2)));
    const totalW = cardW * 3 + gap * 2;
    const startX = (W - totalW) / 2;
    const cy = 150;
    HEROES.forEach((h, i) => {
      const x = startX + i * (cardW + gap);
      const sel = save.heroId === h.id;
      ctx.fillStyle = sel ? "rgba(46,196,182,0.12)" : "rgba(24,30,40,0.95)";
      ctx.strokeStyle = sel ? t.teal : "#3d444d";
      ctx.lineWidth = sel ? 2.5 : 1;
      ctx.fillRect(x, cy, cardW, cardH);
      ctx.strokeRect(x, cy, cardW, cardH);
      ctx.fillStyle = h.body;
      ctx.beginPath();
      ctx.arc(x + 56, cy + cardH / 2, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = h.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(h.displayName, x + 100, cy + 48);
      ctx.fillStyle = "#8b949e";
      ctx.font = "13px system-ui, sans-serif";
      wrapText(h.desc, x + 100, cy + 72, cardW - 115, 18);
      ctx.textAlign = "center";
      ctx.fillStyle = "#58a6ff";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(
        h.hasBoost ? "Space + Shift" : "Shift (экономия)",
        x + cardW / 2,
        cy + cardH - 16
      );
      heroCards.push({ x, y: cy, w: cardW, h: cardH, heroId: h.id });
    });
    menuButtons = [];
    const bbw = 200;
    const bbh = 44;
    drawMenuBtn(W / 2 - bbw / 2, cy + cardH + 36, bbw, bbh, "Назад");
    menuButtons.push({
      x: W / 2 - bbw / 2,
      y: cy + cardH + 36,
      w: bbw,
      h: bbh,
      action: "backMenu",
    });
    ctx.textAlign = "left";
  }

  function drawUpgrades() {
    drawMenuBg();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("Улучшения", W / 2, 82);
    ctx.fillStyle = "#58a6ff";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillText("Очков: " + save.points, W / 2, 118);
    upgradeRows = [];
    const rowH = 54;
    let y = 155;
    const rw = Math.min(680, W - 32);
    const lx = (W - rw) / 2;
    UPGRADE_DEFS.forEach((def) => {
      const lv = save.up[def.key] || 0;
      const cost = upgradeCost(lv);
      const maxed = lv >= MAX_UP;
      ctx.fillStyle = "rgba(20,26,36,0.95)";
      ctx.strokeStyle = "#30363d";
      ctx.fillRect(lx, y, rw, rowH);
      ctx.strokeRect(lx, y, rw, rowH);
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.fillText(def.title + "  " + lv + "/" + MAX_UP, lx + 16, y + 24);
      ctx.fillStyle = "#8b949e";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(def.unit, lx + 16, y + 42);
      const bw = 140;
      const bh = 36;
      const bx = lx + rw - bw - 14;
      const by = y + (rowH - bh) / 2;
      const label = maxed ? "Макс" : cost + " pt";
      const can = !maxed && save.points >= cost;
      ctx.fillStyle = can ? "rgba(30,50,36,0.95)" : "rgba(36,36,40,0.9)";
      ctx.strokeStyle = can ? "#3fb950" : "#484f58";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = can ? "#fff" : "#6e7681";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, bx + bw / 2, by + bh / 2 + 4);
      if (!maxed) {
        upgradeRows.push({
          x: bx,
          y: by,
          w: bw,
          h: bh,
          key: def.key,
          cost,
        });
      }
      y += rowH + 10;
    });
    menuButtons = [];
    const bbw = 200;
    const bbh = 44;
    drawMenuBtn(W / 2 - bbw / 2, y + 20, bbw, bbh, "Назад");
    menuButtons.push({
      x: W / 2 - bbw / 2,
      y: y + 20,
      w: bbw,
      h: bbh,
      action: "backMenu",
    });
    ctx.textAlign = "left";
  }

  function drawSettingsMenu() {
    drawMenuBg();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("Настройки", W / 2, 82);
    ctx.fillStyle = "#8b949e";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Более мягкая графика и удобный интерфейс", W / 2, 112);

    settingsButtons = [];
    const rw = Math.min(720, W - 32);
    const lx = (W - rw) / 2;
    let y = 160;
    const rowH = 56;

    const rows = [
      { id: "theme", title: "Тема", value: settings.theme },
      { id: "softFx", title: "Мягкие эффекты", value: settings.softFx ? "ON" : "OFF" },
      { id: "grid", title: "Сетка арены", value: settings.showGrid ? "ON" : "OFF" },
      { id: "zoom", title: "Зум камеры", value: settings.zoom.toFixed(2) },
      { id: "ui", title: "Размер UI", value: settings.uiScale.toFixed(2) },
    ];

    rows.forEach((r) => {
      ctx.fillStyle = "rgba(20,26,36,0.95)";
      ctx.strokeStyle = "#30363d";
      ctx.fillRect(lx, y, rw, rowH);
      ctx.strokeRect(lx, y, rw, rowH);
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.fillText(r.title, lx + 16, y + 34);
      const bw = 108;
      const bh = 36;
      const by = y + (rowH - bh) / 2;
      const bxMinus = lx + rw - bw * 2 - 18;
      const bxPlus = lx + rw - bw - 10;
      drawMenuBtn(bxMinus, by, bw, bh, "-");
      drawMenuBtn(bxPlus, by, bw, bh, "+");
      ctx.textAlign = "center";
      ctx.fillStyle = "#8b949e";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(String(r.value), lx + rw - bw - 64, y + 34);
      settingsButtons.push(
        { x: bxMinus, y: by, w: bw, h: bh, action: "set:" + r.id + ":minus" },
        { x: bxPlus, y: by, w: bw, h: bh, action: "set:" + r.id + ":plus" }
      );
      y += rowH + 10;
    });

    menuButtons = [];
    const bbw = 220;
    const bbh = 44;
    drawMenuBtn(W / 2 - bbw / 2, y + 24, bbw, bbh, "Назад");
    menuButtons.push({
      x: W / 2 - bbw / 2,
      y: y + 24,
      w: bbw,
      h: bbh,
      action: "backMenu",
    });
    ctx.textAlign = "left";
  }

  function handleMenuClick(mx, my) {
    const tryBtns = (arr) => {
      for (const b of arr) {
        if (hit(mx, my, b)) return b;
      }
      return null;
    };
    if (screen === "menu") {
      const b = tryBtns(menuButtons);
      if (!b) return;
      if (b.action === "play") startCampaign();
      else if (b.action === "heroes") screen = "heroes";
      else if (b.action === "upgrades") screen = "upgrades";
      else if (b.action === "crowns") screen = "crowns";
      else if (b.action === "settings") screen = "settings";
      return;
    }
    if (screen === "heroes") {
      for (const c of heroCards) {
        if (hit(mx, my, c)) {
          save.heroId = c.heroId;
          persistSave();
          applyHeroStats();
          return;
        }
      }
      const b = tryBtns(menuButtons);
      if (b && b.action === "backMenu") screen = "menu";
      return;
    }
    if (screen === "upgrades") {
      for (const r of upgradeRows) {
        if (hit(mx, my, r)) {
          const lv = save.up[r.key] || 0;
          if (lv >= MAX_UP) return;
          if (save.points < r.cost) return;
          save.points -= r.cost;
          save.up[r.key] = lv + 1;
          persistSave();
          applyHeroStats();
          return;
        }
      }
      const b = tryBtns(menuButtons);
      if (b && b.action === "backMenu") screen = "menu";
      return;
    }
    if (screen === "crowns") {
      for (const c of crownButtons) {
        if (hit(mx, my, c)) {
          save.selectedCrown = c.crown;
          persistSave();
          sendWs("hello", {
            id: playerId,
            name: netName,
            crown: save.selectedCrown || "",
            token: authToken || "",
          });
          return;
        }
      }
      const b = tryBtns(menuButtons);
      if (b && b.action === "backMenu") screen = "menu";
      return;
    }
    if (screen === "settings") {
      const sb = tryBtns(settingsButtons);
      if (sb && sb.action) {
        const parts = sb.action.split(":");
        const id = parts[1];
        const op = parts[2];
        if (id === "theme") {
          const order = ["soft", "dusk", "mono"];
          let idx = order.indexOf(settings.theme);
          if (idx < 0) idx = 0;
          idx = op === "plus" ? (idx + 1) % order.length : (idx + order.length - 1) % order.length;
          settings.theme = order[idx];
        } else if (id === "softFx") {
          settings.softFx = !settings.softFx;
        } else if (id === "grid") {
          settings.showGrid = !settings.showGrid;
        } else if (id === "zoom") {
          settings.zoom += op === "plus" ? 0.05 : -0.05;
          settings.zoom = Math.max(1.25, Math.min(1.85, settings.zoom));
        } else if (id === "ui") {
          settings.uiScale += op === "plus" ? 0.05 : -0.05;
          settings.uiScale = Math.max(0.9, Math.min(1.25, settings.uiScale));
        }
        persistSettings();
        return;
      }
      const b = tryBtns(menuButtons);
      if (b && b.action === "backMenu") screen = "menu";
    }
  }

  function handleGameClick(mx, my) {
    if (!won) return;
    const b = winButtons.find((x) => hit(mx, my, x));
    if (!b) return;
    if (b.action === "winRestart") startCampaign();
    if (b.action === "winMenu") goMenu();
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  canvas.addEventListener("click", (e) => {
    const p = canvasPoint(e);
    if (screen === "game") handleGameClick(p.x, p.y);
    else handleMenuClick(p.x, p.y);
  });

  function frame(now) {
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;

    if (authWrapEl) {
      authWrapEl.style.display = screen === "game" ? "none" : "flex";
    }
    if (screen === "game") {
      drawBackground();
      if (!won) {
        updateEnergy(dt);
        updateNpcs(dt);
        updatePlayer(dt);
        updateRemotePlayers(dt, now);
        tryReviveNearby(true);
        checkHits();
        updateDownedState(now);
      }
      if (wsOpen && now - lastSentAt > 60) {
        sendWs("state", {
          id: playerId,
          name: netName,
          x: PLAYER.x,
          y: PLAYER.y,
          r: PLAYER.r,
          area,
          crown: save.selectedCrown || "",
          alive,
          downedUntil,
          mode: gameMode,
        });
        lastSentAt = now;
      }
      drawWorldInViewport();
      drawHeader(now);
      drawFooter();
      if (won) drawWinOverlay();
    } else if (screen === "menu") {
      drawMainMenu();
    } else if (screen === "heroes") {
      drawHeroSelect();
    } else if (screen === "upgrades") {
      drawUpgrades();
    } else if (screen === "crowns") {
      drawCrownsMenu();
    } else if (screen === "settings") {
      drawSettingsMenu();
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener("keydown", (e) => {
    if (e.target && e.target.id === "chat-input") return;

    if (
      e.code === "KeyT" &&
      screen === "game" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      const ci = document.getElementById("chat-input");
      if (ci && document.activeElement !== ci) {
        e.preventDefault();
        ci.focus();
        return;
      }
    }

    keyDown[e.code] = true;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") keyDown["Shift"] = true;
    if (screen === "game") {
      handleInGameUpgradeHotkey(e.code);
      if (e.key === "r" || e.key === "R") {
        respawnToArea1();
      }
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      ) {
        e.preventDefault();
      }
      if (e.code === "Space") e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.target && e.target.id === "chat-input") return;
    keyDown[e.code] = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      if (!keyDown["ShiftLeft"] && !keyDown["ShiftRight"]) keyDown["Shift"] = false;
    }
  });

  const chatLog = document.getElementById("chat-log");
  const chatInput = document.getElementById("chat-input");

  function appendChatLine(text, cls) {
    if (!chatLog) return;
    const div = document.createElement("div");
    if (cls) div.className = cls;
    div.textContent = text;
    chatLog.appendChild(div);
    while (chatLog.childNodes.length > 120) {
      chatLog.removeChild(chatLog.firstChild);
    }
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function runChatCommand(raw) {
    const t = raw.trim();
    if (!t) return;
    appendChatLine("> " + t, "line-me");
    const parts = t.split(/\s+/);
    const head = (parts[0] || "").toLowerCase();

    if (head === "/help" && !adminAuth) {
      appendChatLine(
        "[система] /name Ник · T — фокус чата. Админ: /cmd admin пароль",
        "line-sys"
      );
      return;
    }

    if (head === "/cmd") {
      const sub = (parts[1] || "").toLowerCase();
      if (sub === "admin") {
        const pass = parts.slice(2).join(" ");
        if (!pass) {
          appendChatLine("[система] Укажи пароль после admin", "line-err");
          return;
        }
        if (pass === ADMIN_SECRET) {
          adminAuth = true;
          appendChatLine(
            "[система] Админка ON. /help — список команд.",
            "line-sys"
          );
        } else {
          appendChatLine("[система] Неверный пароль.", "line-err");
        }
        return;
      }

      if (
        sub === "update" &&
        ["liderbord", "leaderboard"].includes((parts[2] || "").toLowerCase())
      ) {
        if (!adminAuth) {
          appendChatLine("[система] Нет прав админа.", "line-err");
          return;
        }
        publishLeaderboardUpdate();
        appendChatLine("[система] Лидерборд обновлён.", "line-sys");
        return;
      }

      if (
        ["restrar", "restart"].includes(sub) &&
        ["liderbord", "leaderboard"].includes((parts[2] || "").toLowerCase())
      ) {
        if (!adminAuth) {
          appendChatLine("[система] Нет прав админа.", "line-err");
          return;
        }
        sendWs("leaderboard_reward", { by: netName });
        appendChatLine("[система] Награды топ-3 выданы.", "line-sys");
        return;
      }

      appendChatLine(
        "[система] /cmd admin пароль · /cmd update liderbord · /cmd restrar liderbord",
        "line-err"
      );
      return;
    }

    if (head.startsWith("/") && !adminAuth) {
      appendChatLine(
        "[система] Нет доступа. Сначала: /cmd admin пароль",
        "line-err"
      );
      return;
    }

    if (!head.startsWith("/")) {
      sendWs("chat", { id: playerId, name: netName, text: t });
      return;
    }

    const c = head;
    if (c === "/help") {
      appendChatLine(
        "/name Ник · /god · /heal · /alive · /next · /pts N · /clear · /menu · /cmd update liderbord · /cmd restrar liderbord",
        "line-sys"
      );
      return;
    }
    if (c === "/god") {
      godMode = !godMode;
      appendChatLine(
        "[система] Бессмертие: " + (godMode ? "ВКЛ" : "ВЫКЛ"),
        "line-sys"
      );
      return;
    }
    if (c === "/heal") {
      PLAYER.energy = PLAYER.energyMax;
      appendChatLine("[система] Энергия полная.", "line-sys");
      return;
    }
    if (c === "/alive") {
      alive = true;
      statusEl.textContent = "";
      appendChatLine("[система] Живой.", "line-sys");
      return;
    }
    if (c === "/next") {
      if (screen !== "game") {
        appendChatLine("[система] Только в игре.", "line-err");
        return;
      }
      nextArea(performance.now());
      appendChatLine("[система] Переход зоны (чит).", "line-sys");
      return;
    }
    if (c === "/pts" || c === "/points") {
      const n = parseInt(parts[1], 10);
      if (isNaN(n) || n <= 0) {
        appendChatLine("[система] Пример: /pts 100", "line-err");
        return;
      }
      addPoints(n);
      appendChatLine("[система] +" + n + " очков.", "line-sys");
      return;
    }
    if (c === "/clear") {
      if (screen !== "game") return;
      npcs = [];
      appendChatLine("[система] Все вражеские шары убраны.", "line-sys");
      return;
    }
    if (c === "/menu") {
      goMenu();
      godMode = false;
      appendChatLine("[система] Меню.", "line-sys");
      return;
    }
    if (c === "/name") {
      const nm = parts.slice(1).join(" ").trim();
      if (!nm) {
        appendChatLine("[система] Пример: /name Ник", "line-err");
        return;
      }
      netName = nm.slice(0, 24);
      appendChatLine("[система] Новое имя: " + netName, "line-sys");
      if (authNickEl) authNickEl.value = netName;
      scheduleRemoteSave();
      sendWs("hello", {
        id: playerId,
        name: netName,
        crown: save.selectedCrown || "",
        token: authToken || "",
      });
      sendWs("score", {
        id: playerId,
        name: netName,
        bestArea: maxAreaReached,
        token: authToken || "",
      });
      return;
    }

    appendChatLine("[система] Неизвестная команда. /help", "line-err");
  }

  function tryReviveNearby(silent) {
    if (screen !== "game" || !alive) return;
    const now = performance.now();
    if (now - lastReviveAttemptAt < 350) return;
    let best = null;
    let bestD2 = Infinity;
    for (const p of otherPlayers.values()) {
      if (!p || p.alive !== false) continue;
      if (p.area !== area) continue;
      if (p.mode && p.mode !== gameMode) continue;
      const d2 = dist2(PLAYER.x, PLAYER.y, p.x, p.y);
      if (d2 < REVIVE_TOUCH_RADIUS * REVIVE_TOUCH_RADIUS && d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    if (!best) {
      if (!silent) {
        appendChatLine("[система] Рядом нет нокнутого игрока для revive.", "line-err");
      }
      return;
    }
    lastReviveAttemptAt = now;
    sendWs("revive_attempt", { fromId: playerId, targetId: best.id });
  }

  if (chatInput) {
    chatInput.addEventListener("focus", () => {
      chatFocused = true;
    });
    chatInput.addEventListener("blur", () => {
      chatFocused = false;
    });
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        runChatCommand(chatInput.value);
        chatInput.value = "";
        e.preventDefault();
      }
    });
  }

  async function handleRegister() {
    const username = (authLoginEl && authLoginEl.value ? authLoginEl.value : "").trim();
    const password = authPassEl && authPassEl.value ? authPassEl.value : "";
    const nickname = (authNickEl && authNickEl.value ? authNickEl.value : "").trim();
    if (!username || !password) {
      setAuthStatus("Введите логин и пароль", true);
      return;
    }
    try {
      const data = await apiFetch("/api/register", "POST", {
        username,
        password,
        nickname: nickname || username,
      });
      authToken = data.token || "";
      authUsername = data.username || "";
      netName = (data.nickname || netName).slice(0, 24);
      persistAuth();
      applyRemoteProfile(data);
      setAuthStatus("Регистрация успешна", false);
      if (wsOpen) {
        sendWs("hello", {
          id: playerId,
          name: netName,
          crown: save.selectedCrown || "",
          token: authToken || "",
        });
      }
    } catch (err) {
      setAuthStatus(err.message, true);
    }
  }

  async function handleLogin() {
    const username = (authLoginEl && authLoginEl.value ? authLoginEl.value : "").trim();
    const password = authPassEl && authPassEl.value ? authPassEl.value : "";
    if (!username || !password) {
      setAuthStatus("Введите логин и пароль", true);
      return;
    }
    try {
      const data = await apiFetch("/api/login", "POST", { username, password });
      authToken = data.token || "";
      authUsername = data.username || "";
      netName = (data.nickname || netName).slice(0, 24);
      persistAuth();
      applyRemoteProfile(data);
      setAuthStatus("Вход выполнен", false);
      if (wsOpen) {
        sendWs("hello", {
          id: playerId,
          name: netName,
          crown: save.selectedCrown || "",
          token: authToken || "",
        });
      }
    } catch (err) {
      setAuthStatus(err.message, true);
    }
  }

  function handleLogout() {
    authToken = "";
    authUsername = "";
    persistAuth();
    refreshAuthUi();
    setAuthStatus("Вы вышли из аккаунта", false);
  }

  if (authRegisterEl) authRegisterEl.addEventListener("click", handleRegister);
  if (authSigninEl) authSigninEl.addEventListener("click", handleLogin);
  if (authLogoutEl) authLogoutEl.addEventListener("click", handleLogout);

  loadSettings();
  loadSave();
  applyHeroStats();
  refreshAuthUi();
  tryRestoreSession();
  relayout();
  window.addEventListener("resize", relayout);
  updateLeaderboardUi();
  connectWs();
  appendChatLine("Чат: T или клик. Слева синяя BACK-полоса, справа EXIT, сверху слева вход в Hard.", "line-sys");
  setHint(
    "Камера за игроком · касание нокнутого = revive · Space — аура slow · Shift — boost · R — арена 1 · 1/2/3/4 — апгрейды"
  );
  requestAnimationFrame(frame);
})();

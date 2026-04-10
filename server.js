const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;
const players = new Map();
const scores = new Map();
const sessions = new Map();
const CROWNS = ["Платиновая", "Серебряная", "Бронзовая"];
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

let usersDb = { users: {} };

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2), "utf8");
  }
  try {
    usersDb = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    if (!usersDb || typeof usersDb !== "object" || !usersDb.users) {
      usersDb = { users: {} };
    }
  } catch {
    usersDb = { users: {} };
  }
}

function saveUsersDb() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(usersDb, null, 2), "utf8");
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function safeUsername(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function safeNickname(name) {
  return String(name || "Игрок").trim().slice(0, 24) || "Игрок";
}

function mkToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getUserByToken(token) {
  const session = sessions.get(token);
  if (!session || !session.username) return null;
  const user = usersDb.users[session.username];
  if (!user) return null;
  return { username: session.username, user };
}

function accountScoreId(username) {
  return "acc:" + username;
}

function readBearer(req) {
  const h = String(req.headers.authorization || "");
  const parts = h.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return "";
  return parts[1];
}

app.use(express.json({ limit: "128kb" }));
app.use(express.static(path.join(__dirname)));

app.post("/api/register", (req, res) => {
  const username = safeUsername(req.body && req.body.username);
  const password = String((req.body && req.body.password) || "");
  const nickname = safeNickname((req.body && req.body.nickname) || username || "Игрок");
  if (username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: "Логин >= 3, пароль >= 4" });
  }
  if (usersDb.users[username]) {
    return res.status(409).json({ error: "Логин уже занят" });
  }
  usersDb.users[username] = {
    passwordHash: hashPassword(password),
    nickname,
    bestArea: 1,
    unlockedCrowns: [],
    progress: null,
    updatedAt: Date.now(),
  };
  saveUsersDb();
  const token = mkToken();
  sessions.set(token, { username, createdAt: Date.now() });
  return res.json({
    token,
    username,
    nickname,
    bestArea: 1,
    unlockedCrowns: [],
    progress: null,
  });
});

app.post("/api/login", (req, res) => {
  const username = safeUsername(req.body && req.body.username);
  const password = String((req.body && req.body.password) || "");
  const user = usersDb.users[username];
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }
  const token = mkToken();
  sessions.set(token, { username, createdAt: Date.now() });
  return res.json({
    token,
    username,
    nickname: safeNickname(user.nickname || "Игрок"),
    bestArea: Number(user.bestArea) || 1,
    unlockedCrowns: Array.isArray(user.unlockedCrowns) ? user.unlockedCrowns : [],
    progress: user.progress || null,
  });
});

app.get("/api/me", (req, res) => {
  const token = readBearer(req);
  const pair = getUserByToken(token);
  if (!pair) return res.status(401).json({ error: "Не авторизован" });
  const user = pair.user;
  return res.json({
    username: pair.username,
    nickname: safeNickname(user.nickname || "Игрок"),
    bestArea: Number(user.bestArea) || 1,
    unlockedCrowns: Array.isArray(user.unlockedCrowns) ? user.unlockedCrowns : [],
    progress: user.progress || null,
  });
});

app.post("/api/save", (req, res) => {
  const token = readBearer(req);
  const pair = getUserByToken(token);
  if (!pair) return res.status(401).json({ error: "Не авторизован" });
  const { progress, bestArea, nickname } = req.body || {};
  const user = pair.user;
  if (nickname) user.nickname = safeNickname(nickname);
  if (typeof bestArea === "number" && Number.isFinite(bestArea)) {
    user.bestArea = Math.max(Number(user.bestArea) || 1, Math.floor(bestArea));
  }
  if (progress && typeof progress === "object") {
    user.progress = progress;
    if (Array.isArray(progress.unlockedCrowns)) {
      user.unlockedCrowns = progress.unlockedCrowns.filter((c) => CROWNS.includes(c));
    }
  }
  user.updatedAt = Date.now();
  saveUsersDb();
  const scoreId = accountScoreId(pair.username);
  const prev = scores.get(scoreId);
  scores.set(scoreId, {
    id: scoreId,
    account: pair.username,
    name: safeNickname(user.nickname),
    bestArea: Number(user.bestArea) || 1,
    updatedAt: Date.now(),
    unlockedCrowns: Array.isArray(user.unlockedCrowns) ? user.unlockedCrowns : [],
    legacyId: prev ? prev.legacyId : "",
  });
  broadcastLeaderboard();
  return res.json({ ok: true });
});

function crownByIndex(index) {
  if (index === 0) return "Платиновая";
  if (index === 1) return "Серебряная";
  if (index === 2) return "Бронзовая";
  return "";
}

function getLeaderboard() {
  const list = [...scores.values()].sort((a, b) => {
    if (b.bestArea !== a.bestArea) return b.bestArea - a.bestArea;
    return a.updatedAt - b.updatedAt;
  });
  return list.slice(0, 30).map((row, idx) => ({
    ...row,
    crown: crownByIndex(idx),
  }));
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function broadcastPlayers() {
  broadcast({
    type: "players",
    payload: [...players.values()],
  });
}

function broadcastLeaderboard() {
  broadcast({
    type: "leaderboard",
    payload: getLeaderboard(),
  });
}

function grantTopCrowns() {
  const top = getLeaderboard().slice(0, 3);
  const granted = [];
  top.forEach((row, idx) => {
    const reward = crownByIndex(idx);
    if (!reward) return;
    const prev = scores.get(row.id);
    if (!prev) return;
    const unlocked = Array.isArray(prev.unlockedCrowns) ? prev.unlockedCrowns.slice() : [];
    if (!unlocked.includes(reward)) unlocked.push(reward);
    scores.set(row.id, {
      ...prev,
      unlockedCrowns: unlocked,
      updatedAt: Date.now(),
    });
    if (row.account && usersDb.users[row.account]) {
      const u = usersDb.users[row.account];
      const userCrowns = Array.isArray(u.unlockedCrowns) ? u.unlockedCrowns.slice() : [];
      if (!userCrowns.includes(reward)) userCrowns.push(reward);
      u.unlockedCrowns = userCrowns;
      u.updatedAt = Date.now();
      if (u.progress && typeof u.progress === "object") {
        u.progress.unlockedCrowns = userCrowns.slice();
      }
      saveUsersDb();
    }
    granted.push({
      id: row.id,
      account: row.account || "",
      legacyId: row.legacyId || "",
      crown: reward,
    });
  });
  return granted;
}

function resolveAccountFromPayload(payload) {
  const token = String(payload.token || "");
  const pair = getUserByToken(token);
  if (!pair) return null;
  return {
    username: pair.username,
    nickname: safeNickname(pair.user.nickname || "Игрок"),
  };
}

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const payload = msg && msg.payload ? msg.payload : {};
    if (msg.type === "hello") {
      socket.playerId = payload.id;
      const account = resolveAccountFromPayload(payload);
      socket.account = account ? account.username : "";
      players.set(payload.id, {
        id: payload.id,
        name: account ? account.nickname : (payload.name || "Игрок"),
        x: 0,
        y: 0,
        r: 16,
        crown: payload.crown || "",
        alive: true,
        downedUntil: 0,
        area: 1,
        mode: "normal",
      });
      broadcastPlayers();
      return;
    }

    if (msg.type === "state" && payload.id) {
      const prev = players.get(payload.id);
      if (!prev) return;
      players.set(payload.id, {
        ...prev,
        name: payload.name || prev.name,
        x: Number(payload.x) || 0,
        y: Number(payload.y) || 0,
        r: Number(payload.r) || 16,
        area: Number(payload.area) || 1,
        crown: payload.crown || "",
        alive: payload.alive !== false,
        downedUntil: Number(payload.downedUntil) || 0,
        mode: payload.mode || prev.mode || "normal",
      });
      broadcastPlayers();
      return;
    }

    if (msg.type === "chat" && payload.text) {
      broadcast({
        type: "chat",
        payload: {
          id: payload.id,
          name: payload.name || "Игрок",
          text: String(payload.text).slice(0, 180),
        },
      });
      return;
    }

    if (msg.type === "score" && payload.id) {
      const account = resolveAccountFromPayload(payload);
      const scoreId = account ? accountScoreId(account.username) : payload.id;
      const current = scores.get(scoreId);
      const candidate = Number(payload.bestArea) || 1;
      const best = current ? Math.max(current.bestArea, candidate) : candidate;
      scores.set(scoreId, {
        id: scoreId,
        account: account ? account.username : "",
        legacyId: payload.id,
        name: account ? account.nickname : (payload.name || "Игрок"),
        bestArea: best,
        updatedAt: Date.now(),
        unlockedCrowns:
          current && Array.isArray(current.unlockedCrowns)
            ? current.unlockedCrowns
            : [],
      });
      if (account && usersDb.users[account.username]) {
        const u = usersDb.users[account.username];
        u.bestArea = Math.max(Number(u.bestArea) || 1, best);
        u.updatedAt = Date.now();
        saveUsersDb();
      }
      broadcastLeaderboard();
      return;
    }

    if (msg.type === "leaderboard_update") {
      broadcastLeaderboard();
      broadcast({
        type: "system",
        payload: {
          text: "Лидерборд обновлен по команде " + (payload.by || "админа"),
        },
      });
      return;
    }

    if (msg.type === "leaderboard_reward") {
      const granted = grantTopCrowns();
      broadcastLeaderboard();
      broadcast({
        type: "crown_grants",
        payload: granted,
      });
      broadcast({
        type: "system",
        payload: {
          text: "Выданы короны топ-3 после перезапуска лидерборда.",
        },
      });
      return;
    }

    if (msg.type === "revive_attempt" && payload.targetId && payload.fromId) {
      const from = players.get(payload.fromId);
      const target = players.get(payload.targetId);
      if (!from || !target) return;
      if (from.alive === false || target.alive !== false) return;
      if (from.area !== target.area) return;
      if ((from.mode || "normal") !== (target.mode || "normal")) return;
      const dx = Number(from.x || 0) - Number(target.x || 0);
      const dy = Number(from.y || 0) - Number(target.y || 0);
      const d2 = dx * dx + dy * dy;
      if (d2 > 130 * 130) return;
      target.alive = true;
      target.downedUntil = 0;
      players.set(payload.targetId, target);
      broadcastPlayers();
      broadcast({
        type: "revived",
        payload: { id: payload.targetId, by: from.name || "Игрок" },
      });
      broadcast({
        type: "system",
        payload: {
          text:
            (from.name || "Игрок") +
            " возродил " +
            (target.name || "игрока") +
            ".",
        },
      });
    }
  });

  socket.on("close", () => {
    if (socket.playerId) {
      players.delete(socket.playerId);
      broadcastPlayers();
    }
  });

  socket.send(
    JSON.stringify({
      type: "leaderboard",
      payload: getLeaderboard(),
    })
  );
});

ensureDataStore();
for (const [username, user] of Object.entries(usersDb.users)) {
  const scoreId = accountScoreId(username);
  scores.set(scoreId, {
    id: scoreId,
    account: username,
    name: safeNickname(user.nickname || "Игрок"),
    bestArea: Number(user.bestArea) || 1,
    updatedAt: Number(user.updatedAt) || Date.now(),
    unlockedCrowns: Array.isArray(user.unlockedCrowns) ? user.unlockedCrowns : [],
  });
}

server.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});

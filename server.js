const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });
console.log("Kizik Sus Online WebSocket server on port", PORT);

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function broadcast(room, type, data = {}) {
  for (const p of room.players.values()) send(p.ws, type, data);
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, sprite: p.sprite, x: p.x, y: p.y,
      alive: p.alive, role: p.role
    })),
    bots: [...room.bots.values()],
    tasks: [...room.tasks.values()],
    bodies: [...room.bodies.values()],
    meeting: room.meeting,
    sabotage: room.sabotage,
    winner: room.winner
  };
}

function makeTasks() {
  return new Map([
    ["task_0", { id:"task_0", name:"Kabelki", x:820, y:740, done:false }],
    ["task_1", { id:"task_1", name:"Kod", x:1250, y:980, done:false }],
    ["task_2", { id:"task_2", name:"Śmieci", x:1700, y:1280, done:false }],
    ["task_3", { id:"task_3", name:"Skan", x:2150, y:920, done:false }],
    ["task_4", { id:"task_4", name:"Antena", x:2360, y:1850, done:false }]
  ]);
}

function createRoom(ws, name, sprite) {
  let code;
  do code = makeCode(); while (rooms.has(code));

  const room = {
    code,
    hostId: ws._id,
    started: false,
    players: new Map(),
    bots: new Map(),
    tasks: makeTasks(),
    bodies: new Map(),
    meeting: { active:false, id:0, votes:{} },
    sabotage: { active:false, timer:0 },
    winner: null,
    lastTick: Date.now()
  };

  room.players.set(ws._id, {
    id: ws._id, ws, name, sprite,
    x: 520, y: 620, alive: true, role: "crewmate", cooldownUntil: 0
  });

  rooms.set(code, room);
  ws._room = code;

  send(ws, "room_created", { code, id: ws._id, state: publicRoom(room) });
  broadcast(room, "state", { state: publicRoom(room) });
}

function joinRoom(ws, code, name, sprite) {
  const room = rooms.get(code);
  if (!room) return send(ws, "error_msg", { message:"Nie ma takiego pokoju" });
  if (room.players.size >= 5) return send(ws, "error_msg", { message:"Pokój pełny max 5" });

  const i = room.players.size;
  room.players.set(ws._id, {
    id: ws._id, ws, name, sprite,
    x: 520 + i * 90, y: 620, alive: true, role: "crewmate", cooldownUntil: 0
  });

  ws._room = code;
  send(ws, "joined", { code, id: ws._id, state: publicRoom(room) });
  broadcast(room, "state", { state: publicRoom(room) });
}

function startRoom(room) {
  const ids = [...room.players.keys()];
  const badCount = ids.length >= 5 ? 2 : 1;
  const imps = new Set([...ids].sort(() => Math.random() - 0.5).slice(0, badCount));

  for (const [id, p] of room.players) {
    p.role = imps.has(id) ? "impostor" : "crewmate";
    p.alive = true;
  }

  while (room.players.size + room.bots.size < 11) {
    const n = room.bots.size;
    const id = "bot_" + n;
    room.bots.set(id, {
      id, name: "🤖 Bot " + (n + 1),
      x: 700 + Math.random() * 1200, y: 900 + Math.random() * 1600,
      tx: 700 + Math.random() * 1200, ty: 900 + Math.random() * 1600,
      alive: true
    });
  }

  room.started = true;
  broadcast(room, "started", { state: publicRoom(room) });
  broadcast(room, "state", { state: publicRoom(room) });
}

function nearestTask(room, p) {
  let best = null, bd = Infinity;
  for (const t of room.tasks.values()) {
    if (t.done) continue;
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function tickRoom(room) {
  const now = Date.now();
  const dt = Math.min(0.05, (now - room.lastTick) / 1000);
  room.lastTick = now;

  for (const b of room.bots.values()) {
    if (!b.alive) continue;
    if (Math.hypot(b.x - b.tx, b.y - b.ty) < 30) {
      b.tx = 300 + Math.random() * 2400;
      b.ty = 500 + Math.random() * 3200;
    }
    const dx = b.tx - b.x, dy = b.ty - b.y;
    const len = Math.hypot(dx, dy) || 1;
    b.x += (dx / len) * 120 * dt;
    b.y += (dy / len) * 120 * dt;
  }

  if (room.sabotage.active) {
    room.sabotage.timer -= dt;
    if (room.sabotage.timer <= 0) {
      room.sabotage.active = false;
      room.winner = "IMPOSTORS WIN - SABOTAGE";
    }
  }
}

setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.started) continue;
    tickRoom(room);
    broadcast(room, "state", { state: publicRoom(room) });
  }
}, 100);

wss.on("connection", ws => {
  ws._id = "p_" + Math.random().toString(36).slice(2, 9);
  send(ws, "hello", { id: ws._id });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "create") return createRoom(ws, msg.name || "Player", msg.sprite || "MiniKizik.png");
    if (msg.type === "join") return joinRoom(ws, String(msg.code || "").toUpperCase(), msg.name || "Player", msg.sprite || "MiniKizik.png");

    const room = rooms.get(ws._room);
    if (!room) return;
    const p = room.players.get(ws._id);

    if (msg.type === "start") {
      if (room.hostId === ws._id) startRoom(room);
      return;
    }

    if (msg.type === "move" && p && p.alive) {
      p.x = Number(msg.x || p.x);
      p.y = Number(msg.y || p.y);
      return;
    }

    if (msg.type === "task" && p && p.alive) {
      const t = room.tasks.get(msg.taskId) || nearestTask(room, p);
      if (t && !t.done) {
        t.done = true;
        t.by = p.name;
        if ([...room.tasks.values()].every(x => x.done)) room.winner = "CREWMATES WIN - TASKS";
        broadcast(room, "state", { state: publicRoom(room) });
      }
      return;
    }

    if (msg.type === "spawn_bot" && room.hostId === ws._id) {
      const id = "bot_extra_" + Date.now();
      room.bots.set(id, {
        id, name: "🤖 Bot",
        x: 700 + Math.random() * 1200, y: 900 + Math.random() * 1600,
        tx: 700 + Math.random() * 1200, ty: 900 + Math.random() * 1600,
        alive: true
      });
      broadcast(room, "state", { state: publicRoom(room) });
      return;
    }

    if (msg.type === "sabotage" && p && p.role === "impostor") {
      room.sabotage = { active:true, timer:18 };
      broadcast(room, "state", { state: publicRoom(room) });
      return;
    }

    if (msg.type === "fix") {
      room.sabotage = { active:false, timer:0 };
      broadcast(room, "state", { state: publicRoom(room) });
      return;
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws._room);
    if (!room) return;

    room.players.delete(ws._id);

    if (room.players.size === 0) rooms.delete(room.code);
    else {
      if (room.hostId === ws._id) room.hostId = room.players.keys().next().value;
      broadcast(room, "state", { state: publicRoom(room) });
    }
  });
});

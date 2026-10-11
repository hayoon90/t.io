'use strict';
// TANK.io 멀티플레이 서버: 게임 계산은 전부 서버에서 하고, 클라이언트는 입력만 보내고 화면만 그립니다.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const WORLD = 3000, MAXL = 7, NSH = 120;
const MAXP = +process.env.MAX_PLAYERS || 30;   // 동시 접속 최대 인원
const MINT = +process.env.MIN_TANKS || 10;     // 맵에 항상 있을 최소 탱크 수 (모자라면 봇으로 채움)
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let u;
  try { u = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(PUB, u);
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(d);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });

// ---------- 게임 데이터 ----------
const rnd = (a, b) => a + Math.random() * (b - a);
// 레벨 45까지 누적 점수(근사치), 업그레이드 포인트는 레벨 2~28 매 레벨 + 30,33,...,45 = 총 33개
const CUM = l => l <= 1 ? 0 : Math.round(4 * (l - 1) + 23360 * Math.pow((l - 1) / 44, 3.1));
const need = l => CUM(l + 1) - CUM(l);
const pointAt = l => l <= 28 || (l - 27) % 3 === 0;
const r1 = v => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SH = [
  { n: 4, r: 16, hp: 10, xp: 10, c: '#ffe869', sc: '#bfae4e', dmg: .1 },
  { n: 3, r: 18, hp: 25, xp: 25, c: '#fc7677', sc: '#bf5a5b', dmg: .25 },
  { n: 5, r: 32, hp: 100, xp: 130, c: '#768dfc', sc: '#5a6bbf', dmg: .4 },
  { n: 5, r: 62, hp: 400, xp: 3000, c: '#768dfc', sc: '#5a6bbf', dmg: 1.2 }
];
const B = (a, d, l, w, del, fl) => ({ a, d, l, w, del: del || 0, fl: fl ? 1 : 0 });
const CL = {
  'Tank': { b: [B(0, 0, 1.75, .8)] },
  'Twin': { b: [B(0, .5, 1.75, .6), B(0, -.5, 1.75, .6, .5)], dm: .9 },
  'Sniper': { b: [B(0, 0, 2.3, .8)], rl: 1.6, sp: 1.6, fov: .8, dm: 1.1 },
  'Machine Gun': { b: [B(0, 0, 1.7, .9, 0, 1)], rl: .5, dm: .6, spr: .25 },
  'Flank Guard': { b: [B(0, 0, 1.75, .8), B(Math.PI, 0, 1.6, .8)] },
  'Smasher': { b: [], bd: 2.5, ms: 1.15, rs: 1.1 },
  'Triple Shot': { b: [B(-.55, 0, 1.7, .7), B(.55, 0, 1.7, .7), B(0, 0, 1.9, .7)], dm: .8, rl: 1.1 },
  'Quad Tank': { b: [0, 1, 2, 3].map(i => B(i * Math.PI / 2, 0, 1.7, .75)) },
  'Assassin': { b: [B(0, 0, 2.7, .8)], rl: 2, sp: 1.9, fov: .65, dm: 1.5 },
  'Hunter': { b: [B(0, 0, 2.5, .6), B(0, 0, 2.1, .9, .35)], rl: 1.4, sp: 1.7, fov: .75 },
  'Overseer': { b: [B(1.5708, 0, 1.5, .8), B(-1.5708, 0, 1.5, .8)], rl: 3, dm: .7, sp: .8, dr: 1 },
  'Trapper': { b: [B(0, 0, 1.9, .9, 0, 1)], rl: 1.5, sp: 1.5, dm: 1.1, trap: 1 },
  'Destroyer': { b: [B(0, 0, 1.8, 1.4)], rl: 3, dm: 3.3, sp: .8, big: 1 },
  'Gunner': { b: [B(0, .75, 1.6, .35), B(0, -.75, 1.6, .35, .5), B(0, .4, 1.9, .35, .25), B(0, -.4, 1.9, .35, .75)], rl: .55, dm: .45, spr: .1 },
  'Tri-Angle': { b: [B(0, 0, 1.75, .8), B(2.6, 0, 1.5, .7), B(-2.6, 0, 1.5, .7)], ms: 1.12, dm: .9 },
  'Triplet': { b: [B(0, .55, 1.65, .55), B(0, -.55, 1.65, .55), B(0, 0, 1.95, .55, .5)], dm: .8, rl: 1.1 },
  'Octo Tank': { b: [0, 1, 2, 3, 4, 5, 6, 7].map(i => B(i * Math.PI / 4, 0, 1.65, .65)), dm: .75, rl: 1.15 },
  'Predator': { b: [B(0, 0, 2.1, .7), B(0, 0, 2.3, .85, .2), B(0, 0, 2.5, 1, .4)], rl: 1.7, sp: 1.7, fov: .8, dm: 1.2 },
  'Overlord': { b: [0, 1, 2, 3].map(i => B(i * Math.PI / 2, 0, 1.5, .8)), rl: 3, dm: .7, sp: .8, dr: 1 },
  'Ranger': { b: [B(0, 0, 3.0, .75)], rl: 2.2, sp: 2.1, fov: .55, dm: 1.7 }
};
const T1 = ['Twin', 'Sniper', 'Machine Gun', 'Flank Guard', 'Smasher'];
const T2 = { Twin: ['Triple Shot', 'Quad Tank'], Sniper: ['Assassin', 'Hunter', 'Overseer', 'Trapper'], 'Machine Gun': ['Destroyer', 'Gunner'], 'Flank Guard': ['Tri-Angle', 'Quad Tank'] };
const T3 = { 'Triple Shot': ['Triplet'], 'Quad Tank': ['Octo Tank'], Hunter: ['Predator'], Overseer: ['Overlord'], Assassin: ['Ranger'] };
const opts = t => t.tier === 0 && t.level >= 15 ? T1 : t.tier === 1 && t.level >= 30 ? (T2[t.cls] || []) : t.tier === 2 && t.level >= 45 ? (T3[t.cls] || []) : [];
const NAMES = ['Bolt', 'Kiwi', 'Nova', 'Rex', 'Zed', 'Pip', 'Moa', 'Jet', 'Orb', 'Taz', 'Dot', 'Fox'];
const HELLO = JSON.stringify({
  t: 'hello', W: WORLD,
  SH: SH.map(s => ({ n: s.n, r: s.r, c: s.c, sc: s.sc })),
  CL: Object.fromEntries(Object.entries(CL).map(([k, c]) => [k, { b: c.b.map(x => [x.a, x.d, x.l, x.w, x.fl]), fov: c.fov || 1, rs: c.rs || 1 }]))
});

let frame = 0, nid = 1, tanks = [], shapes = [], bullets = [];
const maxhp = t => 50 + t.st[1] * 20 + (t.level - 1) * 2;
const rad = t => (20 + t.level * .45) * (CL[t.cls].rs || 1);

function send(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function ev(o) { const s = JSON.stringify(o); for (const ws of wss.clients) if (ws.readyState === 1) ws.send(s); }

function mk(name, bot) {
  let p = { x: rnd(200, WORLD - 200), y: rnd(200, WORLD - 200) };
  for (let i = 0; i < 8; i++) {
    const c = { x: rnd(200, WORLD - 200), y: rnd(200, WORLD - 200) };
    if (tanks.every(o => !o.alive || Math.hypot(o.x - c.x, o.y - c.y) > 700)) { p = c; break; }
  }
  const t = {
    id: nid++, name, bot, x: p.x, y: p.y, vx: 0, vy: 0, ax: 0, ay: 0, angle: 0, level: 1, xp: 0, score: 0, pts: 0,
    st: [0, 0, 0, 0, 0, 0, 0, 0], cd: 0, cls: 'Tank', tier: 0, q: [], alive: true, hurt: 0, recoil: 0, lh: 0,
    fire: false, tgt: null, tt: 0, wp: null, kb: '', ws: null, li: 0, vw: 900, vh: 550, mx: 0, my: 0, rt: 0, born: Date.now(),
    inv: frame + 120   // 스폰 직후 2초 무적
  };
  t.hp = maxhp(t);
  return t;
}
function spawnShape() {
  const r = Math.random() * 100, ty = r < 60 ? 0 : r < 85 ? 1 : r < 98.5 ? 2 : 3, s = SH[ty];
  shapes.push({ id: nid++, t: ty, n: s.n, r: s.r, hp: s.hp, xp: s.xp, dmg: s.dmg, x: rnd(50, WORLD - 50), y: rnd(50, WORLD - 50), a: rnd(0, 6.28), va: rnd(-.012, .012), vx: rnd(-.25, .25), vy: rnd(-.25, .25), hurt: 0 });
}
function gain(t, x) {
  t.xp += x; t.score += x;
  while (t.level < 45 && t.xp >= need(t.level)) { t.xp -= need(t.level); t.level++; if (pointAt(t.level)) t.pts++; t.hp = Math.min(maxhp(t), t.hp + 8); }
}
function up(t, i) {
  if (t.alive && t.pts > 0 && i >= 0 && i < 8 && t.st[i] < MAXL) { t.st[i]++; t.pts--; if (i === 1) t.hp += 20; }
}
function hitShape(s, d, src) {
  s.hp -= d; s.hurt = 5;
  if (s.hp <= 0 && src && src.alive) gain(src, s.xp);
}
function hurtTank(t, d, src) {
  if (!t.alive || frame < t.inv) return;
  t.hp -= d; t.hurt = 4; t.lh = frame;
  if (src) t.kb = src.name;
  if (t.hp <= 0) {
    t.alive = false;
    if (src && src.alive) gain(src, 15 + t.score * .5);
    if (src) ev({ t: 'kill', k: src.name, v: t.name });
    if (t.ws) send(t.ws, { t: 'dead', sc: Math.floor(t.score), lv: t.level, kb: t.kb, ta: Math.round((Date.now() - t.born) / 1000) });
    else t.rt = frame + 180;
  }
}
function fireB(t, b) {
  const C = CL[t.cls];
  if (C.dr && bullets.filter(x => x.o === t && x.dr).length >= 8) return;
  const r = rad(t), sp = (6 + t.st[3] * 1.1) * (C.sp || 1), dm = (5 + t.st[5] * 2.5) * (C.dm || 1);
  const a = t.angle + b.a + (t.bot ? rnd(-.05, .05) : 0) + rnd(-1, 1) * (C.spr || 0);
  const pa = t.angle + b.a + 1.5708, ox = Math.cos(pa) * b.d * r, oy = Math.sin(pa) * b.d * r;
  bullets.push({
    id: nid++, x: t.x + ox + Math.cos(a) * r * b.l, y: t.y + oy + Math.sin(a) * r * b.l,
    vx: Math.cos(a) * sp + t.vx * .3, vy: Math.sin(a) * sp + t.vy * .3, dm,
    pen: C.dr ? 6 : 2 + t.st[4] * 1.5 + (C.big ? 3 : 0) + (C.trap ? 4 : 0),
    life: C.dr ? 1e9 : C.trap ? 450 : 100, dr: C.dr, trap: C.trap, kd: C.dr ? 1 : C.trap ? 2 : 0, k: 0, o: t,
    r: r * (.2 + .3 * b.w) * (C.trap ? 1.3 : 1), h: new Set()
  });
  t.recoil = C.big ? 8 : 4;
  const k = (C.big ? 1 : .3) / Math.sqrt(C.b.length);
  t.vx -= Math.cos(a) * k; t.vy -= Math.sin(a) * k;
}
function shoot(t) {
  const C = CL[t.cls];
  t.cd = Math.max(4, (30 - t.st[6] * 3) * (C.rl || 1)) + (t.bot ? 4 : 0);
  for (const b of C.b) { if (b.del) t.q.push({ f: frame + Math.round(b.del * t.cd), b }); else fireB(t, b); }
}
function ai(t) {
  if (--t.tt <= 0) {
    t.tt = 30; let b = null, bd = 1e9;
    for (const o of tanks) if (o !== t && o.alive) { const d = Math.hypot(o.x - t.x, o.y - t.y); if (d < 500 && d < bd) { bd = d; b = o; } }
    if (!b) for (const s of shapes) { const d = Math.hypot(s.x - t.x, s.y - t.y); if (s.hp > 0 && d < 700 && d < bd) { bd = d; b = s; } }
    t.tgt = b;
    if (!b && (!t.wp || Math.random() < .3)) t.wp = { x: rnd(100, WORLD - 100), y: rnd(100, WORLD - 100) };
  }
  const g = t.tgt && (t.tgt.level ? t.tgt.alive : t.tgt.hp > 0) ? t.tgt : null;
  let tx = 0, ty = 0, fire = false;
  if (g) {
    const dx = g.x - t.x, dy = g.y - t.y, d = Math.hypot(dx, dy) || 1;
    t.angle = Math.atan2(dy, dx); fire = d < 650;
    const w = g.level ? (t.hp < maxhp(t) * .35 ? -1 : (d > 280 ? 1 : -.3)) : (d > 140 ? 1 : 0);
    tx = dx / d * w; ty = dy / d * w;
  } else if (t.wp) {
    const dx = t.wp.x - t.x, dy = t.wp.y - t.y, d = Math.hypot(dx, dy) || 1;
    t.angle = Math.atan2(dy, dx); tx = dx / d; ty = dy / d;
  }
  return { tx, ty, fire };
}

// ---------- 한 틱(1/60초) ----------
function update() {
  frame++;
  const now = Date.now();
  for (const t of tanks) {
    if (!t.alive) { if (t.bot && frame >= t.rt) Object.assign(t, mk(t.name, true)); continue; }
    if (t.bot) {
      const a = ai(t); t.ax = a.tx; t.ay = a.ty; t.fire = a.fire;
      if (t.pts > 0) { const i = Math.floor(Math.random() * 8); if (t.st[i] < MAXL) { t.st[i]++; t.pts--; } }
      const o = opts(t).filter(n => n !== 'Smasher');
      if (o.length) { t.cls = o[Math.floor(Math.random() * o.length)]; t.tier++; }
    } else if (now - t.li > 3000) { t.ax = 0; t.ay = 0; t.fire = false; }
    const ac = (.3 + t.st[7] * .035) * (CL[t.cls].ms || 1) * Math.pow(.993, t.level - 1);   // 커질수록 살짝 느려짐
    t.vx = (t.vx + t.ax * ac) * .92; t.vy = (t.vy + t.ay * ac) * .92; t.x += t.vx; t.y += t.vy;
    const r = rad(t);
    t.x = clamp(t.x, r, WORLD - r); t.y = clamp(t.y, r, WORLD - r);
    if (t.cd > 0) t.cd--;
    if (t.fire && t.cd <= 0) shoot(t);
    for (let i = t.q.length - 1; i >= 0; i--) if (frame >= t.q[i].f) { fireB(t, t.q[i].b); t.q.splice(i, 1); }
    if (t.hurt > 0) t.hurt--; if (t.recoil > 0) t.recoil--;
    const mh = maxhp(t);
    if (frame - t.lh > 180) t.hp = Math.min(mh, t.hp + mh * (.0005 + .0008 * t.st[0]));
  }
  for (const s of shapes) {
    s.x += s.vx; s.y += s.vy; s.a += s.va; s.vx *= .99; s.vy *= .99; if (s.hurt > 0) s.hurt--;
    if (s.x < s.r || s.x > WORLD - s.r) s.vx *= -1;
    if (s.y < s.r || s.y > WORLD - s.r) s.vy *= -1;
    s.x = clamp(s.x, s.r, WORLD - s.r); s.y = clamp(s.y, s.r, WORLD - s.r);
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (b.dr) {
      const o = b.o; let tx, ty;
      if (o.ws) { tx = o.x + o.mx; ty = o.y + o.my; } else { const g = o.tgt; tx = g ? g.x : o.x; ty = g ? g.y : o.y; }
      const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
      b.vx = (b.vx + dx / d * .35) * .96; b.vy = (b.vy + dy / d * .35) * .96;
      if (!o.alive) b.life = 0;
      if (++b.k % 20 === 0) b.h.clear();
    }
    if (b.trap) { b.vx *= .94; b.vy *= .94; }
    b.x += b.vx; b.y += b.vy; b.life--;
    let dead = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WORLD || b.y > WORLD;
    if (!dead) for (const s of shapes) {
      if (s.hp > 0 && !b.h.has(s) && Math.hypot(s.x - b.x, s.y - b.y) < s.r + b.r) {
        b.h.add(s); hitShape(s, b.dm, b.o); b.pen--; s.vx += b.vx * .03; s.vy += b.vy * .03;
        if (b.pen <= 0) { dead = true; break; }
      }
    }
    if (!dead) for (const t of tanks) {
      if (t.alive && t !== b.o && !b.h.has(t) && Math.hypot(t.x - b.x, t.y - b.y) < rad(t) + b.r) {
        b.h.add(t); hurtTank(t, b.dm, b.o); b.pen -= 1.5;
        if (b.pen <= 0) { dead = true; break; }
      }
    }
    if (dead) bullets.splice(i, 1);
  }
  // 서로 다른 사람의 총알끼리 부딪히면 둘 다 깎임
  for (let i = 0; i < bullets.length; i++) {
    const a = bullets[i];
    for (let j = i + 1; j < bullets.length; j++) {
      const b = bullets[j];
      if (a.o === b.o || a.h.has(b)) continue;
      const dx = a.x - b.x, dy = a.y - b.y, m = a.r + b.r;
      if (dx * dx + dy * dy < m * m) { a.h.add(b); b.h.add(a); a.pen -= 1; b.pen -= 1; }
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) if (bullets[i].pen <= 0) bullets.splice(i, 1);
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i]; if (!t.alive) continue;
    const r = rad(t);
    for (const s of shapes) {
      if (s.hp <= 0) continue;
      const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy), m = r + s.r;
      if (d < m && d > 0) {
        const p = (m - d) / d * .5;
        t.x += dx * p; t.y += dy * p; s.x -= dx * p; s.y -= dy * p; s.vx -= dx / d * .15; s.vy -= dy / d * .15;
        hitShape(s, (1 + t.st[2] * .8) * .5 * (CL[t.cls].bd || 1), t);
        hurtTank(t, s.dmg, null);
      }
    }
    for (let j = i + 1; j < tanks.length; j++) {
      const o = tanks[j]; if (!o.alive) continue;
      const dx = t.x - o.x, dy = t.y - o.y, d = Math.hypot(dx, dy), m = r + rad(o);
      if (d < m && d > 0) {
        const p = (m - d) / d * .5;
        t.x += dx * p; t.y += dy * p; o.x -= dx * p; o.y -= dy * p;
        hurtTank(o, (1 + t.st[2] * .8) * .4 * (CL[t.cls].bd || 1), t);
        hurtTank(t, (1 + o.st[2] * .8) * .4 * (CL[o.cls].bd || 1), o);
      }
    }
  }
  shapes = shapes.filter(s => s.hp > 0);
  if (shapes.length < NSH && frame % 15 === 0) spawnShape();
  if (frame % 3 === 0) broadcast();   // 초당 20번 상태 전송
  if (frame % 60 === 0) balance();
}

// 사람이 적으면 봇으로 채우고, 사람이 늘면 봇을 줄임
function balance() {
  const humans = tanks.filter(t => t.ws).length, bots = tanks.filter(t => t.bot), want = Math.max(0, MINT - humans);
  while (bots.length < want) { const b = mk(NAMES[Math.floor(Math.random() * NAMES.length)], true); tanks.push(b); bots.push(b); }
  while (bots.length > want) { const b = bots.pop(); b.alive = false; tanks.splice(tanks.indexOf(b), 1); }
}

// 각 플레이어에게는 화면에 보이는 범위만 보냄 (데이터 절약)
function broadcast() {
  if (!wss.clients.size) return;
  const alive = tanks.filter(t => t.alive);
  const L = alive.slice().sort((a, b) => b.score - a.score).slice(0, 10).map(t => [t.id, t.name, Math.floor(t.score)]);
  for (const ws of wss.clients) {
    const p = ws.p;
    if (!p || ws.readyState !== 1 || ws.bufferedAmount > 262144) continue;
    const px = p.x, py = p.y, vw = p.vw, vh = p.vh, T = [], S = [], Bu = [];
    for (const t of alive) if (Math.abs(t.x - px) < vw && Math.abs(t.y - py) < vh)
      T.push([t.id, r1(t.x), r1(t.y), r1(t.vx), r1(t.vy), Math.round(t.angle * 100) / 100, Math.round(t.hp), maxhp(t), t.level, t.cls, t.name, t.hurt, t.recoil, frame < t.inv ? 1 : 0, t.bot ? 1 : 0]);
    for (const s of shapes) if (s.hp > 0 && Math.abs(s.x - px) < vw && Math.abs(s.y - py) < vh)
      S.push([s.id, s.t, r1(s.x), r1(s.y), Math.round(s.a * 100) / 100, Math.round(s.va * 1000) / 1000, Math.round(s.vx * 100) / 100, Math.round(s.vy * 100) / 100, s.hurt]);
    for (const b of bullets) if (Math.abs(b.x - px) < vw && Math.abs(b.y - py) < vh)
      Bu.push([b.id, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), r1(b.r), b.kd, b.o.id]);
    const y = { id: p.id, xp: Math.floor(p.xp), nd: need(p.level), sc: Math.floor(p.score), pts: p.pts, st: p.st, lv: p.level, cls: p.cls, op: opts(p), al: p.alive ? 1 : 0 };
    ws.send(JSON.stringify({ t: 's', y, T, S, B: Bu, L, M: [[Math.round(p.x / 10), Math.round(p.y / 10), p.id]] }));   // 미니맵에는 내 위치만
  }
}

// ---------- 접속 처리 ----------
function humanCount() { let n = 0; for (const t of tanks) if (t.ws) n++; return n; }
wss.on('connection', ws => {
  ws.p = null; ws.mc = 0; ws.isAlive = true;
  if (wss.clients.size > MAXP + 20) { send(ws, { t: 'full' }); return ws.close(); }
  ws.send(HELLO);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', d => {
    if (++ws.mc > 150) return ws.terminate();   // 초당 150개 넘게 보내면 차단
    let m; try { m = JSON.parse(d); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const p = ws.p, n = x => Number.isFinite(x) ? x : 0;
    if (m.t === 'join') {
      if (p && p.alive) return;
      if (!p && humanCount() >= MAXP) { send(ws, { t: 'full' }); return; }
      if (p) tanks.splice(tanks.indexOf(p), 1);
      const name = String(m.name || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 12) || 'Player';
      const t = mk(name, false); t.ws = ws; t.li = Date.now(); ws.p = t; tanks.push(t); balance();
      send(ws, { t: 'spawn', id: t.id });
    } else if (m.t === 'in') {
      if (!p || !p.alive) return;
      let ax = n(m.ax), ay = n(m.ay); const l = Math.hypot(ax, ay);
      if (l > 1) { ax /= l; ay /= l; }
      p.ax = ax; p.ay = ay; p.angle = n(m.a); p.fire = !!m.f;
      p.mx = clamp(n(m.mx), -3000, 3000); p.my = clamp(n(m.my), -3000, 3000);
      p.vw = clamp(n(m.vw), 300, 3500); p.vh = clamp(n(m.vh), 200, 2200); p.li = Date.now();
    } else if (m.t === 'up') {
      if (p) up(p, m.i | 0);
    } else if (m.t === 'cls') {
      if (p && p.alive && opts(p).includes(m.n)) { p.cls = m.n; p.tier++; }
    }
  });
  ws.on('close', () => {
    if (ws.p) { ws.p.alive = false; ws.p.ws = null; const i = tanks.indexOf(ws.p); if (i >= 0) tanks.splice(i, 1); ws.p = null; balance(); }
  });
  ws.on('error', () => {});
});

function start() {
  for (let i = 0; i < NSH; i++) spawnShape();
  balance();
  let last = Date.now(), acc = 0;
  const STEP = 1000 / 60;
  setInterval(() => {
    const n = Date.now(); acc += Math.min(100, n - last); last = n;
    while (acc >= STEP) { update(); acc -= STEP; }
  }, 5);
  setInterval(() => { wss.clients.forEach(ws => { ws.mc = 0; }); }, 1000);
  setInterval(() => {   // 끊긴 연결 정리
    wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
  }, 30000);
  server.listen(PORT, '0.0.0.0', () => console.log('TANK.io server listening on ' + PORT));
}
if (require.main === module) start();
else module.exports = { tanks, shapes, bullets, mk, gain, up, opts, update, CL, T1, T2, shoot, balance, spawnShape, getFrame: () => frame, wss, server };

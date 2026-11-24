/* Local demo store + simulated server. Operations mirror the planned server API:
   list_nearby, send_request, respond_to_request, cancel_request, send_message, mark_read, block_user, report_user. */
(() => {
  const KEY = 'nearby-chat-demo-v3';
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
  if (!S || S.v !== 3) S = NC.seed();
  let fx = null; // stress fixture lives in memory only
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage unavailable: demo runs in memory */ } };

  const users = () => (fx ? { ...S.users, ...fx.users } : S.users);
  const convos = () => (fx ? [...S.convos, ...fx.convos] : S.convos);
  const pair = (a, b) => (x) => x.members.includes(a) && x.members.includes(b);
  const other = (c, me) => c.members.find((m) => m !== me);
  const blockedEither = (a, b) => S.blocks.some((x) => (x.by === a && x.who === b) || (x.by === b && x.who === a));
  const iBlocked = (who) => S.blocks.some((x) => x.by === S.me && x.who === who);
  const live = (u) => u.tonight && u.tonight.until > Date.now();

  const q = {
    users, convos, live, blockedEither, iBlocked, other,
    u: (id) => users()[id],
    meU: () => S.users[S.me],
    set: () => S.settings[S.me] || (S.settings[S.me] = { approx: false, notif: true }),
    convo: (id) => convos().find((c) => c.id === id),
    convoWith: (id) => S.convos.find(pair(S.me, id)),
    unreadOf: (c) => c.msgs.slice(c.read[S.me] || 0).filter((m) => m.from !== S.me).length,
    myConvos: () => convos().filter((c) => c.members.includes(S.me) && !S.deleted[other(c, S.me)])
      .map((c) => { const id = other(c, S.me); return { c, id, other: users()[id], last: c.msgs[c.msgs.length - 1], unread: q.unreadOf(c), mine: S.me }; })
      .sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0)),
    unreadTotal: () => q.myConvos().reduce((n, x) => n + (blockedEither(S.me, x.id) ? 0 : x.unread), 0),
    incoming: () => S.requests.filter((r) => r.to === S.me && r.status === 'pending' && !blockedEither(r.from, S.me)),
    sent: () => S.requests.filter((r) => r.from === S.me && r.status === 'pending'),
    pendingWith: (id) => S.requests.find((r) => r.status === 'pending' && ((r.from === S.me && r.to === id) || (r.from === id && r.to === S.me))),
    nearby: (city) => Object.entries(S.users)
      .filter(([id, u]) => id !== S.me && u.city === city && u.discoverable && !S.deleted[id] && !blockedEither(S.me, id))
      .sort(([, a], [, b]) => (live(b) - live(a)) || (q.shared(b).length - q.shared(a).length)),
    shared: (u) => (u.tags || []).filter((t) => (q.meU().tags || []).includes(t)),
    // The Drop: up to six people picked by shared interests, excluding anyone already in contact.
    drop: (city) => q.nearby(city).filter(([id]) => !q.convoWith(id) && !q.pendingWith(id))
      .sort(([, a], [, b]) => q.shared(b).length - q.shared(a).length).slice(0, 6),
    // Distance band only when both people opted in; never coordinates.
    place: (id) => { const u = users()[id], me = q.meU(); return q.set().approx && S.demo.perm === 'granted' && u.loc && u.city === me.city ? u.band : u.city; },
    // Spark: how many times the conversation changed hands in the last 48h (0–5).
    sparkLevel: (c) => {
      const recent = c.msgs.filter((m) => Date.now() - m.at < 48 * 3600e3 && m.status === 'sent');
      let turns = 0; recent.forEach((m, i) => { if (i && m.from !== recent[i - 1].from) turns++; });
      return Math.min(5, Math.ceil(turns / 2));
    },
  };

  /* Simulated network. Latency is a demo setting; nothing is marked sent until this resolves. */
  const LAT = { fast: [120, 260], slow: [1800, 3200] };
  const net = () => new Promise((res, rej) => {
    if (S.demo.net === 'offline') return setTimeout(() => rej(new Error('offline')), 350);
    const [a, b] = LAT[S.demo.net] || LAT.fast;
    const fail = S.demo.failNext; S.demo.failNext = false;
    setTimeout(() => (fail ? rej(new Error('server')) : res()), a + Math.random() * (b - a));
  });

  const uid = () => Math.random().toString(36).slice(2, 10);

  const act = {
    async sendRequest(to, note = '', prompt = null, snap = false) {
      if (q.pendingWith(to) || q.convoWith(to) || blockedEither(S.me, to)) throw new Error('exists');
      await net();
      S.requests.push({ id: uid(), from: S.me, to, status: 'pending', at: Date.now(), note, prompt, snap });
    },
    async respond(rid, accept) {
      await net();
      const r = S.requests.find((x) => x.id === rid);
      if (!r || r.status !== 'pending') return null;
      r.status = accept ? 'accepted' : 'declined';
      if (!accept) return null;
      let c = S.convos.find(pair(r.from, r.to)); // one conversation per unordered pair
      if (!c) {
        c = { id: uid(), members: [r.from, r.to], msgs: [], read: { [r.from]: 0, [r.to]: 0 } };
        if (r.note) c.msgs.push({ id: uid(), cid: uid(), seq: 1, type: 'text', from: r.from, text: r.note, quote: r.prompt, at: r.at, status: 'sent' });
        if (r.snap) c.msgs.push({ id: uid(), cid: uid(), seq: c.msgs.length + 1, type: 'snap', from: r.from, photo: 'l22', secs: NC.SNAP_SECS, viewed: false, at: r.at + 1000, status: 'sent' });
        S.convos.push(c);
      }
      return c;
    },
    async cancel(rid) { await net(); const r = S.requests.find((x) => x.id === rid); if (r) r.status = 'cancelled'; },
    // Optimistic: returns the pending message at once plus a promise for the server result. Retries reuse cid.
    send(c, payload, cid = uid()) {
      let m = c.msgs.find((x) => x.cid === cid);
      if (!m) { m = { id: cid, cid, from: S.me, at: Date.now(), type: 'text', ...payload }; c.msgs.push(m); }
      m.status = 'sending';
      c.read[S.me] = c.msgs.length;
      const done = (async () => {
        await net();
        if (blockedEither(...c.members)) throw new Error('blocked');
        m.status = 'sent'; m.seq = c.msgs.indexOf(m) + 1;
      })().catch((e) => { m.status = 'failed'; throw e; });
      return { m, done };
    },
    markRead(c) { c.read[S.me] = Math.max(c.read[S.me] || 0, c.msgs.length); },
    block(who) {
      if (!iBlocked(who)) S.blocks.push({ by: S.me, who, at: Date.now() });
      S.requests.forEach((r) => { if (r.status === 'pending' && [r.from, r.to].includes(who) && [r.from, r.to].includes(S.me)) r.status = 'cancelled'; });
    },
    unblock(who) { S.blocks = S.blocks.filter((x) => !(x.by === S.me && x.who === who)); },
    report(who, reason, note, evidence) { S.reports.push({ by: S.me, who, reason, note, evidence, at: Date.now() }); },
    // A one-tap Wave/Spark: lands in the thread as a sticker message and goes through the same simulated server.
    sendSpark(c) { return act.send(c, { type: 'spark', text: '✨ Spark' }); },
    setTonight(t) { q.meU().tonight = t ? { ...t, at: Date.now(), until: Date.now() + 24 * 3600e3 } : null; },
    stress(on) { fx = on ? NC.stressFixture(S.me) : null; S.demo.stress = on; },
    reset() { const demo = S.demo; S = NC.seed(); S.demo = { ...demo, stress: false }; fx = null; save(); },
  };
  if (S.demo.stress) act.stress(true);

  NC.store = { get S() { return S; }, q, act, save, net };
})();

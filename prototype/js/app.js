/* Router, transitions, gestures, actions and demo controls. */
{
  const { esc } = NC;
  const { q, act, save } = NC.store;
  const S = () => NC.store.S;
  const $ = (s, el = document) => el.querySelector(s);
  const phone = $('#phone'), screen = $('#screen'), overlay = $('#overlay'), toastEl = $('#toast'), tabbar = $('#tabbar'), fx = $('#fx');
  let hold = null, renderDeferred = false, suppressClick = false, lastPoint = null;

  /* ---------- theme (System / Light / Dark, persisted; applied before first paint by the inline head script) ---------- */
  const mq = matchMedia('(prefers-color-scheme: dark)');
  NC.theme = {
    get: () => { try { return localStorage.getItem('nc-theme') || 'system'; } catch { return 'system'; } },
    set(v) { try { localStorage.setItem('nc-theme', v); } catch { /* not persisted */ } NC.theme.apply(); },
    apply() { const v = NC.theme.get(); document.documentElement.dataset.app = v === 'system' ? (mq.matches ? 'dark' : 'light') : v; },
  };
  mq.addEventListener('change', () => NC.theme.apply());
  NC.theme.apply();

  let stack = [{ s: 'chats', p: {} }];
  let sheet = null, lastDir = 0;
  const cur = () => stack[stack.length - 1];
  const reduced = () => S().demo.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vt = (fn) => {
    if (!document.startViewTransition || reduced()) return fn();
    const t = document.startViewTransition(fn);
    [t.ready, t.finished].forEach((p) => p.catch(() => {})); // aborted when the tab is hidden: the DOM update still runs
    return t;
  };

  /* ---------- navigation ---------- */
  function remember() { const sc = $('#sc'); if (sc) cur().p._scroll = sc.scrollTop; }
  function go(s, p = {}, { transition = false } = {}) {
    remember(); stack.push({ s, p });
    if (transition) vt(() => { lastDir = 0; render(); }); else { lastDir = 1; render(); }
  }
  function back() {
    if (stack.length < 2) return;
    const leaving = cur(); stack.pop();
    if (leaving.s === 'profile' && cur().s === 'nearby') { cur().p.heroId = leaving.p.id; vt(() => { lastDir = 0; render(); }); return; }
    lastDir = -1; render();
  }
  function tab(s) { remember(); stack = [{ s, p: stack[0].s === s ? stack[0].p : {} }]; lastDir = 0; render(); }

  /* ---------- rendering ---------- */
  function render() {
    if (hold) { renderDeferred = true; return; } // never swap the DOM under a held snap
    const r = cur();
    const th = $('#thread');
    const before = th ? { top: th.scrollTop, h: th.scrollHeight, atBottom: th.scrollHeight - th.scrollTop - th.clientHeight < 60 } : null;
    const focus = document.activeElement?.id, selEnd = document.activeElement?.selectionEnd;
    const out = r.s === 'onboard' ? NC.onboard.render(r) : NC.screens[r.s](r);
    const tabRoot = { chats: 'chats', nearby: 'nearby', me: 'me' }[stack[0].s];
    phone.classList.toggle('photo-top', r.s === 'profile');
    screen.className = `screen tone-${out.tone} ${out.tabs ? 'has-tabs' : ''} ${lastDir ? (lastDir > 0 ? 'push' : 'pop') : ''}`;
    screen.innerHTML = out.html;
    updateTabs(tabRoot, out.tabs);
    renderSheet();
    if (focus && screen.contains(document.getElementById(focus))) { const el = document.getElementById(focus); el.focus({ preventScroll: true }); if (selEnd != null && el.setSelectionRange) try { el.setSelectionRange(selEnd, selEnd); } catch { /* non-text */ } }
    afterRender(r, before);
    lastDir = 0;
    renderDemo();
    save();
  }

  function afterRender(r, before) {
    const sc = $('#sc'); if (sc && r.p._scroll != null) sc.scrollTop = r.p._scroll;
    if (r.s === 'convo') {
      const c = q.convo(r.p.id); const th = $('#thread');
      if (c && (!before || before.atBottom)) { act.markRead(c); }
      if (th) {
        if (r.p._older && before) { th.scrollTop = th.scrollHeight - (before.h - before.top); r.p._older = false; }
        else if (!before || before.atBottom || r.p._toBottom) { th.scrollTop = th.scrollHeight; r.p._toBottom = false; r.p.pill = false; }
        else th.scrollTop = before.top;
        th.onscroll = () => {
          if (!th.isConnected) return; // stale events from a replaced thread must not trigger paging
          if (th.scrollTop < 40 && c && c.msgs.length > (r.p.limit || NC.PAGE) && !r.p._older) loadOlder();
          if (r.p.pill && th.scrollHeight - th.scrollTop - th.clientHeight < 60) { r.p.pill = false; act.markRead(c); $('.new-pill')?.remove(); }
        };
      }
      autosize();
    }
    if (r.s === 'profile') wireGallery();
    if (r.s === 'nearby') { if (r.p.heroId) setTimeout(() => { r.p.heroId = null; }, 400); if (r.p.loading) setTimeout(() => { if (cur() === r) { r.p.loading = false; render(); } }, 650); }
  }

  function loadOlder() { const r = cur(); r.p.limit = (r.p.limit || NC.PAGE) + NC.PAGE; r.p._older = true; render(); }

  function refreshChatList() {
    const r = cur(); if (r.s !== 'chats') return;
    const tmp = document.createElement('div'); tmp.innerHTML = NC.screens.chats(r).html;
    $('#chat-list').replaceWith(tmp.querySelector('#chat-list'));
  }

  function wireGallery() {
    const g = $('#gal'); if (!g) return;
    const dots = [...screen.querySelectorAll('.dots i')];
    g.addEventListener('scroll', () => { const i = Math.round(g.scrollLeft / g.clientWidth); dots.forEach((d, k) => d.classList.toggle('on', k === i)); }, { passive: true });
    g.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') galStep(1); if (e.key === 'ArrowLeft') galStep(-1); });
  }
  function galStep(d) {
    const g = $('#gal'); if (!g) return;
    const i = Math.max(0, Math.min(g.children.length - 1, Math.round(g.scrollLeft / g.clientWidth) + d));
    g.scrollTo({ left: i * g.clientWidth, behavior: reduced() ? 'auto' : 'smooth' });
  }

  /* ---------- toast & sheets ---------- */
  let tt;
  function toast(msg, action) {
    toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-a="${action.a}" data-id="${esc(action.id || '')}">${esc(action.label)}</button>` : ''}`;
    toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3800);
  }
  function openSheet(kind, data = {}) { sheet = { kind, data }; renderSheet(); setTimeout(() => overlay.querySelector('[data-focus], button, input')?.focus(), 40); }
  function closeSheet() { sheet = null; renderSheet(); }
  function renderSheet() {
    if (!sheet) { overlay.innerHTML = ''; overlay.className = ''; return; }
    const { html, alert } = NC.sheet(sheet.kind, sheet.data);
    overlay.className = alert ? 'show alert' : 'show';
    overlay.innerHTML = `<div class="scrim" data-a="close-sheet"></div>${alert ? html : `<div class="sheet glass-sheet" role="dialog" aria-modal="true"><span class="grab"></span>${html}</div>`}`;
  }

  /* ---------- messaging ---------- */
  function sendIn(c, payload, cid) {
    const { m, done } = act.send(c, payload, cid);
    const r = cur(); r.p._toBottom = true; render();
    done.then(() => { NC.haptic(); maybeReply(c); }).catch(() => {}).finally(() => { if (cur().s === 'convo' && cur().p.id === c.id) render(); else save(); });
    return m;
  }

  function incoming(c, msg) {
    c.msgs.push({ id: Math.random().toString(36).slice(2), cid: '', seq: c.msgs.length + 1, at: Date.now(), status: 'sent', type: 'text', ...msg });
    const r = cur(), open = r.s === 'convo' && r.p.id === c.id;
    if (open) {
      r.p.typing = false;
      const th = $('#thread'), atBottom = th && th.scrollHeight - th.scrollTop - th.clientHeight < 60;
      if (!atBottom) r.p.pill = true;
      render();
    } else if (r.s === 'chats') refreshChatList(), renderTabsBadge();
    else { render(); toast(`New message from ${q.u(msg.from).name}`, { a: 'open-convo', id: c.id, label: 'View' }); }
  }
  function renderTabsBadge() { updateTabs(stack[0].s, true); }

  // Fictional NPCs reply so threads feel alive; persona-to-persona chats wait for the other persona.
  function maybeReply(c) {
    const oid = q.other(c, S().me);
    if (['maya', 'kabir'].includes(oid) || q.blockedEither(S().me, oid) || q.u(oid).fixture) return;
    const me = S().me;
    setTimeout(() => {
      if (cur().s === 'convo' && cur().p.id === c.id) { cur().p.typing = true; render(); }
      setTimeout(() => { if (S().me === me && !q.blockedEither(me, oid)) incoming(c, { from: oid, text: NC.REPLIES[c.msgs.length % NC.REPLIES.length] }); }, 1400);
    }, 800);
  }

  function openConvo(id) {
    const c = q.convo(id);
    const unread = q.unreadOf(c) > 0;
    go('convo', { id, divider: unread ? c.read[S().me] || 0 : null, limit: Math.max(NC.PAGE, q.unreadOf(c) + 6) });
    // Simulated presence: someone "viewing now" peeks over the composer for a few seconds.
    const other = q.other(c, S().me);
    if (!['maya', 'kabir'].includes(other) && !q.u(other).fixture) {
      setTimeout(() => { const r = cur(); if (r.s === 'convo' && r.p.id === id && !hold) { r.p.present = true; render(); } }, 1400);
      setTimeout(() => { const r = cur(); if (r.s === 'convo' && r.p.id === id && r.p.present && !hold) { r.p.present = false; render(); } }, 9000);
    }
  }
  const autosize = () => { const t = $('#msg'); if (t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; } };
  const curConvo = () => q.convo(cur().p.id);
  const findMsg = (cid) => { for (const c of q.convos()) { const m = c.msgs.find((x) => x.cid === cid); if (m) return { c, m }; } return {}; };

  /* ---------- actions ---------- */
  const A = {
    back, tab,
    go: (id) => {
      if (id === 'edit') { const u = q.meU(); go('edit', { draft: { name: u.name, bio: u.bio, city: u.city, photos: [...u.photos], tags: [...(u.tags || [])], prompts: (u.prompts || []).map((p) => ({ ...p })) } }); }
      else if (id === 'delete') go('delete', { typed: '' });
      else go(id);
    },
    'find-nearby': () => tab('nearby'),
    'open-convo': (id) => { closeSheet(); openConvo(id); },
    'open-profile': (id) => go('profile', { id }, { transition: cur().s === 'nearby' }),
    'req-tab': (id) => { cur().p.tab = id; render(); },
    'send-req': async (id) => {
      const r = cur(); r.p.busy = 'send'; render();
      try { await act.sendRequest(id); NC.haptic(); toast(`Request sent to ${q.u(id).name}`); }
      catch { toast(S().demo.net === 'offline' ? "You're offline. Request not sent." : 'Couldn’t send. Try again.'); }
      r.p.busy = null; if (cur() === r) render();
    },
    ask: (v) => { const [id, pi] = v.split('|'); openSheet('ask', { id, pi: +pi }); },
    'ask-sug': (s) => { const t = $('#ask-note'); t.value = s; t.focus(); },
    'cancel-req': async (rid) => {
      const r = cur(); r.p.busy = { ...(r.p.busy || {}), [rid]: 'cancel' }; if (r.s === 'profile') r.p.busy = 'send'; render();
      try { await act.cancel(rid); toast('Request cancelled'); } catch { toast('Couldn’t cancel. Try again.'); }
      r.p.busy = null; if (cur() === r) render();
    },
    review: (rid) => openSheet('review', { rid }),
    accept: async (rid) => {
      closeSheet(); const r = cur(); r.p.busy = { [rid]: 'accept' }; render();
      const from = S().requests.find((x) => x.id === rid)?.from;
      try { const c = await act.respond(rid, true); NC.haptic(); burst(); if (c) toast(`You and ${q.u(from).name} can chat now`, { a: 'open-convo', id: c.id, label: 'Open chat' }); }
      catch { toast('Couldn’t accept. Try again.'); }
      r.p.busy = null; if (cur() === r) render();
    },
    decline: async (rid) => {
      closeSheet(); const r = cur(); r.p.busy = { [rid]: 'decline' }; render();
      try { await act.respond(rid, false); toast('Request declined'); } catch { toast('Couldn’t decline. Try again.'); }
      r.p.busy = null; if (cur() === r) render();
    },
    retry: (cid) => { const { c, m } = findMsg(cid); if (c) sendIn(c, {}, m.cid); },
    older: loadOlder,
    'to-bottom': () => { cur().p._toBottom = true; act.markRead(curConvo()); render(); },
    'convo-menu': () => openSheet('menu', { id: q.other(curConvo(), S().me), convo: true }),
    'profile-menu': (id) => openSheet('menu', { id }),
    'view-profile': (id) => { closeSheet(); go('profile', { id }); },
    'sim-fail': () => { S().demo.failNext = true; closeSheet(); render(); toast('Next send will fail. Tap the bubble to retry.'); },
    'sim-in': (id) => { closeSheet(); const c = curConvo(); setTimeout(() => incoming(c, { from: id, text: 'Also — are you free Saturday?' }), 600); toast('Scroll up — a message arrives in a moment'); },
    report: (id) => openSheet('report', { id }),
    block: (id) => openSheet('block', { id }),
    'confirm-block': (id) => { act.block(id); closeSheet(); render(); toast(`${q.u(id).name} is blocked`); },
    unblock: (id) => { act.unblock(id); render(); toast(`${q.u(id).name} is unblocked`); },
    'close-sheet': closeSheet,
    gal: (d) => galStep(+d),
    'pick-city': (target) => openSheet('city', { target: target || (cur().s === 'edit' ? 'edit' : 'nearby'), current: cur().s === 'edit' ? cur().p.draft.city : (S().nearbyCity[S().me] || q.meU().city) }),
    'set-city': (c) => {
      if (sheet.data.target === 'edit') cur().p.draft.city = c;
      else { S().nearbyCity[S().me] = c; cur().p.loading = true; cur().p.denied = false; }
      closeSheet(); render();
    },
    'tonight-filter': () => { cur().p.tonight = !cur().p.tonight; render(); },
    'use-loc': () => { if (S().demo.perm === 'denied') { cur().p.denied = true; render(); } else openSheet('perm', { from: cur().s }); },
    'loc-off': () => { q.set().approx = false; render(); toast('Distance off. Your location cell was cleared.'); },
    'perm-allow': () => { S().demo.perm = 'granted'; q.set().approx = true; closeSheet(); cur().p.denied = false; render(); toast('Showing approximate distances'); },
    'perm-deny': () => { S().demo.perm = 'denied'; q.set().approx = false; closeSheet(); cur().p.denied = true; render(); },
    'open-settings': () => openSheet('settings'),
    'resume-disc': () => { q.meU().discoverable = true; render(); },
    theme: (v) => { NC.theme.set(v); render(); },
    tonight: () => openSheet('tonight'),
    'tn-sug': (s) => { $('#tn-text').value = s; },
    'tn-clear': () => { act.setTonight(null); closeSheet(); render(); toast('Tonight status removed'); },
    safety: () => openSheet('safety'),
    icebreak: () => openSheet('icebreak'),
    'ib-send': (i) => { const c = NC.ICEBREAKERS[+i]; closeSheet(); sendIn(curConvo(), { type: 'card', kind: c.kind, q: c.q, opts: c.opts }); },
    'ib-answer': (v) => {
      const [cid, ans] = v.split('|'); const { c, m } = findMsg(cid); if (!m) return;
      m.answer = ans; sendIn(c, { type: 'text', text: ans, quote: m.q });
    },
    'ib-free': (cid) => { const { m } = findMsg(cid); const t = $('#msg'); cur().p.draft = ''; t.value = ''; t.placeholder = `Answer: ${m.q}`; t.focus(); cur().p.quote = m.q; },
    plan: () => openSheet('plan', { place: 0, when: 0 }),
    'plan-new': () => openSheet('plan', { place: 0, when: 0 }),
    'plan-place': (i) => { sheet.data.place = +i; renderSheet(); },
    'plan-when': (i) => { sheet.data.when = +i; renderSheet(); },
    'plan-send': () => { const { place, when } = sheet.data; closeSheet(); sendIn(curConvo(), { type: 'plan', place: NC.PLACES[place], when: NC.WHEN[when], status: 'proposed' }); },
    'plan-ok': (cid) => { const { c, m } = findMsg(cid); m.status = 'confirmed'; m.statusBy = S().me; NC.haptic(); burst(); sendIn(c, { type: 'text', text: `Confirmed: ${m.place[0]}, ${m.when}` }); toast('Plan confirmed. Share it with someone you trust.'); },
    'plan-share': (cid) => {
      const { c, m } = findMsg(cid); const o = q.u(q.other(c, S().me));
      openSheet('share', { text: `I'm meeting ${o.name} (from Nearby Chat)\n${m.place[0]}, ${m.place[1]}\n${m.when}\nI'll check in after.` });
    },
    'copy-share': () => { const t = $('.share-txt').textContent; navigator.clipboard?.writeText(t).then(() => toast('Copied'), () => toast('Select the text to copy')); },
    'ph-add': (id) => { const n = id === 'ob' ? cur().p.photos.length : cur().p.draft.photos.length; if (n >= 4) return toast('You can add up to 4 photos.'); openSheet('photos', { ob: id === 'ob' }); },
    'pick-photo': (p) => { const list = sheet.data.ob ? cur().p.photos : cur().p.draft.photos; if (list.length < 4) list.push(p); cur().p.err = ''; closeSheet(); render(); },
    'ph-rm': (i) => { cur().p.draft.photos.splice(+i, 1); render(); },
    'ph-mv': (v) => { const [i, d] = v.split(':').map(Number); const ph = cur().p.draft.photos; [ph[i], ph[i + d]] = [ph[i + d], ph[i]]; render(); },
    tag: (t) => { const tags = cur().p.draft.tags; const k = tags.indexOf(t); if (k >= 0) tags.splice(k, 1); else if (tags.length < 6) tags.push(t); else return toast('Up to 6 interests'); render(); },
    'ob-tag': (t) => { const o = cur().p; o.tags = o.tags || []; const k = o.tags.indexOf(t); if (k >= 0) o.tags.splice(k, 1); else if (o.tags.length < 6) o.tags.push(t); o.err = ''; render(); },
    'save-profile': () => {
      const d = cur().p.draft;
      if (!d.name.trim()) { cur().p.err = 'Add your name.'; return render(); }
      if (!d.photos.length) { cur().p.err = 'Keep at least one photo.'; return render(); }
      Object.assign(q.meU(), { name: d.name.trim(), bio: d.bio.trim(), city: d.city, photos: [...d.photos], tags: [...d.tags], prompts: d.prompts.filter((p) => p.a.trim()).map((p) => ({ q: p.q, a: p.a.trim() })) });
      S().nearbyCity[S().me] = d.city;
      stack.pop(); go('profile', { id: S().me }); NC.haptic(); toast('Saved — this is how others see you');
    },
    'do-delete': () => { S().deleted[S().me] = true; stack = [{ s: 'deleted', p: {} }]; render(); },
    reset: () => { act.reset(); stack = [{ s: 'chats', p: {} }]; render(); toast('Demo data restored'); },
    onboard: () => { stack = [{ s: 'onboard', p: { step: 'email', photos: [], tags: [] } }]; render(); },
    'ob-back': () => { NC.onboard.back(cur().p); render(); },
    'ob-loc': () => { if (S().demo.perm === 'denied') { cur().p.denied = true; render(); } else openSheet('perm', { from: 'ob' }); },
    'ob-ph-rm': (i) => { cur().p.photos.splice(+i, 1); render(); },
    persona: (id) => { remember(); S().me = id; if (S().demo.stress) act.stress(true); const root = ['onboard', 'deleted'].includes(stack[0].s) ? 'chats' : stack[0].s; stack = [{ s: root, p: {} }]; closeSheet(); render(); toast(`Signed in as ${q.u(id).name}`); },
  };

  /* ---------- persistent glass nav: one element so the active pill can slide ---------- */
  const TAB_ORDER = ['chats', 'nearby', 'me'];
  function updateTabs(active, show) {
    const idx = Math.max(0, TAB_ORDER.indexOf(active));
    tabbar.style.setProperty('--i', idx);
    tabbar.classList.toggle('hide', !show);
    tabbar.setAttribute('aria-hidden', show ? 'false' : 'true');
    tabbar.toggleAttribute('inert', !show);
    tabbar.querySelectorAll('.tab').forEach((b, i) => { b.classList.toggle('on', i === idx); if (i === idx) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const n = q.unreadTotal(), bd = tabbar.querySelector('[data-badge=chats]');
    bd.hidden = !n; bd.textContent = n > 99 ? '99+' : String(n); bd.setAttribute('aria-label', `${n} unread messages`);
  }

  /* ---------- playful bursts (off under Reduce Motion) ---------- */
  function burst(pt = lastPoint) {
    if (reduced()) return;
    const box = phone.querySelector('.device').getBoundingClientRect();
    const x = pt ? pt.x - box.left : box.width / 2, y = pt ? pt.y - box.top : box.height * 0.6;
    const colors = ['#FB7185', '#F97316', '#F59E0B', '#34D399', '#A855F7', '#38BDF8'];
    for (let i = 0; i < 18; i++) {
      const el = document.createElement('i'), a = (i / 18) * Math.PI * 2 + Math.random() * 0.5, d = 46 + Math.random() * 64;
      el.className = 'confetti'; el.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 24}px;--r:${Math.round(Math.random() * 360)}deg`;
      fx.appendChild(el); setTimeout(() => el.remove(), 900);
    }
  }

  /* ---------- hold-to-view snap ---------- */
  function startHold(el) {
    if (hold) return;
    const { m } = findMsg(el.dataset.snap); if (!m || m.viewed) return;
    const label = el.querySelector('[data-snap-label]'), bar = el.querySelector('.snap-bar i'), total = m.secs * 1000, t0 = performance.now();
    hold = { el, cid: m.cid, raf: 0, timer: setTimeout(endHold, total + 30) }; // timer is the guaranteed close; rAF only draws the countdown
    el.classList.add('holding'); NC.haptic();
    const tick = () => {
      const left = Math.max(0, total - (performance.now() - t0));
      label.textContent = `Viewing · ${Math.ceil(left / 1000)}s`; bar.style.transform = `scaleX(${left / total})`;
      if (left <= 0) endHold(); else if (hold) hold.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function endHold() {
    if (!hold) return;
    cancelAnimationFrame(hold.raf); clearTimeout(hold.timer);
    const { m } = findMsg(hold.cid); if (m) m.viewed = true; // the photo is gone once released
    hold = null; renderDeferred = false; NC.haptic(); render(); toast('Snap viewed — it’s gone now');
  }
  document.addEventListener('pointerdown', (e) => { const el = e.target.closest('[data-snap]'); if (el) { e.preventDefault(); startHold(el); } });
  ['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, endHold));
  document.addEventListener('keydown', (e) => { const el = e.target.closest?.('[data-snap]'); if (el && (e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startHold(el); } });
  document.addEventListener('keyup', (e) => { if (hold && (e.key === ' ' || e.key === 'Enter')) endHold(); });
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-snap]')) e.preventDefault(); });

  /* ---------- voice note playback (simulated) ---------- */
  const playing = new Map();
  function stopVoice(cid) {
    const p = playing.get(cid); if (!p) return;
    clearInterval(p.t); playing.delete(cid);
    const box = $(`[data-voice="${cid}"]`); if (box) { box.classList.remove('playing'); box.querySelector('.voice-t').textContent = NC.mmss(p.secs); box.querySelector('.voice-play').innerHTML = NC.icon('play'); }
  }

  /* ---------- swipe-right on a chat row sends a Spark ---------- */
  let sw = null;
  document.addEventListener('pointerdown', (e) => {
    const w = e.target.closest('.row-wrap'); if (!w || e.target.closest('.spark-btn') || !phone.contains(w)) return;
    sw = { w, row: w.querySelector('.row'), x0: e.clientX, y0: e.clientY, dx: 0, on: false };
  });
  document.addEventListener('pointermove', (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x0, dy = e.clientY - sw.y0;
    if (!sw.on) { if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } if (dx > 12 && dx > Math.abs(dy)) { sw.on = true; sw.w.classList.add('swiping'); } else return; }
    sw.dx = Math.max(0, Math.min(dx, 120)); sw.row.style.transform = `translateX(${sw.dx}px)`; sw.w.classList.toggle('armed', sw.dx > 72);
  });
  const endSwipe = () => {
    if (!sw) return; const s2 = sw; sw = null;
    if (!s2.on) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
    s2.row.style.transition = reduced() ? 'none' : 'transform .3s cubic-bezier(.34,1.56,.64,1)'; s2.row.style.transform = ''; s2.w.classList.remove('armed');
    setTimeout(() => { s2.row.style.transition = ''; s2.w.classList.remove('swiping'); }, 320);
    if (s2.dx > 72) { lastPoint = { x: s2.w.getBoundingClientRect().left + 80, y: s2.w.getBoundingClientRect().top + 36 }; A.spark(s2.w.dataset.swipe); }
  };
  document.addEventListener('pointerup', endSwipe); document.addEventListener('pointercancel', endSwipe);

  /* Deck dots follow the scroll position of the icebreaker deck. */
  overlay.addEventListener('scroll', (e) => {
    const d = e.target; if (d.id !== 'deck') return;
    const i = Math.round(d.scrollLeft / (d.firstElementChild.getBoundingClientRect().width + 12));
    overlay.querySelectorAll('.deck-dots i').forEach((k, n) => k.classList.toggle('on', n === i));
  }, true);

  Object.assign(A, {
    spark: (id) => {
      const c = q.convo(id); if (!c) return;
      if (q.blockedEither(...c.members)) return toast('This conversation is unavailable.');
      const { done } = act.sendSpark(c); burst(); NC.haptic();
      const name = q.u(q.other(c, S().me)).name;
      toast(`✨ Spark sent to ${name}`);
      const refresh = () => { if (cur().s === 'chats') { refreshChatList(); renderTabsBadge(); } else if (cur().s === 'convo' && cur().p.id === id) render(); else save(); };
      refresh(); done.then(refresh, () => { toast('Spark didn’t send. Open the chat to retry.'); refresh(); });
    },
    vibe: (id) => openSheet('vibe', { id }),
    'vibe-react': (e) => { const t = $('#vibe-note'); t.value = (t.value + ' ' + e).trim(); t.focus(); },
    react: (e) => { const t = $('#ask-note'); t.value = (t.value + ' ' + e).trim(); t.focus(); },
    'ask-snap': () => { const note = $('#ask-note')?.value || ''; sheet.data.snap = !sheet.data.snap; renderSheet(); const t = $('#ask-note'); if (t) t.value = note; },
    snap: () => openSheet('snap', { chosen: null }),
    'snap-pick': (p) => { sheet.data.chosen = p; renderSheet(); },
    'snap-send': () => { const { chosen } = sheet.data; closeSheet(); sendIn(curConvo(), { type: 'snap', photo: chosen, secs: NC.SNAP_SECS, viewed: false }); toast('Snap sent'); },
    'sim-snap': (id) => { closeSheet(); const c = curConvo(); setTimeout(() => incoming(c, { from: id, type: 'snap', photo: 'l33', secs: NC.SNAP_SECS, viewed: false }), 600); toast('A snap arrives in a moment'); },
    'plan-maybe': (cid) => { const { c, m } = findMsg(cid); m.status = 'maybe'; m.statusBy = S().me; sendIn(c, { type: 'text', text: 'Maybe — let me check my week' }); },
    'voice-play': (cid) => {
      if (playing.has(cid)) return stopVoice(cid);
      const { m } = findMsg(cid), box = $(`[data-voice="${cid}"]`); if (!m || !box) return;
      let t = 0; box.classList.add('playing'); box.querySelector('.voice-play').innerHTML = NC.icon('pause');
      const timer = setInterval(() => { t += 1; box.querySelector('.voice-t').textContent = NC.mmss(Math.min(t, m.secs)); if (t >= m.secs) stopVoice(cid); }, 1000);
      playing.set(cid, { t: timer, secs: m.secs });
    },
  });

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('click', (e) => {
    lastPoint = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null;
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled || !phone.contains(el)) return;
    const fn = A[el.dataset.a]; if (!fn) return;
    e.preventDefault(); fn(el.dataset.id);
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.tg) {
      const k = t.dataset.tg;
      if (k === 'disc') { q.meU().discoverable = t.checked; toast(t.checked ? 'You’re visible on Nearby' : 'Discovery paused'); }
      if (k === 'notif') q.set().notif = t.checked;
      if (k === 'approx') {
        if (!t.checked) { q.set().approx = false; toast('Location off. Your cell was cleared.'); }
        else if (S().demo.perm === 'denied') { t.checked = false; return openSheet('settings'); }
        else if (S().demo.perm !== 'granted') { t.checked = false; return openSheet('perm', { from: 'me' }); }
        else q.set().approx = true;
      }
      render();
    }
    if (t.dataset.pq) cur().p.draft.prompts[+t.dataset.pq] = { q: t.value, a: cur().p.draft.prompts[+t.dataset.pq]?.a || '' };
    if (t.dataset.demo) demoChange(t);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'search') { cur().p.term = t.value; refreshChatList(); }
    if (t.id === 'msg') { cur().p.draft = t.value; $('.send').disabled = !t.value.trim(); autosize(); }
    if (t.id === 'f-bio') $('#bio-n').textContent = `${t.value.length}/160`;
    if (t.id === 'ob-bio') $('#ob-bio-n').textContent = `${t.value.length}/160`;
    if (t.id === 'f-del') { cur().p.typed = t.value; $('[data-a=do-delete]').disabled = t.value !== 'DELETE'; }
    if (t.id === 'f-name') cur().p.draft.name = t.value;
    if (t.id === 'f-bio') cur().p.draft.bio = t.value;
    if (t.dataset.pa) { const i = +t.dataset.pa, d = cur().p.draft; d.prompts[i] = { q: d.prompts[i]?.q || $(`[data-pq="${i}"]`).value, a: t.value }; }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'msg' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); }
    if (e.key === 'Escape' && sheet) closeSheet();
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'composer') {
      const text = $('#msg').value.trim(); if (!text) return;
      const quote = cur().p.quote; cur().p.draft = ''; cur().p.divider = null; cur().p.quote = null;
      sendIn(curConvo(), { type: 'text', text, ...(quote ? { quote } : {}) });
    }
    if (f.id === 'report-form') {
      const reason = f.querySelector('input[name=reason]:checked')?.value;
      if (!reason) { $('#rep-err').hidden = false; return; }
      act.report(sheet.data.id, reason, $('#rep-note').value.trim(), !!$('#rep-ev')?.checked); sheet.data.done = true; renderSheet();
    }
    if (f.id === 'ask-form') {
      const { id, pi, snap } = sheet.data, note = $('#ask-note').value.trim(), prompt = q.u(id).prompts[pi].q;
      closeSheet(); const r = cur(); r.p.busy = 'send'; render();
      act.sendRequest(id, note, prompt, !!snap).then(() => { NC.haptic(); burst(); toast(`Request sent to ${q.u(id).name}`); })
        .catch(() => toast('Couldn’t send. Try again.')).finally(() => { r.p.busy = null; if (cur() === r) render(); });
    }
    if (f.id === 'vibe-form') {
      const { id } = sheet.data, note = $('#vibe-note').value.trim() || '👋', c = q.convoWith(id);
      closeSheet();
      if (c) { sendIn(c, { type: 'text', text: note }); burst(); toast(`Sent to ${q.u(id).name}`); }
      else {
        const r = cur(); r.p.busy = 'send';
        act.sendRequest(id, note, 'Tonight').then(() => { NC.haptic(); burst(); toast(`Request sent to ${q.u(id).name}`); })
          .catch((e) => toast(e.message === 'exists' ? 'You already have a request open with them.' : 'Couldn’t send. Try again.')).finally(() => { r.p.busy = null; render(); });
      }
    }
    if (f.id === 'tonight-form') {
      const text = $('#tn-text').value.trim(), area = $('#tn-area').value.trim() || q.meU().city;
      if (!text) { $('#tn-err').hidden = false; return; }
      act.setTonight({ text, area }); closeSheet(); NC.haptic(); render(); toast('You’re on Tonight for 24 hours');
    }
    if (f.id === 'ob-form') {
      const o = cur().p, res = NC.onboard.submit(o, f);
      if (res === 'done') {
        Object.assign(q.meU(), { name: o.name, bio: o.bio || q.meU().bio, city: o.city, age: NC.onboard.ageFrom(o.dob), photos: [...o.photos], tags: [...o.tags] });
        S().nearbyCity[S().me] = o.city; delete S().deleted[S().me];
        stack = [{ s: 'chats', p: {} }]; render(); toast(`Welcome, ${o.name}`); return;
      }
      o.err = res || ''; render(); $('#ob-form input, #ob-form textarea')?.focus();
    }
  });

  /* Interactive edge-swipe back: the screen follows the finger, then commits or springs back. */
  let drag = null;
  screen.addEventListener('pointerdown', (e) => {
    const x = e.clientX - screen.getBoundingClientRect().left;
    drag = x < 24 && stack.length > 1 ? { x0: e.clientX, dx: 0 } : null;
    if (drag) { try { screen.setPointerCapture(e.pointerId); } catch { /* synthetic or ended pointer */ } }
  });
  screen.addEventListener('pointermove', (e) => { if (!drag) return; drag.dx = Math.max(0, e.clientX - drag.x0); screen.style.transform = `translateX(${drag.dx}px)`; });
  const endDrag = () => {
    if (!drag) return; const { dx } = drag; drag = null;
    screen.style.transition = reduced() ? 'none' : 'transform .22s cubic-bezier(.2,.8,.2,1)';
    screen.style.transform = '';
    setTimeout(() => { screen.style.transition = ''; }, 240);
    if (dx > 90) back();
  };
  screen.addEventListener('pointerup', endDrag); screen.addEventListener('pointercancel', endDrag);

  /* ---------- demo panel ---------- */
  function renderDemo() {
    const d = S().demo;
    phone.style.setProperty('--w', d.width + 'px');
    phone.style.setProperty('--h', ({ 375: 812, 430: 932 }[d.width] || 844) + 'px');
    phone.style.setProperty('--ts', d.ts);
    phone.classList.toggle('rm', d.reduce);
    phone.classList.toggle('rt', d.rt);
    phone.classList.toggle('big-text', d.ts >= 1.3);
    document.querySelectorAll('[data-demo]').forEach((el) => {
      const k = el.dataset.demo, v = k === 'persona' ? S().me : k === 'theme' ? NC.theme.get() : d[k];
      if (el.type === 'checkbox') el.checked = !!v; else if (el.type === 'radio') el.checked = String(v) === el.value;
    });
    const inc = q.incoming().length;
    $('#demo-status').textContent = `Signed in as ${q.meU().name} · ${q.myConvos().length} chats · ${inc} incoming request${inc === 1 ? '' : 's'} · ${d.net} network`;
  }
  function demoChange(t) {
    const k = t.dataset.demo, d = S().demo;
    if (k === 'persona') return A.persona(t.value);
    if (k === 'theme') return A.theme(t.value);
    if (k === 'stress') { act.stress(t.checked); return render(); }
    d[k] = t.type === 'checkbox' ? t.checked : isNaN(+t.value) ? t.value : +t.value;
    render();
  }
  $('#demo-actions').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-jump]'); if (!b) return;
    const j = b.dataset.jump;
    closeSheet();
    if (j === 'onboard') A.onboard();
    else if (j === 'reset') A.reset();
    else if (j === 'requests') { tab('chats'); go('requests'); }
    else if (j === 'long') { tab('chats'); const c = q.myConvos().find((x) => x.c.msgs.length > 500); c ? openConvo(c.c.id) : toast('Long thread belongs to Maya'); }
    else if (j === 'convo') { tab('chats'); const c = q.myConvos()[0]; c ? openConvo(c.c.id) : toast('No chats yet for this persona'); }
    else if (j === 'edit') { tab('me'); A.go('edit'); }
    else if (j === 'profile') { tab('nearby'); const n = q.nearby(S().nearbyCity[S().me] || 'Bengaluru')[0]; if (n) A['open-profile'](n[0]); }
    else tab(j);
  });

  tabbar.innerHTML = NC.TabBarHTML();
  render();
}

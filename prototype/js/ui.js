/* Shared helpers and reusable components: Avatar, InboxRow, ProfileCard, RequestRow, MessageBubble, tab bar, EmptyState.
   Semantic colour language: mint = live tonight, rose→coral = incoming spark, orange = snap, violet = voice, gold = plan, cyan = unread. */
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const P = {
    chat: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6a.5.5 0 0 1-.8-.4V16A2.5 2.5 0 0 1 4 13.5z"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    back: '<path d="M15 5 8 12l7 7"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
    send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.2v.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    left: '<path d="M14 6 8 12l6 6"/>', right: '<path d="m10 6 6 6-6 6"/>', chev: '<path d="m10 6 6 6-6 6"/>', down: '<path d="m6 10 6 6 6-6"/>',
    shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.7 7 9.5 4-1.8 7-5.2 7-9.5V6z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    block: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0"/><path d="m3 3 18 18"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/><path d="M3.5 13.5H9l1 2h4l1-2h5.5"/>',
    spark: '<path d="M12 3c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6zM18.5 15c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    quote: '<path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M12 9v11M4 13h16M12 9c-1.5-4-6-4-5-1s5 1 5 1zm0 0c1.5-4 6-4 5-1s-5 1-5 1z"/>',
    camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.1-1.6A1.5 1.5 0 0 1 10 3.8h4a1.5 1.5 0 0 1 1.2.6L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.4"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
    pause: '<path d="M8 5.5v13M16 5.5v13"/>',
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;

  const timeLabel = (t) => {
    const d = Date.now() - t;
    if (d < 60e3) return 'now';
    if (d < 3600e3) return `${Math.floor(d / 60e3)}m`;
    const dt = new Date(t);
    if (dt.toDateString() === new Date().toDateString()) return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d < 7 * 864e5) return dt.toLocaleDateString([], { weekday: 'short' });
    return dt.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayLabel = (t) => {
    const dt = new Date(t).toDateString();
    if (dt === new Date().toDateString()) return 'Today';
    if (dt === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
    return new Date(t).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  };
  const untilLabel = (t) => `until ${new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const shortWhen = (w) => String(w).replace('Saturday', 'Sat').replace('Sunday', 'Sun').replace('Tomorrow', 'Tmrw').replace(/ (am|pm)/, '$1');
  const mmss = (s) => `0:${String(s).padStart(2, '0')}`;

  /* ring: false | true ("live", pulsing mint) | 'rose' (incoming spark, rose→coral) */
  const Avatar = (u, size = 48, ring = false) =>
    `<span class="av-wrap ${ring === true ? 'ring' : ring === 'rose' ? 'ring-rose' : ''}" style="--s:${size}px"><img class="av" src="${NC.img(u.photos[0] || 'p36')}" alt="" width="${size}" height="${size}" decoding="async"></span>`;

  const Badge = (n, label, cls = '') => (n ? `<span class="badge ${cls}" aria-label="${n} ${label}">${n > 99 ? '99+' : n}</span>` : '');
  const Unread = (n) => (n ? `<span class="unread" aria-label="${n} unread">${n > 99 ? '99+' : n}</span>` : '');
  const VibePill = (u) => { const v = NC.vibeOf(u); return `<span class="vibe-pill">${v.e} ${v.l}</span>`; };

  // Deterministic bar heights so a voice note always looks the same.
  const Wave = (n = 22, seed = 3) => `<span class="wave" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i style="--h:${30 + ((i * 37 + seed * 17) % 60)}%;--d:${(i % 7) * 0.08}s"></i>`).join('')}</span>`;

  const preview = (m) => {
    if (m.type === 'card') return `✦ ${m.q}`;
    if (m.type === 'plan') return `Plan: ${m.place[0]} · ${m.when}`;
    if (m.type === 'snap') return m.viewed ? 'Snap (viewed)' : 'Snap';
    if (m.type === 'voice') return `Voice note ${mmss(m.secs)}`;
    if (m.type === 'spark') return '✨ Spark';
    return m.text;
  };

  /* Semantic media pill shown in place of a text preview. */
  const rowPill = (m, mine) => {
    if (m.type === 'snap') return m.viewed ? `<span class="pill pill-muted">Snap · ${mine ? 'Opened' : 'Viewed'}</span>`
      : mine ? '<span class="pill pill-snap-out">Snap · Delivered</span>' : '<span class="pill pill-snap"><i></i>Tap to view snap</span>';
    if (m.type === 'plan') return `<span class="pill pill-plan">📅 ${esc(shortWhen(m.when))} · ${esc(m.place[0])}</span>`;
    if (m.type === 'voice') return `<span class="pill pill-voice">${Wave(7, 1)}${mmss(m.secs)}</span>`;
    if (m.type === 'spark') return '<span class="pill pill-spark">✨ Spark</span>';
    return '';
  };

  const InboxRow = ({ c, other, last, unread, mine }) => {
    const live = NC.store.q.live(other);
    const fromMe = last && last.from === mine;
    const pill = last ? rowPill(last, fromMe) : '';
    let text = last ? esc(preview(last)) : 'Say hello';
    if (fromMe && !pill) text = `You: ${text}`;
    const failed = fromMe && last.status === 'failed';
    return `<div class="row-wrap ${unread ? 'is-unread' : ''}" data-swipe="${c.id}">
      <div class="swipe-under" aria-hidden="true"><span>✨ Spark</span></div>
      <button class="row inbox-row" data-a="open-convo" data-id="${c.id}"
        aria-label="${esc(other.name)}${live ? ', free tonight' : ''}. ${unread ? unread + ' unread. ' : ''}${failed ? 'Message not sent. ' : ''}${last ? esc(preview(last)) : ''}">
        ${Avatar(other, 52, live)}
        <span class="row-main">
          <span class="row-top"><span class="row-name">${esc(other.name)}${other.fixture ? ' <em class="fx">fixture</em>' : ''}</span><span class="row-time">${last ? timeLabel(last.at) : ''}</span></span>
          <span class="row-bot">${pill ? `<span class="row-msg">${pill}</span>` : `<span class="row-msg ${failed ? 'is-failed' : ''}">${failed ? icon('alert') + ' Not sent · ' : ''}${text}</span>`}${Unread(unread)}</span>
        </span></button>
      <button class="spark-btn" data-a="spark" data-id="${c.id}" aria-label="Send ${esc(other.name)} a Spark">✨</button>
    </div>`;
  };

  /* Vibe card: full-bleed photo, Tonight pill, neighbourhood cue and one standout prompt. */
  const ProfileCard = ({ id, u, place, shared, hero, size = 'grid' }) => {
    const live = NC.store.q.live(u);
    const prompt = size === 'grid' ? (u.prompts || [])[0] : null;
    const cue = live ? `${u.tonight.area} · ${place}` : place;
    return `<div class="pcard ${size}">
      <button class="pcard-open" data-a="open-profile" data-id="${id}" aria-label="${esc(u.name)}, ${u.age}. ${esc(cue)}${live ? '. Free tonight: ' + esc(u.tonight.text) : ''}${shared.length ? '. You both like ' + esc(shared.join(', ')) : ''}">
        <img src="${NC.img(u.photos[0])}" alt="" loading="lazy" decoding="async" ${hero ? 'style="view-transition-name:hero"' : ''}>
      </button>
      ${live ? `<span class="live-pill"><i></i>${size === 'drop' ? 'Tonight' : esc(u.tonight.text)}</span>` : ''}
      <div class="pcard-meta">
        <span class="pcard-name">${esc(u.name)}, ${u.age}</span>
        <span class="pcard-place">${icon('pin')}${esc(cue)}</span>
        ${shared.length && size === 'grid' ? `<span class="pcard-shared">${icon('spark')}${esc(shared.slice(0, 2).join(' · '))}</span>` : ''}
        ${prompt ? `<button class="pcard-prompt" data-a="ask" data-id="${id}|0" aria-label="Reply to ${esc(prompt.q)}: ${esc(prompt.a)}"><span>“${esc(prompt.a)}”</span><b>Reply</b></button>` : ''}
      </div>
    </div>`;
  };

  const RequestRow = ({ r, other, incoming, busy }) =>
    `<article class="req ${incoming ? 'incoming' : ''}" aria-label="Request ${incoming ? 'from' : 'to'} ${esc(other.name)}">
      <button class="req-who" data-a="open-profile" data-id="${incoming ? r.from : r.to}">
        ${Avatar(other, 56, incoming ? 'rose' : NC.store.q.live(other))}
        <span><span class="row-name">${esc(other.name)}, ${other.age}</span><span class="req-sub">${esc(other.city)} · ${timeLabel(r.at)}</span></span>
      </button>
      ${r.note ? `<div class="req-note">${r.prompt ? `<span class="req-q">${icon('quote')} ${incoming ? 'Replied to your' : 'You replied to'} “${esc(r.prompt)}”</span>` : ''}<p>${esc(r.note)}</p>${r.snap ? '<span class="pill pill-snap-out">📷 Snap attached</span>' : ''}</div>` : `<p class="req-bio">${esc(other.bio)}</p>`}
      <div class="req-actions">${incoming
        ? `<button class="btn btn-ghost" data-a="decline" data-id="${r.id}" ${busy ? 'disabled' : ''}>Decline</button><button class="btn btn-spark" data-a="accept" data-id="${r.id}" ${busy ? 'disabled' : ''}>${busy === 'accept' ? '<span class="spin"></span> Accepting' : 'Accept'}</button>`
        : `<button class="btn btn-ghost" data-a="cancel-req" data-id="${r.id}" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin"></span> Cancelling' : 'Cancel request'}</button>`}</div>
    </article>`;

  const status = (m) => ({ sending: `${icon('clock')} Sending`, sent: `${icon('check')} Sent`, failed: '' }[m.status]);

  const CardMsg = (m, mine) => {
    const opts = m.opts.length
      ? `<div class="ib-opts">${m.opts.map((o) => `<button class="ib-opt ${m.answer === o ? 'on' : ''}" ${mine || m.answer ? 'disabled' : `data-a="ib-answer" data-id="${m.cid}|${esc(o)}"`}>${esc(o)}</button>`).join('')}</div>`
      : (mine ? '' : `<button class="ib-opt" data-a="ib-free" data-id="${m.cid}">Answer</button>`);
    return `<div class="ib-card"><span class="ib-kind">${icon('spark')} ${esc(m.kind)}</span><p>${esc(m.q)}</p>${opts}${m.answer ? `<span class="ib-ans">${mine ? 'They picked' : 'You picked'} ${esc(m.answer)}</span>` : ''}</div>`;
  };

  /* Date plan: champagne-gold glass. The recipient answers with one tap. */
  const PlanMsg = (m, mine) => {
    const confirmed = m.status === 'confirmed', maybe = m.status === 'maybe';
    const said = maybe ? (m.statusBy === NC.store.S.me ? 'You said maybe' : 'They said maybe') : '';
    let foot;
    if (confirmed) foot = `<div class="plan-pills"><button class="pp pp-share" data-a="plan-share" data-id="${m.cid}">${icon('shield')} Share with someone you trust</button></div><span class="fine-in">Check-in reminder 2 hours after. Meet in public, tell a friend.</span>`;
    else if (!mine) foot = `${said ? `<span class="fine-in">${said}</span>` : ''}<div class="plan-pills" role="group" aria-label="Respond to plan">
        <button class="pp pp-in" data-a="plan-ok" data-id="${m.cid}">I’m in ✨</button><button class="pp ${maybe ? 'on' : ''}" data-a="plan-maybe" data-id="${m.cid}">Maybe</button><button class="pp" data-a="plan-new">Suggest time</button></div>`;
    else foot = `<span class="fine-in">${maybe ? 'They said maybe — suggest another time?' : 'Waiting for them to respond'}</span>${maybe ? '<div class="plan-pills"><button class="pp" data-a="plan-new">Suggest time</button></div>' : ''}`;
    return `<div class="plan-card ${confirmed ? 'ok' : ''}"><span class="plan-kind">${icon('cal')} ${confirmed ? 'Plan confirmed' : 'Date plan'}</span>
      <b>${esc(m.place[0])}</b><span class="plan-where">${esc(m.place[1])}</span><span class="plan-when">${esc(m.when)}</span>${foot}</div>`;
  };

  /* Ephemeral snap: blurred until pressed and held, then marks itself viewed. */
  const SnapMsg = (m, mine) => {
    if (m.viewed) return `<div class="snap viewed" role="img" aria-label="Snap ${mine ? 'opened' : 'viewed'}"><span class="snap-ic">📷</span><span><b>${mine ? 'Snap opened' : 'Viewed'}</b><em>Snaps disappear after viewing</em></span></div>`;
    const img = NC.img(m.photo || 'l22');
    if (mine) return `<div class="snap sent" role="img" aria-label="Snap delivered"><img class="snap-img" src="${img}" alt=""><span class="snap-pill out"><i></i>Delivered · ${m.secs}s to view</span></div>`;
    return `<div class="snap" role="button" tabindex="0" data-snap="${m.cid}" aria-label="Snap. Press and hold to view for ${m.secs} seconds. Release to close.">
      <img class="snap-img" src="${img}" alt="" draggable="false"><span class="snap-pill"><i></i><b data-snap-label>Hold to view · ${m.secs}s</b></span><span class="snap-bar"><i></i></span></div>`;
  };

  const VoiceMsg = (m, mine) =>
    `<div class="voice ${mine ? 'mine' : ''}" data-voice="${m.cid}"><button class="voice-play" data-a="voice-play" data-id="${m.cid}" aria-label="Play voice note, ${mmss(m.secs)}">${icon('play')}</button>${Wave(26, m.secs)}<span class="voice-t">${mmss(m.secs)}</span></div>`;

  const MessageBubble = ({ m, mine, showMeta, showStatus }) => {
    const st = mine && (showStatus || m.status !== 'sent') ? status(m) : '';
    const metaLine = showMeta || m.status !== 'sent' ? `<span class="meta">${clock(m.at)}${st ? ' · ' + st : ''}</span>` : '';
    const side = mine ? 'mine' : 'theirs';
    if (mine && m.status === 'failed') {
      return `<div class="msg mine"><button class="bubble failed" data-a="retry" data-id="${m.cid}" aria-label="Message not sent: ${esc(preview(m))}. Tap to retry">${esc(preview(m))}</button>
        <span class="meta is-failed">${icon('alert')} Not sent · Tap to retry</span></div>`;
    }
    if (m.type === 'card') return `<div class="msg ${side} wide">${CardMsg(m, mine)}${metaLine}</div>`;
    if (m.type === 'plan') return `<div class="msg ${side} wide">${PlanMsg(m, mine)}${metaLine}</div>`;
    if (m.type === 'snap') return `<div class="msg ${side} wide">${SnapMsg(m, mine)}${metaLine}</div>`;
    if (m.type === 'voice') return `<div class="msg ${side} wide">${VoiceMsg(m, mine)}${metaLine}</div>`;
    if (m.type === 'spark') return `<div class="msg ${side}"><div class="bubble spark-b ${m.status === 'sending' ? 'sending' : ''}">✨ Spark</div>${metaLine}</div>`;
    return `<div class="msg ${side}">${m.quote ? `<span class="quote">${icon('quote')} ${esc(m.quote)}</span>` : ''}<div class="bubble ${m.status === 'sending' ? 'sending' : ''}">${esc(m.text)}</div>${metaLine}</div>`;
  };

  /* The nav is one persistent element (see app.js) so its active pill can slide between tabs. */
  const TAB_DEFS = [['chats', 'Chats', 'chat'], ['nearby', 'Nearby', 'pin'], ['me', 'Profile', 'user']];
  const TabBarHTML = () => `<span class="tab-ind" aria-hidden="true"></span>${TAB_DEFS.map(([k, l, ic]) =>
    `<button class="tab" data-a="tab" data-id="${k}"><span class="tab-ic">${icon(ic)}<span class="badge unread-b" data-badge="${k}" hidden></span></span><span class="tab-l">${l}</span></button>`).join('')}`;

  const EmptyState = ({ ic, title, body, action, actionLabel }) =>
    `<div class="empty"><div class="empty-art">${icon(ic)}</div><h2>${title}</h2><p>${body}</p>
      ${action ? `<button class="btn btn-primary" data-a="${action}">${actionLabel}</button>` : ''}</div>`;

  const Toggle = (key, on, label, sub) =>
    `<label class="set-row"><span class="set-l">${label}${sub ? `<span class="set-sub">${sub}</span>` : ''}</span>
      <input type="checkbox" role="switch" class="sw" data-tg="${key}" ${on ? 'checked' : ''}></label>`;

  const haptic = () => { try { navigator.vibrate?.(8); } catch { /* not supported */ } };

  Object.assign(NC, { esc, icon, timeLabel, clock, dayLabel, untilLabel, shortWhen, mmss, Avatar, Badge, Unread, VibePill, Wave, InboxRow, ProfileCard, RequestRow, MessageBubble, TabBarHTML, EmptyState, Toggle, haptic, preview });
})();

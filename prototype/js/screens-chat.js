/* Chats, Requests and Conversation screens. Each returns { html, tabs, tone }. */
(() => {
  const { esc, icon, Avatar, Badge, VibePill, InboxRow, RequestRow, MessageBubble, EmptyState, dayLabel } = NC;
  const st = () => NC.store.S;
  const q = () => NC.store.q;
  const PAGE = 30;

  const header = (title, { back = true, right = '' } = {}) =>
    `<header class="nav">${back ? `<button class="icbtn" data-a="back" aria-label="Back">${icon('back')}</button>` : '<span class="icbtn-sp"></span>'}
      <div class="nav-t"><h1>${title}</h1></div>${right || '<span class="icbtn-sp"></span>'}</header>`;
  const netBar = () => st().demo.net === 'offline'
    ? `<div class="banner warn" role="status">${icon('wifi')} You're offline. We'll catch up when you reconnect.</div>`
    : st().demo.net === 'slow' ? `<div class="banner soft" role="status">${icon('clock')} Slow connection — actions may take a few seconds.</div>` : '';

  // People who are free tonight: existing chats first, then anyone nearby.
  function stripPeople() {
    const me = st().me, city = st().nearbyCity[me] || q().meU().city, seen = new Set(), out = [];
    const add = (id, u) => { if (id === me || seen.has(id) || !q().live(u) || q().blockedEither(me, id)) return; seen.add(id); out.push([id, u]); };
    q().myConvos().forEach((x) => add(x.id, x.other));
    q().nearby(city).forEach(([id, u]) => add(id, u));
    return out.slice(0, 8);
  }

  function chats(r) {
    const term = (r.p.term || '').trim().toLowerCase();
    const all = q().myConvos();
    const list = term ? all.filter((x) => x.other.name.toLowerCase().includes(term) || x.c.msgs.some((m) => NC.preview(m).toLowerCase().includes(term))) : all;
    const inc = q().incoming();
    const people = stripPeople();
    const strip = people.length ? `<section class="strip" aria-label="Free tonight and nearby">
        <div class="strip-h"><h2>Free tonight</h2><span>${people.length} nearby</span></div>
        <div class="strip-row">${people.map(([id, u]) => `<button class="strip-item" data-a="vibe" data-id="${id}" aria-label="${esc(u.name)}, free tonight: ${esc(u.tonight.text)}. Send a quick vibe">
          <span class="strip-av">${Avatar(u, 58, true)}${VibePill(u)}</span><span class="strip-name">${esc(u.name)}</span></button>`).join('')}</div></section>` : '';
    const reqRow = `<button class="req-entry ${inc.length ? 'spark-card' : 'calm'}" data-a="go" data-id="requests">
      <span class="stack">${inc.slice(0, 3).map((x) => Avatar(q().u(x.from), 34, inc.length ? 'rose' : false)).join('') || `<span class="stack-ic">${icon('inbox')}</span>`}</span>
      <span class="row-main"><span class="row-name">Chat requests</span><span class="req-sub">${inc.length ? `${inc.length} waiting for your reply` : 'Nothing new · see sent'}</span></span>
      ${Badge(inc.length, 'new requests', 'badge-rose')}${icon('chev', 'muted')}<span class="shimmer" aria-hidden="true"></span></button>`;
    const body = !all.length
      ? EmptyState({ ic: 'chat', title: 'No conversations yet', body: 'Send a request to someone nearby. When they accept, your chat lands here.', action: 'find-nearby', actionLabel: 'Find people nearby' })
      : list.length ? `<div class="list">${list.map(InboxRow).join('')}</div>` : `<p class="none">No chats match “${esc(r.p.term)}”.</p>`;
    return {
      tone: 'bg', tabs: true,
      html: `<div class="scroll" id="sc">${netBar()}<div class="big-h"><h1>Chats</h1></div>
        <div class="search">${icon('search')}<input id="search" type="search" placeholder="Search people and messages" aria-label="Search chats" value="${esc(r.p.term || '')}" autocomplete="off"></div>
        ${strip}${reqRow}<div id="chat-list">${body}</div></div>`,
    };
  }

  function requests(r) {
    const tab = r.p.tab || 'in';
    const inc = q().incoming(), sent = q().sent();
    const items = tab === 'in' ? inc : sent;
    return {
      tone: 'bg', tabs: false,
      html: `${header('Chat requests')}<div class="seg" role="tablist">
        <button role="tab" aria-selected="${tab === 'in'}" data-a="req-tab" data-id="in">Incoming ${inc.length ? `<b>${inc.length}</b>` : ''}</button>
        <button role="tab" aria-selected="${tab === 'sent'}" data-a="req-tab" data-id="sent">Sent ${sent.length ? `<b>${sent.length}</b>` : ''}</button></div>
        <div class="scroll pad">${netBar()}${items.length ? items.map((x) => RequestRow({ r: x, other: q().u(tab === 'in' ? x.from : x.to), incoming: tab === 'in', busy: r.p.busy?.[x.id] })).join('')
          : EmptyState(tab === 'in'
            ? { ic: 'inbox', title: 'No requests right now', body: 'When someone nearby wants to chat, you review it here first. Nothing opens without your yes.', action: 'find-nearby', actionLabel: 'Browse Nearby' }
            : { ic: 'send', title: 'Nothing sent yet', body: 'Reply to someone’s prompt on Nearby — requests with a reason get answered more.', action: 'find-nearby', actionLabel: 'Browse Nearby' })}</div>`,
    };
  }

  const sparkMeter = (n) => `<span class="spark" role="img" aria-label="Spark ${n} of 5${n >= 4 ? ', you are both replying a lot' : ''}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

  function convo(r) {
    const c = q().convo(r.p.id);
    if (!c) return { tone: 'surface', tabs: false, html: header('Chat') + EmptyState({ ic: 'chat', title: 'Chat not found', body: 'This conversation no longer exists.' }) };
    const me = st().me, oid = q().other(c, me), o = q().u(oid);
    const blocked = q().blockedEither(me, oid);
    const limit = r.p.limit || PAGE, start = Math.max(0, c.msgs.length - limit);
    const lastMine = c.msgs.map((m) => m.from).lastIndexOf(me);
    let lastDay = '', out = start > 0 ? `<button class="older" data-a="older">${icon('clock')} Earlier messages (${start})</button>` : '';
    for (let i = start; i < c.msgs.length; i++) {
      const m = c.msgs[i], d = dayLabel(m.at);
      if (d !== lastDay) { out += `<div class="day">${d}</div>`; lastDay = d; }
      if (r.p.divider != null && i === r.p.divider && m.from !== me) out += '<div class="unread-div" role="separator"><span>New messages</span></div>';
      const nx = c.msgs[i + 1];
      const showMeta = !nx || nx.from !== m.from || nx.at - m.at > 600e3;
      out += MessageBubble({ m, mine: m.from === me, showMeta, showStatus: i === lastMine });
    }
    if (r.p.typing) out += '<div class="msg theirs"><div class="bubble typing" aria-label="Typing"><i></i><i></i><i></i></div></div>';
    if (!c.msgs.length) out = `<div class="first-hello">${Avatar(o, 72)}<p>You and ${esc(o.name)} are connected.<br>Break the ice — tap ${icon('spark')} for a starter.</p></div>`;
    const spark = q().sparkLevel(c);
    const foot = blocked
      ? `<div class="unavail" role="status">${icon('block')}<div><b>This conversation is unavailable</b><span>${q().iBlocked(oid) ? `You blocked ${esc(o.name)}. They can't message you or see your photos.` : 'This person is no longer available.'}</span></div>
          ${q().iBlocked(oid) ? `<button class="btn btn-ghost sm" data-a="unblock" data-id="${oid}">Unblock</button>` : ''}</div>`
      : `${r.p.present ? `<span class="peek" role="status">${Avatar(o, 24, true)}<span>${esc(o.name)} is here</span></span>` : ''}
        <form class="composer glass-pill" id="composer">
          <button type="button" class="cbtn" data-a="snap" aria-label="Send a snap">${icon('camera')}</button>
          <button type="button" class="cbtn" data-a="icebreak" aria-label="Icebreakers">${icon('spark')}</button>
          <button type="button" class="cbtn" data-a="plan" aria-label="Suggest a plan">${icon('cal')}</button>
          <label class="sr" for="msg">Message ${esc(o.name)}</label>
          <textarea id="msg" rows="1" maxlength="1000" placeholder="Message" enterkeyhint="send">${esc(r.p.draft || '')}</textarea>
          <button class="send" type="submit" aria-label="Send" ${(r.p.draft || '').trim() ? '' : 'disabled'}>${icon('send')}</button></form>`;
    return {
      tone: 'surface', tabs: false,
      html: `<header class="nav chat-nav glass-bar"><button class="icbtn" data-a="back" aria-label="Back to chats">${icon('back')}</button>
        <button class="chat-who" data-a="open-profile" data-id="${oid}">${Avatar(o, 38, q().live(o))}<span><b>${esc(o.name)}</b><span>${blocked ? 'Unavailable' : q().live(o) ? `Tonight · ${esc(o.tonight.text)}` : esc(q().place(oid))}</span></span></button>
        ${blocked ? '' : sparkMeter(spark)}<button class="icbtn" data-a="convo-menu" aria-label="More options">${icon('more')}</button></header>
        ${netBar()}<div class="scroll thread" id="thread" aria-live="polite">${out}</div>
        ${r.p.pill ? `<button class="new-pill" data-a="to-bottom">${icon('down')} New messages</button>` : ''}<div class="composer-wrap">${foot}</div>`,
    };
  }

  NC.screens = Object.assign(NC.screens || {}, { chats, requests, convo });
  NC.header = header; NC.netBar = netBar; NC.PAGE = PAGE;
})();

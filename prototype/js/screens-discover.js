/* Nearby and Profile detail screens. */
(() => {
  const { esc, icon, ProfileCard, EmptyState, untilLabel } = NC;
  const st = () => NC.store.S;
  const q = () => NC.store.q;

  const nextDrop = () => {
    const n = new Date(), t = new Date(); t.setHours(19, 0, 0, 0);
    if (t <= n) t.setDate(t.getDate() + 1);
    const h = Math.floor((t - n) / 3600e3), m = Math.floor(((t - n) % 3600e3) / 60e3);
    return h ? `${h}h ${m}m` : `${m}m`;
  };

  function nearby(r) {
    const me = st().me, city = st().nearbyCity[me] || q().meU().city;
    const set = q().set(), perm = st().demo.perm;
    const all = q().nearby(city), liveN = all.filter(([, u]) => q().live(u)).length;
    const list = r.p.tonight ? all.filter(([, u]) => q().live(u)) : all;
    const card = ([id, u], size) => ProfileCard({ id, u, place: q().place(id), shared: q().shared(u), hero: r.p.heroId === id && size === 'grid', size });
    let body;
    if (r.p.loading) body = `<div class="grid" aria-busy="true" aria-label="Loading people">${'<div class="pcard sk"></div>'.repeat(6)}</div>`;
    else if (!all.length) body = EmptyState({ ic: 'pin', title: `No one in ${esc(city)} yet`, body: 'Nearby Chat is new here. Try another city, or check back soon.', action: 'pick-city', actionLabel: 'Choose another city' });
    else {
      const drop = q().drop(city);
      body = `${!r.p.tonight && drop.length >= 2 ? `<section class="drop" aria-labelledby="drop-h">
          <div class="drop-h"><h2 id="drop-h">${icon('gift')} The Drop</h2><span>${drop.length} picked for your vibe · next in ${nextDrop()}</span></div>
          <div class="rail">${drop.map((x) => card(x, 'drop')).join('')}</div></section>` : ''}
        <h2 class="sec-h">${r.p.tonight ? `Free tonight in ${esc(city)}` : `Everyone in ${esc(city)}`}</h2>
        ${list.length ? `<div class="grid">${list.map((x) => card(x, 'grid')).join('')}</div>` : '<p class="none">No one has posted a Tonight status yet. Post yours from Profile.</p>'}`;
    }
    const loc = set.approx && perm === 'granted'
      ? `<button class="chip on" data-a="loc-off" aria-pressed="true">${icon('pin')} Distance on</button>`
      : `<button class="chip" data-a="use-loc" aria-pressed="false">${icon('pin')} Use approximate location</button>`;
    const denied = r.p.denied ? `<div class="card denied" role="alert"><b>Location is off for Nearby Chat</b><p>You can still browse by city. To see distance bands, allow location in iPhone Settings.</p>
      <div class="row-btns"><button class="btn btn-primary sm" data-a="pick-city">Choose city manually</button><button class="btn btn-ghost sm" data-a="open-settings">Open Settings</button></div></div>` : '';
    return {
      tone: 'bg', tabs: true,
      html: `<div class="scroll" id="sc">${NC.netBar()}<div class="big-h row-h"><h1>Nearby</h1>
        <button class="city" data-a="pick-city" aria-label="Current city ${esc(city)}. Change city">${esc(city)} ${icon('down')}</button></div>
        <div class="chips"><button class="chip ${r.p.tonight ? 'on' : ''}" data-a="tonight-filter" aria-pressed="${!!r.p.tonight}">${icon('moon')} Free tonight <b>${liveN}</b></button>${loc}</div>
        ${!q().meU().discoverable ? `<div class="banner soft">${icon('eye')} You're hidden from Nearby. <button class="link" data-a="resume-disc">Show me again</button></div>` : ''}
        ${denied}${body}<p class="fine">Distances are broad bands, shown only when both people opt in. Exact locations are never shared.</p></div>`,
    };
  }

  function cta(id, u, r) {
    const pend = q().pendingWith(id), c = q().convoWith(id), busy = r.p.busy;
    if (id === st().me) return `<button class="btn btn-primary wide" data-a="go" data-id="edit">Edit profile</button>`;
    if (q().iBlocked(id)) return `<button class="btn btn-ghost wide" data-a="unblock" data-id="${id}">${icon('block')} Unblock ${esc(u.name)}</button>`;
    if (c) return `<button class="btn btn-primary wide" data-a="open-convo" data-id="${c.id}">${icon('chat')} Open chat</button>`;
    if (busy === 'send') return `<button class="btn btn-primary wide" disabled aria-live="polite"><span class="spin"></span> Sending</button>`;
    if (pend && pend.from === st().me) return `<button class="btn btn-sent wide" disabled>${icon('check')} Request sent</button><button class="link sm-link" data-a="cancel-req" data-id="${pend.id}">Cancel</button>`;
    if (pend) return `<button class="btn btn-primary wide" data-a="review" data-id="${pend.id}">Review request</button>`;
    return `<button class="btn btn-primary wide" data-a="send-req" data-id="${id}">${icon('send')} Send request</button>`;
  }

  function profile(r) {
    const id = r.p.id, u = q().u(id), isMe = id === st().me;
    const canAsk = !isMe && !q().pendingWith(id) && !q().convoWith(id) && !q().iBlocked(id);
    const shared = isMe ? [] : q().shared(u), n = u.photos.length;
    const live = q().live(u);
    return {
      tone: 'bg', tabs: false,
      html: `<div class="scroll prof" id="sc"><div class="gal-wrap ${isMe ? '' : 'reveal'}">
        <div class="gallery" id="gal" tabindex="0" aria-label="Photos of ${esc(u.name)}, ${n} photos. Use arrow keys">${u.photos.map((p, i) => `<img src="${NC.img(p)}" alt="${esc(u.name)}, photo ${i + 1} of ${n}" ${i === 0 ? 'style="view-transition-name:hero"' : 'loading="lazy"'} decoding="async">`).join('')}</div>
        ${isMe ? '' : '<span class="reveal-chip" aria-hidden="true">✨ Unlocking</span>'}
        <div class="dots" aria-hidden="true">${u.photos.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>
        <button class="icbtn glass gl" data-a="back" aria-label="Back">${icon('back')}</button>
        ${isMe ? '' : `<button class="icbtn glass gr" data-a="profile-menu" data-id="${id}" aria-label="More options for ${esc(u.name)}">${icon('more')}</button>`}
        ${n > 1 ? `<button class="gal-nav prev" data-a="gal" data-id="-1" aria-label="Previous photo">${icon('left')}</button><button class="gal-nav next" data-a="gal" data-id="1" aria-label="Next photo">${icon('right')}</button>` : ''}
      </div>
      <section class="pinfo"><h1>${esc(u.name)}, ${u.age}</h1><p class="place">${icon('pin')} ${esc(isMe ? u.city : q().place(id))}</p>
        ${live ? `<div class="tonight-card">${icon('moon')}<div><b>${esc(u.tonight.text)}</b><span>${esc(u.tonight.area)} · ${untilLabel(u.tonight.until)}</span></div></div>` : ''}
        <p class="bio">${esc(u.bio)}</p>
        ${u.tags?.length ? `<div class="tags">${u.tags.map((t) => `<span class="tag ${shared.includes(t) ? 'on' : ''}">${shared.includes(t) ? icon('spark') : ''}${esc(t)}</span>`).join('')}</div>
          ${shared.length ? `<p class="fine-in">You both like ${esc(shared.join(', '))}</p>` : ''}` : ''}
        ${(u.prompts || []).map((p, i) => `<article class="prompt"><span>${esc(p.q)}</span><p>${esc(p.a)}</p>
          ${canAsk ? `<button class="reply" data-a="ask" data-id="${id}|${i}" aria-label="Reply to ${esc(p.q)}">${icon('chat')} Reply</button>` : ''}</article>`).join('')}
        ${canAsk ? '<p class="fine-in center">Replying to a prompt sends your request with a reason. They see your profile first.</p>' : ''}
      </section></div>
      <div class="action-bar glass-bar">${cta(id, u, r)}</div>`,
    };
  }

  NC.screens = Object.assign(NC.screens || {}, { nearby, profile });
})();

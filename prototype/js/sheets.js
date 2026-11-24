/* Bottom sheets and alerts. NC.sheet(kind, data, ctx) returns { html, alert }. */
(() => {
  const { esc, icon, Avatar } = NC;
  const st = () => NC.store.S;
  const q = () => NC.store.q;

  const S = {
    city: ({ current }) => `<h2 class="sh-t">Choose city</h2><div class="group radios">${NC.CITIES.map((c) =>
      `<button class="set-row" data-a="set-city" data-id="${c}" aria-pressed="${c === current}"><span class="set-l">${c}</span>${c === current ? icon('check', 'accent') : ''}</button>`).join('')}</div>`,

    photos: () => `<h2 class="sh-t">Photo library</h2><p class="sh-p">Pick a photo. Demo library — the app uses the iOS photo picker.</p><div class="lib">${[{ maya: 'p36', kabir: 'p59' }[st().me], ...NC.GALLERY].filter(Boolean).map((p) =>
      `<button data-a="pick-photo" data-id="${p}" aria-label="Add photo ${p}"><img src="${NC.img(p)}" alt=""></button>`).join('')}</div>`,

    menu: ({ id, convo }) => {
      const u = q().u(id);
      const items = convo
        ? [['view-profile', 'eye', 'View profile'], ['sim-fail', 'alert', st().demo.failNext ? 'Failed send armed ✓' : 'Simulate failed send'], ['sim-in', 'chat', 'Simulate incoming message'], ['sim-snap', 'camera', 'Simulate incoming snap'], ['report', 'flag', 'Report'], ['block', 'block', `Block ${u.name}`]]
        : [['report', 'flag', 'Report'], ['block', 'block', `Block ${u.name}`]];
      return `<div class="acts">${items.map(([a, ic, l]) => `<button class="act ${a === 'block' || a === 'report' ? 'danger' : ''}" data-a="${a}" data-id="${id}">${icon(ic)} ${esc(l)}</button>`).join('')}</div>
        <button class="act cancel" data-a="close-sheet">Cancel</button>`;
    },

    block: ({ id }) => {
      const u = q().u(id);
      return `<div class="sh-ic danger">${icon('block')}</div><h2 class="sh-t c">Block ${esc(u.name)}?</h2>
        <ul class="ticks"><li>They can't message you or send requests.</li><li>Your profile and photos are hidden from them.</li><li>Your chat closes for both of you. They aren't notified.</li></ul>
        <button class="btn btn-danger wide" data-a="confirm-block" data-id="${id}" data-focus>Block</button><button class="btn btn-ghost wide" data-a="close-sheet">Cancel</button>`;
    },

    report: ({ id, done }) => {
      const u = q().u(id);
      if (done) return `<div class="sh-ic">${icon('check')}</div><h2 class="sh-t c">Thanks for telling us</h2><p class="sh-p c">Our safety team reviews reports within 24 hours. ${esc(u.name)} won't know it was you.</p>
        ${q().iBlocked(id) ? '' : `<button class="btn btn-danger wide" data-a="block" data-id="${id}">Also block ${esc(u.name)}</button>`}<button class="btn btn-ghost wide" data-a="close-sheet">Done</button>`;
      const reasons = ['Spam or scam', 'Inappropriate photos', 'Harassment or hate', 'Fake profile', 'Seems under 18', 'Something else'];
      return `<h2 class="sh-t">Report ${esc(u.name)}</h2><p class="sh-p">What's going on?</p><form id="report-form"><div class="group radios">${reasons.map((x, i) =>
        `<label class="set-row"><span class="set-l">${x}</span><input type="radio" name="reason" value="${x}" ${i === 0 ? 'data-focus' : ''}></label>`).join('')}</div>
        <label class="fld"><span>Details (optional)</span><textarea id="rep-note" rows="2" maxlength="500"></textarea></label>
        ${q().convoWith(id) ? '<label class="chk-in"><input type="checkbox" id="rep-ev" checked> Include our last 20 messages for the review team</label>' : ''}
        <p class="err" id="rep-err" hidden>Choose a reason.</p><button class="btn btn-primary wide" type="submit">Send report</button></form>`;
    },

    review: ({ rid }) => {
      const r = st().requests.find((x) => x.id === rid), o = q().u(r.from);
      return `<div class="rv">${Avatar(o, 64)}<h2 class="sh-t c">${esc(o.name)} wants to chat</h2>
        ${r.note ? `<div class="req-note">${r.prompt ? `<span class="req-q">${icon('quote')} Replied to your “${esc(r.prompt)}”</span>` : ''}<p>${esc(r.note)}</p></div>` : ''}
        <p class="sh-p c">Accepting opens a private chat. Declining is silent.</p></div>
        <button class="btn btn-primary wide" data-a="accept" data-id="${r.id}" data-focus>Accept</button><button class="btn btn-ghost wide" data-a="decline" data-id="${r.id}">Decline</button>`;
    },

    ask: ({ id, pi, snap }) => {
      const u = q().u(id), p = u.prompts[pi];
      return `<div class="ask-head">${Avatar(u, 44)}<div><b>Reply to ${esc(u.name)}</b><span>Sends a chat request with your note</span></div></div>
        <div class="prompt quoted"><span>${esc(p.q)}</span><p>${esc(p.a)}</p></div>
        <form id="ask-form"><div class="react-row" role="group" aria-label="Quick reactions">${NC.REACTIONS.map((e) => `<button type="button" class="react" data-a="react" data-id="${e}" aria-label="Add ${e}">${e}</button>`).join('')}</div>
        <label class="sr" for="ask-note">Your note</label><textarea id="ask-note" rows="2" maxlength="200" placeholder="Say something specific to their answer…" data-focus></textarea>
        <div class="sugs">${[`Okay, I need to know more about this`, `Same! What’s your take on ${(q().shared(u)[0] || 'coffee').toLowerCase()}?`].map((x) => `<button type="button" class="tag" data-a="ask-sug" data-id="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div class="ask-row"><button type="button" class="chip-snap ${snap ? 'on' : ''}" data-a="ask-snap" aria-pressed="${!!snap}">${icon('camera')} ${snap ? 'Snap attached' : 'Add a snap'}</button>
        <button class="btn btn-spark grow" type="submit">${icon('send')} Send request</button></div></form>`;
    },

    // Quick reply to someone who is free tonight (from the Chats strip).
    vibe: ({ id }) => {
      const u = q().u(id), c = q().convoWith(id);
      return `<div class="ask-head">${Avatar(u, 48, true)}<div><b>${esc(u.name)}</b><span>${NC.vibeOf(u).e} ${esc(u.tonight.text)} · ${esc(u.tonight.area)}</span></div></div>
        <form id="vibe-form"><p class="sh-p">${c ? 'Send a quick vibe in your chat.' : 'Say hi. They see your profile first and choose whether to chat.'}</p>
        <div class="react-row" role="group" aria-label="Quick reactions">${NC.REACTIONS.map((e) => `<button type="button" class="react" data-a="vibe-react" data-id="${e}" aria-label="Send ${e}">${e}</button>`).join('')}</div>
        <label class="sr" for="vibe-note">Your message</label><textarea id="vibe-note" rows="2" maxlength="200" placeholder="I’m around too — ${esc(u.tonight.text.toLowerCase())}?" data-focus></textarea>
        <button class="btn btn-spark wide" type="submit">${icon('send')} ${c ? 'Send vibe' : 'Send request'}</button></form>`;
    },

    snap: ({ chosen }) => `<h2 class="sh-t">${icon('camera')} Send a snap</h2><p class="sh-p">It disappears after they view it once. They hold to see it for ${NC.SNAP_SECS} seconds.</p>
      <div class="lib snap-lib">${NC.GALLERY.slice(0, 9).map((p) => `<button data-a="snap-pick" data-id="${p}" aria-pressed="${chosen === p}" aria-label="Choose photo ${p}"><img src="${NC.img(p)}" alt=""></button>`).join('')}</div>
      <button class="btn btn-snap wide" data-a="snap-send" ${chosen ? '' : 'disabled'}>Send snap</button>`,

    icebreak: () => `<h2 class="sh-t">${icon('spark')} Icebreakers</h2><p class="sh-p">Swipe through, tap to send. They answer with one tap.</p>
      <div class="deck" id="deck" tabindex="0" aria-label="Icebreaker cards">${NC.ICEBREAKERS.map((c, i) => `<article class="deck-card" aria-label="Card ${i + 1} of ${NC.ICEBREAKERS.length}">
        <span class="ib-kind">${icon('spark')} ${esc(c.kind)}</span><h3>${esc(c.q)}</h3>
        ${c.opts.length ? `<div class="deck-opts">${c.opts.map((o) => `<span>${esc(o)}</span>`).join('')}</div>` : '<span class="deck-hint">They type their answer</span>'}
        <button class="btn btn-primary sm" data-a="ib-send" data-id="${i}">Send this</button></article>`).join('')}</div>
      <div class="deck-dots" aria-hidden="true">${NC.ICEBREAKERS.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>`,

    plan: ({ place = 0, when = 0 }) => `<h2 class="sh-t">${icon('cal')} Suggest a plan</h2><p class="sh-p">Public places only. Both of you confirm before it’s set.</p>
      <h3 class="grp">Where</h3><div class="group radios">${NC.PLACES.map((p, i) => `<button class="set-row" data-a="plan-place" data-id="${i}" aria-pressed="${i === place}"><span class="set-l">${esc(p[0])}<span class="set-sub">${esc(p[1])}</span></span>${i === place ? icon('check', 'accent') : ''}</button>`).join('')}</div>
      <h3 class="grp">When</h3><div class="tags">${NC.WHEN.map((w, i) => `<button class="tag ${i === when ? 'on' : ''}" aria-pressed="${i === when}" data-a="plan-when" data-id="${i}">${esc(w)}</button>`).join('')}</div>
      <button class="btn btn-primary wide" data-a="plan-send">Send plan</button>`,

    tonight: () => {
      const t = q().meU().tonight;
      return `<h2 class="sh-t">${icon('moon')} Tonight</h2><p class="sh-p">Tell people nearby you’re free. Shows on your card and disappears in 24 hours.</p>
        <form id="tonight-form"><label class="fld"><span>What are you up for?</span><input id="tn-text" maxlength="40" placeholder="Free for a walk and chai" value="${esc(t?.text || '')}" data-focus></label>
        <label class="fld"><span>Rough area</span><input id="tn-area" maxlength="30" placeholder="Indiranagar" value="${esc(t?.area || '')}"></label>
        <div class="sugs">${['Free for filter coffee', 'Looking for a gig buddy', 'Walk after work?'].map((s) => `<button type="button" class="tag" data-a="tn-sug" data-id="${s}">${s}</button>`).join('')}</div>
        <p class="err" id="tn-err" hidden>Add a short status.</p>
        <button class="btn btn-primary wide" type="submit">Post for 24 hours</button>
        ${t ? '<button type="button" class="btn btn-ghost wide" data-a="tn-clear">Remove status</button>' : ''}</form>`;
    },

    safety: () => `<h2 class="sh-t">${icon('shield')} Meeting safely</h2><ul class="ticks">
      <li>Chat first. Nothing opens until you both say yes.</li><li>Use Plan cards to pick a public place and time.</li>
      <li>Share the plan with someone you trust — one tap from the confirmed card.</li><li>Block and report from any chat. Reports are reviewed within 24 hours.</li></ul>
      <button class="btn btn-primary wide" data-a="close-sheet">Got it</button>`,

    share: ({ text }) => `<h2 class="sh-t">${icon('shield')} Share your plan</h2><p class="sh-p">Send this to a friend. In the app this opens the iOS share sheet.</p>
      <pre class="share-txt">${esc(text)}</pre><button class="btn btn-primary wide" data-a="copy-share">${icon('copy')} Copy</button>`,
  };

  const A = {
    perm: () => `<div class="ios-alert" role="alertdialog" aria-labelledby="pa-t"><b id="pa-t">Allow “Nearby Chat” to use your location?</b>
      <p>Your location is rounded to a broad area on your phone before it’s sent, to show distances like “Within 10 km”. It’s never shared exactly.</p>
      <button data-a="perm-allow" data-focus>Allow While Using App</button><button data-a="perm-deny">Don’t Allow</button></div>`,
    settings: () => `<div class="ios-alert"><b>iPhone Settings</b><p>In the app this opens Settings › Nearby Chat › Location. Demo: set permission back to “Not asked” in the demo panel.</p><button data-a="close-sheet" data-focus>OK</button></div>`,
  };

  NC.sheet = (kind, data) => (A[kind] ? { html: A[kind](data), alert: true } : { html: S[kind](data), alert: false });
})();

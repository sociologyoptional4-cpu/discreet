/* My profile, settings, editor, blocked accounts and account deletion. */
(() => {
  const { esc, icon, Avatar, EmptyState, Toggle, untilLabel } = NC;
  const st = () => NC.store.S;
  const q = () => NC.store.q;

  function me() {
    const u = q().meU(), set = q().set(), theme = NC.theme.get();
    const nBlocked = st().blocks.filter((b) => b.by === st().me).length;
    const live = q().live(u);
    return {
      tone: 'bg', tabs: true,
      html: `<div class="scroll" id="sc"><div class="big-h"><h1>Profile</h1></div>
        <section class="me-card"><button class="me-photo" data-a="open-profile" data-id="${st().me}" aria-label="Preview my profile"><img src="${NC.img(u.photos[0])}" alt=""></button>
          <div><h2>${esc(u.name)}, ${u.age}</h2><p class="place">${icon('pin')} ${esc(u.city)}</p>
          <div class="row-btns"><button class="btn btn-primary sm" data-a="go" data-id="edit">Edit profile</button><button class="btn btn-ghost sm" data-a="open-profile" data-id="${st().me}">Preview</button></div></div></section>
        <button class="tonight-set ${live ? 'on' : ''}" data-a="tonight">${icon('moon')}<span>${live
          ? `<b>${esc(u.tonight.text)}</b><span>${esc(u.tonight.area)} · ${untilLabel(u.tonight.until)} · tap to change</span>`
          : '<b>Post a Tonight status</b><span>Say you’re free. It disappears in 24 hours.</span>'}</span>${icon('chev', 'muted')}</button>
        <div class="me-strip" aria-label="My photos">${[0, 1, 2, 3].map((i) => u.photos[i] ? `<img src="${NC.img(u.photos[i])}" alt="Photo ${i + 1}">` : `<button class="slot" data-a="go" data-id="edit" aria-label="Add photo">${icon('plus')}</button>`).join('')}</div>
        <h3 class="grp">Appearance</h3><div class="group"><div class="set-row"><span class="set-l">Theme</span>
          <div class="seg mini-seg" role="radiogroup" aria-label="Theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) =>
            `<button role="radio" aria-checked="${theme === k}" data-a="theme" data-id="${k}">${l}</button>`).join('')}</div></div></div>
        <h3 class="grp">Discovery</h3><div class="group">
          ${Toggle('disc', u.discoverable, 'Show me on Nearby', u.discoverable ? 'People in your city can find you' : 'Paused — existing chats continue')}
          ${Toggle('approx', set.approx && st().demo.perm === 'granted', 'Approximate location', 'Broad distance bands only, cleared after 7 days')}</div>
        <h3 class="grp">Notifications</h3><div class="group">${Toggle('notif', set.notif, 'Messages and requests', 'Lock-screen previews stay generic')}</div>
        <h3 class="grp">Privacy & safety</h3><div class="group">
          <button class="set-row link-row" data-a="go" data-id="blocked"><span class="set-l">${icon('block')} Blocked accounts</span><span class="set-v">${nBlocked} ${icon('chev')}</span></button>
          <button class="set-row link-row" data-a="safety"><span class="set-l">${icon('shield')} Meeting safely</span>${icon('chev')}</button></div>
        <h3 class="grp">Account</h3><div class="group">
          <button class="set-row link-row" data-a="onboard"><span class="set-l">${icon('mail')} Sign out <span class="set-sub">Demo: replays onboarding</span></span>${icon('chev')}</button>
          <button class="set-row link-row danger" data-a="go" data-id="delete"><span class="set-l">${icon('trash')} Delete account</span>${icon('chev')}</button></div>
        <p class="fine center">Nearby Chat · prototype v2</p></div>`,
    };
  }

  function edit(r) {
    const d = r.p.draft;
    const slots = [0, 1, 2, 3].map((i) => d.photos[i]
      ? `<div class="eslot"><img src="${NC.img(d.photos[i])}" alt="Photo ${i + 1}${i === 0 ? ', main' : ''}">${i === 0 ? '<span class="main-tag">Main</span>' : ''}
          <button type="button" class="mini rm" data-a="ph-rm" data-id="${i}" aria-label="Remove photo ${i + 1}">${icon('x')}</button>
          <div class="mv">${i > 0 ? `<button type="button" class="mini" data-a="ph-mv" data-id="${i}:-1" aria-label="Move photo ${i + 1} earlier">${icon('left')}</button>` : ''}${i < d.photos.length - 1 ? `<button type="button" class="mini" data-a="ph-mv" data-id="${i}:1" aria-label="Move photo ${i + 1} later">${icon('right')}</button>` : ''}</div></div>`
      : `<button type="button" class="eslot add" data-a="ph-add" aria-label="Add photo from library">${icon('plus')}<span>Add</span></button>`).join('');
    return {
      tone: 'bg', tabs: false,
      html: `${NC.header('Edit profile', { right: `<button class="txtbtn" data-a="save-profile">Save</button>` })}
      <form class="scroll pad form" id="edit-form" novalidate>
        <h3 class="grp">Photos <span class="set-sub">${d.photos.length}/4 · first photo is your main</span></h3><div class="egrid">${slots}</div>
        ${r.p.err ? `<p class="err" role="alert">${icon('alert')} ${esc(r.p.err)}</p>` : ''}
        <label class="fld"><span>Name</span><input id="f-name" maxlength="30" value="${esc(d.name)}" autocomplete="given-name"></label>
        <label class="fld"><span>Bio <em id="bio-n">${d.bio.length}/160</em></span><textarea id="f-bio" maxlength="160" rows="3">${esc(d.bio)}</textarea></label>
        <div class="fld"><span>City</span><button type="button" class="select" data-a="pick-city" data-id="edit">${esc(d.city)} ${icon('down')}</button></div>
        <h3 class="grp">Interests <span class="set-sub">${d.tags.length}/6 · shared ones get highlighted for others</span></h3>
        <div class="tags pick">${NC.TAGS.map((t) => `<button type="button" class="tag ${d.tags.includes(t) ? 'on' : ''}" aria-pressed="${d.tags.includes(t)}" data-a="tag" data-id="${t}">${esc(t)}</button>`).join('')}</div>
        <h3 class="grp">Prompts <span class="set-sub">People can reply to these with a request</span></h3>
        ${[0, 1, 2].map((i) => `<div class="prompt-ed"><select data-pq="${i}" aria-label="Prompt ${i + 1}">${NC.PROMPTS.map((p) => `<option ${d.prompts[i]?.q === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
          <textarea data-pa="${i}" rows="2" maxlength="120" placeholder="Your answer (optional)" aria-label="Answer to prompt ${i + 1}">${esc(d.prompts[i]?.a || '')}</textarea></div>`).join('')}
        <p class="fine">Photos are re-encoded and stripped of location metadata before upload.</p></form>`,
    };
  }

  function blocked() {
    const list = st().blocks.filter((b) => b.by === st().me);
    return {
      tone: 'bg', tabs: false,
      html: `${NC.header('Blocked accounts')}<div class="scroll pad">${list.length ? `<div class="group">${list.map((b) => {
        const u = q().u(b.who);
        return `<div class="set-row">${Avatar(u, 40)}<span class="set-l grow">${esc(u.name)}</span><button class="btn btn-ghost sm" data-a="unblock" data-id="${b.who}">Unblock</button></div>`;
      }).join('')}</div>` : EmptyState({ ic: 'shield', title: 'No blocked accounts', body: 'People you block can’t see your profile or photos, or message you.' })}</div>`,
    };
  }

  function del(r) {
    return {
      tone: 'bg', tabs: false,
      html: `${NC.header('Delete account')}<div class="scroll pad">
        <div class="card"><h2 class="h2">This can't be undone</h2><ul class="ticks">
          <li>Your profile and photos leave Nearby right away.</li>
          <li>Your chats close for everyone. Messages you sent are removed from our servers within 30 days.</li>
          <li>Reports you made or received are kept for safety review, then purged.</li>
          <li>Backups are cleared within 35 days.</li></ul></div>
        <label class="fld"><span>Type DELETE to confirm</span><input id="f-del" autocomplete="off" autocapitalize="characters" value="${esc(r.p.typed || '')}"></label>
        <button class="btn btn-danger wide" data-a="do-delete" ${r.p.typed === 'DELETE' ? '' : 'disabled'}>Delete my account</button>
        <button class="btn btn-ghost wide" data-a="back">Keep my account</button></div>`,
    };
  }

  const deleted = () => ({ tone: 'bg', tabs: false, html: `<div class="center-screen">${EmptyState({ ic: 'check', title: 'Your account is being deleted', body: 'You’ve been signed out. We’ll email you when cleanup is complete.', action: 'reset', actionLabel: 'Restore demo data' })}</div>` });

  NC.screens = Object.assign(NC.screens || {}, { me, edit, blocked, delete: del, deleted });
})();

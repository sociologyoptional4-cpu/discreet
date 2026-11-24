/* Onboarding: email sign-in preview → 18+ date of birth → name & bio → city → photos. */
(() => {
  const { esc, icon } = NC;
  const STEPS = ['email', 'code', 'dob', 'about', 'vibe', 'city', 'photos'];

  const ageFrom = (iso) => {
    const b = new Date(iso + 'T00:00:00'), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  };

  const shell = (step, inner, { next = 'Continue', disabled = false, skipBack = false } = {}) => {
    const i = STEPS.indexOf(step);
    return `<div class="ob">
      <div class="ob-top">${i > 0 && !skipBack ? `<button class="icbtn" data-a="ob-back" aria-label="Back">${icon('back')}</button>` : '<span class="icbtn-sp"></span>'}
        <div class="ob-prog" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS.length}" aria-valuenow="${i + 1}" aria-label="Step ${i + 1} of ${STEPS.length}">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
        <span class="icbtn-sp"></span></div>
      <form class="ob-body" id="ob-form" novalidate>${inner}
        <div class="ob-foot"><button class="btn btn-primary wide" type="submit" ${disabled ? 'disabled' : ''}>${next}</button></div></form></div>`;
  };

  function render(r) {
    const o = r.p, err = o.err ? `<p class="err" role="alert">${icon('alert')} ${esc(o.err)}</p>` : '';
    let html;
    switch (o.step) {
      case 'email':
        html = shell('email', `<div class="ob-hero"><div class="logo" aria-hidden="true"><span></span><span></span></div>
          <h1>Meet people<br>near you.</h1><p>Private one-to-one chats, only after both of you say yes.</p></div>
          <label class="fld"><span>Email</span><input id="ob-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(o.email || '')}"></label>${err}
          <p class="fine">We'll send a one-time code. No passwords. You must be 18 or older.</p>`, { next: 'Send code' });
        break;
      case 'code':
        html = shell('code', `<h1 class="ob-h">Check your inbox</h1><p class="ob-p">Enter the 6-digit code sent to <b>${esc(o.email)}</b>.</p>
          <label class="fld"><span>Code</span><input id="ob-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="code" value="${esc(o.code || '')}"></label>${err}
          <p class="fine">Demo: any 6 digits work.</p>`, { next: 'Verify' });
        break;
      case 'dob':
        html = shell('dob', `<h1 class="ob-h">When's your birthday?</h1><p class="ob-p">Nearby Chat is for adults 18+. Only your age is shown — never your date of birth.</p>
          <label class="fld"><span>Date of birth</span><input id="ob-dob" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${esc(o.dob || '')}"></label>${err}`);
        break;
      case 'about':
        html = shell('about', `<h1 class="ob-h">Introduce yourself</h1><p class="ob-p">A first name and a line that starts conversations.</p>
          <label class="fld"><span>First name</span><input id="ob-name" maxlength="30" autocomplete="given-name" value="${esc(o.name || '')}"></label>
          <label class="fld"><span>Short bio <em id="ob-bio-n">${(o.bio || '').length}/160</em></span><textarea id="ob-bio" rows="3" maxlength="160" placeholder="What would you talk about for hours?">${esc(o.bio || '')}</textarea></label>${err}`);
        break;
      case 'vibe':
        html = shell('vibe', `<h1 class="ob-h">Pick your vibe</h1><p class="ob-p">Choose 3 to 6. People who share them see a spark on your card.</p>
          <div class="tags pick">${NC.TAGS.map((t) => `<button type="button" class="tag ${(o.tags || []).includes(t) ? 'on' : ''}" aria-pressed="${(o.tags || []).includes(t)}" data-a="ob-tag" data-id="${t}">${esc(t)}</button>`).join('')}</div>${err}`,
          { next: `Continue${(o.tags || []).length ? ` · ${o.tags.length}` : ''}` });
        break;
      case 'city': {
        const denied = o.denied ? `<div class="card denied" role="alert"><b>Location access is off</b><p>No problem — pick your city below. You can turn on approximate distance later in Profile.</p></div>` : '';
        html = shell('city', `<h1 class="ob-h">Where are you?</h1><p class="ob-p">Nearby shows people in your city. Distance is optional and always approximate.</p>
          <button type="button" class="btn btn-soft wide" data-a="ob-loc">${icon('pin')} Use approximate location</button>${denied}
          <h3 class="grp">Choose city manually</h3><div class="group radios" role="radiogroup" aria-label="City">${NC.CITIES.map((c) =>
            `<label class="set-row"><span class="set-l">${c}</span><input type="radio" name="city" value="${c}" ${o.city === c ? 'checked' : ''}></label>`).join('')}</div>${err}`);
        break;
      }
      case 'photos':
        html = shell('photos', `<h1 class="ob-h">Add your photos</h1><p class="ob-p">Up to 4. Your first photo is your main one. Clear, recent, just you.</p>
          <div class="egrid">${[0, 1, 2, 3].map((i) => o.photos[i]
            ? `<div class="eslot"><img src="${NC.img(o.photos[i])}" alt="Photo ${i + 1}"><button type="button" class="mini rm" data-a="ob-ph-rm" data-id="${i}" aria-label="Remove photo ${i + 1}">${icon('x')}</button></div>`
            : `<button type="button" class="eslot add" data-a="ph-add" data-id="ob" aria-label="Add photo from library">${icon('plus')}<span>Add</span></button>`).join('')}</div>${err}
          <p class="fine">We remove location data from photos before they're uploaded.</p>`, { next: 'Finish', disabled: !o.photos.length });
        break;
    }
    return { tone: 'surface', tabs: false, html };
  }

  // Returns error string, or null after advancing.
  function submit(o, f) {
    const val = (id) => (f.querySelector('#' + id)?.value || '').trim();
    switch (o.step) {
      case 'email': o.email = val('ob-email'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) return 'Enter a valid email address.'; break;
      case 'code': o.code = val('ob-code'); if (!/^\d{6}$/.test(o.code)) return 'Enter the 6-digit code.'; break;
      case 'dob': o.dob = val('ob-dob'); if (!o.dob) return 'Choose your date of birth.';
        if (ageFrom(o.dob) < 18) return 'Sorry — you need to be 18 or older to use Nearby Chat.'; break;
      case 'about': o.name = val('ob-name'); o.bio = val('ob-bio'); if (!o.name) return 'Add your first name.'; break;
      case 'vibe': if ((o.tags || []).length < 3) return 'Pick at least 3.'; break;
      case 'city': o.city = f.querySelector('input[name=city]:checked')?.value; if (!o.city) return 'Choose a city to continue.'; break;
      case 'photos': if (!o.photos.length) return 'Add at least one photo.'; return 'done';
    }
    o.step = STEPS[STEPS.indexOf(o.step) + 1];
    return null;
  }

  const back = (o) => { o.step = STEPS[Math.max(0, STEPS.indexOf(o.step) - 1)]; o.err = ''; };

  NC.onboard = { render, submit, back, ageFrom };
})();

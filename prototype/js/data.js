/* Seed data for the Nearby Chat prototype. Every person here is a fictional demo persona. */
window.NC = window.NC || {};

NC.CITIES = ['Bengaluru', 'Mumbai', 'Delhi', 'Pune', 'Hyderabad', 'Chennai', 'Goa'];
NC.GALLERY = ['l11', 'l22', 'l33', 'l44', 'l66', 'l77', 'l88', 'l99', 'l111', 'l122', 'l133'];
NC.PORTRAITS = ['p36', 'p59', 'p26', 'p12', 'p32', 'p16', 'p13', 'p47', 'p52', 'p5', 'p25', 'p57', 'p44', 'p60', 'p49', 'p51', 'p23'];
NC.img = (key) => `img/${key}.jpg`;

NC.TAGS = ['Coffee', 'Pottery', 'Design', 'Live music', 'Trekking', 'Cats', 'Cycling', 'Books', 'Comedy', 'Food walks', 'Photography', 'Climbing', 'Jazz', 'Baking', 'Films', 'Running', 'Board games', 'Travel'];
NC.PROMPTS = ['My ideal Sunday', 'A green flag I look for', 'Ask me about', 'The way to win me over', 'Best spot in my city', 'I’m weirdly good at', 'Tonight I’d rather'];

NC.PLACES = [
  ['Filter coffee bar', 'Indiranagar, 12th Main'],
  ['Cubbon Park bandstand', 'Central Bengaluru'],
  ['Bookshop café', 'Church Street'],
  ['Live music bar', 'Koramangala 5th Block'],
  ['Lakeside walk', 'Sankey Tank'],
];
NC.WHEN = ['Today · 7 pm', 'Tomorrow · 6 pm', 'Saturday · 11 am', 'Sunday · 5 pm'];

NC.ICEBREAKERS = [
  { kind: 'This or that', q: 'Sunrise trek or sunset rooftop?', opts: ['Sunrise trek', 'Sunset rooftop'] },
  { kind: 'This or that', q: 'Filter coffee or masala chai?', opts: ['Filter coffee', 'Masala chai'] },
  { kind: 'Would you rather', q: 'Would you rather plan the date or be surprised?', opts: ['Plan it', 'Surprise me'] },
  { kind: 'This or that', q: 'Bookshop crawl or food walk?', opts: ['Bookshop crawl', 'Food walk'] },
  { kind: 'Rapid fire', q: 'Last song you played twice in a row?', opts: [] },
  { kind: 'Rapid fire', q: 'Most underrated place in your city?', opts: [] },
];

NC.VIBES = [
  { k: 'music', e: '🎵', l: 'Music', re: /music|jazz|gig|band|drum|concert|vinyl/i },
  { k: 'coffee', e: '☕', l: 'Coffee', re: /coffee|chai|café|cafe|croissant|bake/i },
  { k: 'drinks', e: '🍸', l: 'Drinks', re: /drink|cocktail|bar\b|beer/i },
  { k: 'late', e: '🌙', l: 'Late night', re: /late|night|midnight|jazz night/i },
  { k: 'walk', e: '🌿', l: 'Walk', re: /walk|park|trek|run|cycle|ride/i },
];
/** A single vibe pill read from someone's Tonight text, then their interests. */
NC.vibeOf = (u) => {
  const text = `${u.tonight?.text || ''} ${u.tonight?.area || ''}`;
  return NC.VIBES.find((v) => v.re.test(text)) || NC.VIBES.find((v) => (u.tags || []).some((t) => v.re.test(t))) || NC.VIBES[3];
};
NC.REACTIONS = ['🔥', '😍', '😂', '✨', '🎵', '👋'];
NC.SNAP_SECS = 5;

NC.REPLIES = ['Ha, fair point.', 'Okay that made me smile.', 'Tell me more?', 'Sounds like a plan. Coffee first though.', 'Wait, really? Same here.', 'You have good taste.'];

NC.seed = function seed() {
  const now = Date.now();
  const min = 60e3, hr = 60 * min, day = 24 * hr;
  const U = (name, age, city, photos, bio, band, tags, prompts, loc = true) =>
    ({ name, age, city, photos, bio, band, tags, prompts: prompts.map(([q, a]) => ({ q, a })), loc, discoverable: true, tonight: null });

  const users = {
    maya: U('Maya', 27, 'Bengaluru', ['p36', 'l122', 'l44', 'l66'],
      'Product designer. Weekend potter, weekday filter-coffee loyalist.', 'Within 5 km',
      ['Coffee', 'Pottery', 'Design', 'Cats', 'Books'],
      [['My ideal Sunday', 'Wheel-throwing class, a long lunch, and a bookshop I’ve never been to.'],
        ['A green flag I look for', 'You ask a second question about my answer.'],
        ['Best spot in my city', 'The dosa place in Indiranagar with no sign outside. Ask me.']]),
    kabir: U('Kabir', 29, 'Bengaluru', ['p59', 'l77', 'l99'],
      'Backend engineer by day, sunrise cyclist up Nandi Hills by weekend.', 'Within 5 km',
      ['Cycling', 'Coffee', 'Live music', 'Trekking', 'Books'],
      [['Tonight I’d rather', 'Find a quiet table with live jazz and talk until they close.'],
        ['I’m weirdly good at', 'Guessing the next song in any café playlist.'],
        ['The way to win me over', 'Send me your most chaotic playlist.']]),
    ananya: U('Ananya', 26, 'Bengaluru', ['p26', 'l133'], 'Architect sketching old Bangalore bungalows before they disappear.', 'Within 2 km',
      ['Design', 'Photography', 'Food walks'], [['Ask me about', 'The 1920s house on my street with a secret courtyard.'], ['My ideal Sunday', 'Sketchbook, Cubbon Park, cutting chai.']]),
    rohan: U('Rohan', 30, 'Bengaluru', ['p12', 'l88'], 'Open mics on Thursdays. I will laugh at your jokes, mostly.', 'Within 10 km',
      ['Comedy', 'Films', 'Coffee'], [['The way to win me over', 'Heckle me kindly.']], false),
    tara: U('Tara', 25, 'Bengaluru', ['p32', 'l11'], 'Bookshop Saturdays, trek Sundays, nap Mondays.', 'Within 5 km',
      ['Books', 'Trekking', 'Cats'], [['A green flag I look for', 'You return books you borrow.'], ['Best spot in my city', 'Skandagiri at 4 am.']]),
    zoya: U('Zoya', 28, 'Bengaluru', ['p16', 'l44'], 'Pastry chef. Croissants are my love language.', 'Within 10 km',
      ['Baking', 'Food walks', 'Live music'], [['I’m weirdly good at', 'Laminating dough at 5 am without coffee.']]),
    ishaan: U('Ishaan', 31, 'Bengaluru', ['p13', 'l133'], 'Street photographer. Show me your favourite lane.', 'Within 25 km',
      ['Photography', 'Cycling', 'Jazz'], [['Ask me about', 'The 400 photos I took of one tea stall.']]),
    leah: U('Leah', 27, 'Bengaluru', ['p47', 'l22'], 'Moved from Pune for work, staying for the weather.', 'Within 10 km',
      ['Running', 'Coffee', 'Board games'], [['Tonight I’d rather', 'Lose at Codenames with new people.']]),
    dev: U('Dev', 28, 'Bengaluru', ['p52', 'l99'], 'Drummer, coder, cat person. In that order on Fridays.', 'Within 2 km',
      ['Live music', 'Cats', 'Design'], [['The way to win me over', 'Know the drummer’s name in your favourite band.']]),
    sana: U('Sana', 24, 'Mumbai', ['p5', 'l111'], 'Sea-face runs and too much chai.', 'Within 5 km', ['Running', 'Travel'], [['Best spot in my city', 'Bandstand at 6 am.']]),
    mei: U('Mei', 26, 'Mumbai', ['p25', 'l33'], 'Illustrator. I will draw you badly, with love.', 'Within 10 km', ['Design', 'Films'], [['Ask me about', 'My zine about Mumbai trains.']]),
    arjun: U('Arjun', 32, 'Mumbai', ['p57', 'l66'], 'Film editor. Strong opinions on biryani.', 'Within 25 km', ['Films', 'Food walks'], [['A green flag I look for', 'You stay for the credits.']]),
    ira: U('Ira', 29, 'Delhi', ['p44', 'l122'], 'Lawyer who still believes in handwritten letters.', 'Within 5 km', ['Books', 'Travel'], [['My ideal Sunday', 'Lodhi Garden and a long letter.']]),
    vikram: U('Vikram', 30, 'Delhi', ['p60', 'l77'], 'Weekend chef, weekday economist.', 'Within 10 km', ['Baking', 'Board games'], [['I’m weirdly good at', 'Predicting chai prices.']]),
    nina: U('Nina', 27, 'Pune', ['p49', 'l11'], 'Climbing gym regular. Looking for a belay partner and a brunch partner.', 'Within 5 km', ['Climbing', 'Coffee'], [['Tonight I’d rather', 'Boulder, then pav bhaji.']]),
    omar: U('Omar', 33, 'Hyderabad', ['p51', 'l88'], 'Jazz on vinyl, haleem in Ramzan.', 'Within 10 km', ['Jazz', 'Food walks'], [['Ask me about', 'My dad’s record collection.']]),
    riya: U('Riya', 25, 'Hyderabad', ['p23', 'l33'], 'Med student. Ask me about anything except exams.', 'Within 2 km', ['Films', 'Running'], [['The way to win me over', 'Bring snacks to the library.']]),
  };
  const T = (text, area, hrs) => ({ text, area, until: now + hrs * hr, at: now - 30 * min });
  users.ananya.tonight = T('Free for filter coffee', 'Indiranagar', 3);
  users.dev.tonight = T('Gig at 9, one spare ticket', 'Koramangala', 5);
  users.zoya.tonight = T('Testing a new croissant, need tasters', 'HSR Layout', 4);
  users.kabir.tonight = T('Jazz night, anyone?', 'Church Street', 6);

  const M = (from, text, at, extra = {}) => ({ type: 'text', from, text, at, status: 'sent', ...extra });
  const convo = (id, a, b, msgs, readA, readB) => {
    msgs.forEach((m, i) => { m.id = m.cid = `${id}-${i}`; m.seq = i + 1; });
    return { id, members: [a, b], msgs, read: { [a]: readA ?? msgs.length, [b]: readB ?? msgs.length } };
  };

  // 1,000-message history so pagination and scroll preservation can be reviewed.
  const longLines = ['Morning! Coffee yet?', 'Two cups in. You?', 'Did you see that sky today', 'That photo is unreal', 'Ride this weekend?', 'Only if it ends at a bakery', 'Deal', 'Sending you the route', 'Running late, 10 min', 'No rush, I got us a table'];
  const long = Array.from({ length: 1000 }, (_, i) => M(i % 3 === 0 ? 'maya' : 'ishaan', longLines[i % longLines.length], now - (1000 - i) * 90 * min - 5 * hr));
  long.push(M('ishaan', 'Sending you the photo walk route for Saturday', now - 5 * hr));

  const convos = [
    convo('c1', 'maya', 'rohan', [
      M('maya', 'Okay, the open mic was actually funny. The bit about auto meters?', now - day - 3 * hr),
      M('rohan', 'Ha, that one kills every time. You were the one laughing in the second row?', now - day - 2 * hr),
      M('maya', 'Guilty.', now - day - hr),
      M('rohan', 'Next Thursday at Koramangala, same time?', now - 22 * min),
      M('rohan', 'I am trying new material, be kind', now - 20 * min),
      { type: 'voice', from: 'rohan', secs: 14, at: now - 9 * min, status: 'sent' },
    ], 3),
    convo('c2', 'maya', 'tara', [
      M('tara', 'Found the bookshop you mentioned on Church Street!', now - 3 * hr),
      M('maya', 'The one with the cat on the poetry shelf?', now - 2 * hr),
      { type: 'card', from: 'maya', q: 'Bookshop crawl or food walk?', kind: 'This or that', opts: ['Bookshop crawl', 'Food walk'], answer: 'Bookshop crawl', at: now - 2 * hr + 5 * min, status: 'sent' },
      M('tara', 'Yes and she judged my choices', now - 54 * min),
      { type: 'snap', from: 'tara', photo: 'l77', secs: NC.SNAP_SECS, viewed: false, at: now - 12 * min, status: 'sent' },
    ], 3),
    convo('c3', 'maya', 'ishaan', long),
    convo('c4', 'maya', 'dev', [
      M('dev', 'Did your cat really knock the pot off the wheel?', now - 4 * day),
      M('maya', 'Mid-throw. Clay everywhere.', now - 4 * day + 3 * hr),
      M('dev', 'Respect to the cat', now - 4 * day + 4 * hr),
      { type: 'plan', from: 'dev', place: NC.PLACES[3], when: 'Saturday · 11 am', status: 'proposed', at: now - 3 * day, statusBy: null },
    ]),
  ];

  const requests = [
    { id: 'r1', from: 'leah', to: 'maya', status: 'pending', at: now - 2 * hr, note: 'Codenames rematch energy? I’m terrible but enthusiastic.', prompt: 'A green flag I look for' },
    { id: 'r2', from: 'maya', to: 'ananya', status: 'pending', at: now - day, note: 'Your courtyard house sounds like a whole story.', prompt: 'Ask me about' },
  ];

  return {
    v: 3,
    me: 'maya',
    users, convos, requests,
    blocks: [], reports: [], deleted: {},
    settings: { maya: { approx: true, notif: true }, kabir: { approx: true, notif: true } },
    nearbyCity: { maya: 'Bengaluru', kabir: 'Bengaluru' },
    demo: { width: 390, ts: 1, reduce: false, rt: false, net: 'fast', failNext: false, perm: 'granted', stress: false },
  };
};

/* Generated fixture: 300 inbox rows for list-performance review. Labelled as fixture in the UI. */
NC.stressFixture = function stressFixture(me) {
  const now = Date.now(), users = {}, convos = [];
  for (let i = 1; i <= 300; i++) {
    const id = `fx${i}`;
    users[id] = { name: `Fixture ${String(i).padStart(3, '0')}`, age: 21 + (i % 15), city: 'Bengaluru', photos: [NC.PORTRAITS[i % NC.PORTRAITS.length]], bio: 'Generated test row.', band: 'Within 25 km', tags: [], prompts: [], loc: false, discoverable: false, tonight: null, fixture: true };
    const at = now - i * 47 * 60e3;
    convos.push({ id: `fxc${i}`, members: [me, id], fixture: true, read: { [me]: i % 7 ? 1 : 0, [id]: 1 }, msgs: [{ id: `fxm${i}`, cid: `fxm${i}`, seq: 1, type: 'text', from: id, text: NC.REPLIES[i % NC.REPLIES.length], at, status: 'sent' }] });
  }
  return { users, convos };
};

// Free, offline idea engine. Everything is generated from templates — no API, no cost.

// ---- tiny helpers ---------------------------------------------------------

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function pickMany(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

const SHARED = {
  number: ["3", "5", "7", "10", "13", "25", "50", "100"],
  time: ["24 hours", "48 hours", "7 days", "30 days", "100 days", "1 year"],
  money: ["$1", "$5", "$10", "$50", "$100", "$1,000"],
  person: ["a stranger", "my little brother", "my best friend", "a subscriber", "my mom", "a pro player", "my viewers"],
};

// Fills {placeholders} from the given bank (falls back to SHARED), then fixes "a"/"an".
function fill(template, bank = {}) {
  return template
    .replace(/\{(\w+)\}/g, (_, key) => {
      const v = bank[key] ?? SHARED[key];
      if (v === undefined) return key;
      return Array.isArray(v) ? pick(v) : v;
    })
    .replace(/\b([Aa]) ([aeiouAEIOU])/g, "$1n $2");
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const numbered = (items) => items.map((x, i) => `**${i + 1}.** ${x}`).join("\n\n");

// ---- /idea ----------------------------------------------------------------

const WHY = {
  challenge: "Challenges have built-in stakes: people stay to see if you make it.",
  ranking: "Rankings start arguments in the comments, and comments push it to more people.",
  transform: "Before/after transformations have a guaranteed payoff, so people watch to the end.",
  curiosity: "It opens a question the viewer needs answered.",
  relatable: "Relatable content gets shared with 'this is so you' tags.",
  versus: "Head-to-heads make viewers pick a side and comment.",
  generosity: "Giving something away feels good to watch and is easy to share.",
  series: "A series gives people a reason to follow for the next part.",
  interactive: "Letting the audience control things turns viewers into participants.",
};

const CATEGORIES = {
  youtube: {
    label: "YouTube",
    format: ["8-12 min video", "15-20 min video", "10 min video + Short cutdown"],
    topic: ["budget tech", "study hacks", "street food", "life hacks", "fitness", "room makeovers", "cooking", "school life"],
    ideas: [
      { t: "I tried {topic} for {time} — here's what happened", h: "Show the final result first, then rewind to day 1.", why: "challenge" },
      { t: "Ranking every {topic} trend from worst to best", h: "Open with your #1 pick hidden behind a blur: 'You won't guess what's number one.'", why: "ranking" },
      { t: "I gave {person} {money} to fix my {topic} problem", h: "Hand over the cash on camera in the first 3 seconds.", why: "generosity" },
      { t: "{number} {topic} mistakes everyone makes (I made all of them)", h: "Start mid-mistake with a fail clip.", why: "relatable" },
      { t: "Cheap vs expensive {topic}: is it worth it?", h: "Show both price tags side by side, then the first surprising result.", why: "versus" },
      { t: "Beginner vs pro: {topic}", h: "Split screen: same task, wildly different results.", why: "versus" },
      { t: "The truth about {topic} nobody tells you", h: "'I wasted {money} so you don't have to.'", why: "curiosity" },
      { t: "Turning my worst {topic} into my best in {time}", h: "Show the ugly 'before' in full, no cuts.", why: "transform" },
    ],
  },
  shorts: {
    label: "Shorts / TikTok / Reels",
    format: ["15-30s vertical", "30-45s vertical", "Part 1 of a series"],
    topic: ["school", "gaming", "your job", "group chats", "siblings", "gym", "cooking", "your pet"],
    ideas: [
      { t: "POV: {topic} but everything goes wrong", h: "Start on the moment it goes wrong, then cut back.", why: "relatable" },
      { t: "Day {daynum} of {topic} until I hit 10k followers", h: "Big on-screen counter: 'Day {daynum}'.", why: "series" },
      { t: "Things that just make sense in {topic}", h: "Rapid 1-second cuts, text on screen, trending sound.", why: "relatable" },
      { t: "Rating {topic} items 1-10 as a professional", h: "First item gets a shocking 1/10 instantly.", why: "ranking" },
      { t: "Comment a word and I'll turn it into a {topic} video", h: "Reply-to-comment format: show the comment first.", why: "interactive" },
      { t: "Tell me you love {topic} without telling me", h: "Fast montage of oddly specific habits.", why: "relatable" },
      { t: "I let my followers control my {topic} for a day", h: "Show the most chaotic choice in the first second.", why: "interactive" },
      { t: "{topic} glow up in {time}", h: "Flash the 'after' for half a second, then 'wait for it'.", why: "transform" },
    ],
  },
  music: {
    label: "Music",
    format: ["15s snippet for TikTok/Reels", "Full track + 3 short teasers", "Studio vlog Short"],
    topic: ["a viral sound", "a school bell", "your pet's noises", "a voice memo", "rain", "a video game theme"],
    genre: ["lo-fi", "phonk", "drill", "pop-punk", "afrobeats", "hyperpop", "R&B", "trap", "EDM"],
    ideas: [
      { t: "Turning {topic} into a {genre} beat", h: "Play the raw sound, then hard-cut to the drop.", why: "transform" },
      { t: "Making a {genre} song in 10 minutes using only {topic}", h: "Timer on screen from second one.", why: "challenge" },
      { t: "Let the comments write my next {genre} song, line by line", h: "'Your comment = the next lyric.'", why: "interactive" },
      { t: "Same melody in {number} genres — which one hits hardest?", h: "Start with the weirdest genre version.", why: "versus" },
      { t: "Producer reacts to {topic} — then remakes it as {genre}", h: "Pause on the reaction face.", why: "curiosity" },
      { t: "Writing a {genre} song about {topic} (it slaps?)", h: "Open with the catchiest 3 seconds of the chorus.", why: "curiosity" },
      { t: "$0 vs {money} studio setup: same {genre} song", h: "A/B the audio immediately.", why: "versus" },
    ],
  },
  roblox: {
    label: "Roblox",
    format: ["YouTube video (10 min)", "Short (gameplay + facecam)", "Game update + trailer"],
    topic: ["Brookhaven", "Blox Fruits", "Adopt Me", "Doors", "Tower of Hell", "Natural Disaster Survival", "an obby"],
    ideas: [
      { t: "I survived 100 days in {topic} using only free items", h: "Show day 100 first, then 'how did I get here?'", why: "challenge" },
      { t: "Beating {topic} but every death makes it harder", h: "Death counter in the corner from the start.", why: "challenge" },
      { t: "I made my own {topic}-style game in {time}", h: "Show the finished game with players in it first.", why: "transform" },
      { t: "Noob vs pro vs hacker in {topic}", h: "Three-way split screen in the first frame.", why: "versus" },
      { t: "Giving {money} of Robux to whoever wins my {topic} event", h: "Show the Robux amount on screen right away.", why: "generosity" },
      { t: "{number} {topic} secrets the devs don't want you to know", h: "Do secret #1 instantly, no intro.", why: "curiosity" },
      { t: "My viewers control my {topic} character", h: "Show chat commands appearing live.", why: "interactive" },
    ],
  },
  gaming: {
    label: "Gaming",
    format: ["Highlight video (8-12 min)", "Short clip (30s)", "Stream to video cutdown"],
    topic: ["Minecraft", "Fortnite", "GTA V", "Valorant", "Among Us", "a horror game", "Rocket League", "EA FC"],
    restriction: ["I can't jump", "chat controls my keyboard", "I'm blindfolded every 5 minutes", "only starter gear", "every kill swaps my controls"],
    ideas: [
      { t: "Beating {topic} but {restriction}", h: "Show the restriction's worst moment first.", why: "challenge" },
      { t: "{number} {topic} tricks even pros don't use", h: "Trick #1 in the first 3 seconds, no intro.", why: "curiosity" },
      { t: "I played {topic} for {time} straight: rank progression", h: "Show starting rank → final rank, then rewind.", why: "transform" },
      { t: "Can a noob beat a pro at {topic} with a {time} head start?", h: "Introduce both players with stats cards.", why: "versus" },
      { t: "Ranking every {topic} weapon/item from trash to god tier", h: "Put a popular item in trash tier immediately.", why: "ranking" },
      { t: "Teaching my {person} {topic} — then we 1v1", h: "Show the 1v1 score first.", why: "versus" },
      { t: "Every time I die in {topic}, I do {number} pushups", h: "Pushup counter on screen.", why: "challenge" },
    ],
  },
  streaming: {
    label: "Streaming",
    format: ["Live stream (2-4 hrs)", "Stream + clip channel", "Weekly series stream"],
    topic: ["Minecraft", "a horror game", "Just Chatting", "speedrunning", "art", "music production", "a new release"],
    ideas: [
      { t: "Subathon: every follow adds 1 minute of {topic}", h: "Big live timer on screen.", why: "interactive" },
      { t: "Chat decides everything: {topic} edition", h: "Polls every 10 minutes that change the game.", why: "interactive" },
      { t: "I won't end stream until I beat {topic}", h: "Title the stream with the goal and a live attempt counter.", why: "challenge" },
      { t: "Viewer vs streamer {topic} tournament", h: "Winner gets a shoutout or a feature.", why: "versus" },
      { t: "Learning {topic} from zero, live, day {daynum}", h: "Show yesterday's best moment at the start.", why: "series" },
      { t: "Rating viewers' {topic} setups/creations live", h: "Clip every 1/10 and 10/10 moment for Shorts.", why: "ranking" },
    ],
  },
  instagram: {
    label: "Instagram",
    format: ["Reel (15-30s)", "Carousel (7-10 slides)", "Reel + Story poll"],
    topic: ["outfits", "food", "your city", "study setups", "fitness", "photography", "your morning routine"],
    ideas: [
      { t: "{number} {topic} tips I wish I knew sooner (carousel)", h: "Slide 1: bold claim + 'swipe →'.", why: "curiosity" },
      { t: "{topic}: expectation vs reality", h: "Expectation clip, record-scratch, reality.", why: "relatable" },
      { t: "Recreating a famous {topic} look for under {money}", h: "Side-by-side of original and yours.", why: "transform" },
      { t: "Rating my followers' {topic}", h: "Story poll for submissions → Reel of the best ones.", why: "interactive" },
      { t: "{topic} in {time}: a timelapse", h: "Show the end result as the cover frame.", why: "transform" },
      { t: "Save this for later: the ultimate {topic} checklist", h: "Carousel with a clear 'save this' first slide.", why: "curiosity" },
    ],
  },
  art: {
    label: "Art / Drawing",
    format: ["Speedpaint Short", "10 min process video", "Carousel of progress"],
    topic: ["anime characters", "your followers' pets", "game characters", "your city", "random objects", "cartoon villains"],
    style: ["Pixar", "anime", "pixel art", "Renaissance", "comic book", "realistic"],
    ideas: [
      { t: "Drawing {topic} in {number} different art styles", h: "Flash the finished grid first.", why: "versus" },
      { t: "I drew {topic} with my eyes closed, then fixed it", h: "Reveal the closed-eyes drawing first.", why: "transform" },
      { t: "Turning {topic} into {style} style", h: "Original → finished morph in the first second.", why: "transform" },
      { t: "Drawing your comments as {topic}", h: "Show the comment, then the drawing.", why: "interactive" },
      { t: "{money} vs $100 art supplies: same drawing", h: "Both finished drawings side by side; ask which is which.", why: "versus" },
      { t: "Day {daynum} of drawing {topic} until I get good", h: "Day 1 drawing next to today's.", why: "series" },
    ],
  },
};

export const ideaCategories = Object.entries(CATEGORIES).map(([value, c]) => ({ name: c.label, value }));

function buildIdea(cat, entry, niche) {
  const daynum = pick(["1", "7", "14", "30", "50", "100"]);
  const bank = { ...cat, topic: niche || cat.topic, daynum };
  return [
    `**${cap(fill(entry.t, bank))}**`,
    `🎣 **Hook:** ${fill(entry.h, bank)}`,
    `🎬 **Format:** ${pick(cat.format)}`,
    `🚀 **Why it can spread:** ${WHY[entry.why]}`,
  ].join("\n");
}

export function idea({ category, niche, audience }) {
  const key = CATEGORIES[category] ? category : pick(Object.keys(CATEGORIES));
  const cat = CATEGORIES[key];
  const picks = pickMany(cat.ideas, 3);
  let text = numbered(picks.map((e) => buildIdea(cat, e, niche)));
  if (audience) text += `\n\n🎯 **For ${audience}:** use their slang, show faces/reactions their age, and post when they're online (usually after school/work, 5-9 PM).`;
  return { title: `💡 Viral ideas: ${cat.label}`, text };
}

export function random() {
  const key = pick(Object.keys(CATEGORIES));
  const cat = CATEGORIES[key];
  return { title: `🎲 Random idea: ${cat.label}`, text: buildIdea(cat, pick(cat.ideas)) };
}

// ---- /titles --------------------------------------------------------------

const TITLE_TEMPLATES = [
  "I tried {topic} for {time} (I didn't expect this)",
  "{number} {topic} tips that actually work",
  "Why nobody talks about {topic}",
  "{topic} in {time}: from zero to pro",
  "Stop doing {topic} like this",
  "I wasted {money} on {topic} so you don't have to",
  "The {topic} trick that changed everything",
  "Beginner vs pro: {topic}",
  "{topic}… but it goes horribly wrong",
  "Rating every {topic} so you don't have to",
  "This is the easiest way to get better at {topic}",
  "I asked {number} people about {topic}. The answers shocked me",
  "The dark side of {topic}",
  "Cheap vs expensive {topic}",
  "I quit {topic} for {time}. Here's what happened",
  "{topic} explained in {number} minutes",
  "Everything wrong with {topic}",
  "I did {topic} every day for {time}",
];

const THUMBNAILS = [
  ["Your face, mid-shock, pointing at the result", "IT WORKED?!"],
  ["Split image: bad 'before' (red X) vs good 'after' (green check)", "BEFORE / AFTER"],
  ["One object, huge and centered, on a bright solid background", "WORTH IT?"],
  ["You looking at the camera, a big red arrow pointing at a detail", "WAIT…"],
  ["Two items side by side with price tags", "$1 VS $100"],
  ["Close-up of your reaction with a blurred result behind you", "NO WAY"],
  ["A big number in the corner, you holding up fingers", "DAY 100"],
  ["High contrast: dark background, one glowing subject", "DON'T DO THIS"],
];

export function titles({ topic, platform }) {
  const list = pickMany(TITLE_TEMPLATES, 8).map((t) => cap(fill(t, { topic })));
  const thumbs = pickMany(THUMBNAILS, 3).map(([scene, text]) => `• ${scene}. Text: **"${text}"**`);
  const tip =
    platform && /tiktok|shorts|reels/i.test(platform)
      ? "Tip: on short-form, the on-screen text in the first second matters more than the caption."
      : "Tip: keep titles under 60 characters so they don't get cut off on mobile.";
  return {
    title: `🏷️ Titles for: ${topic}`,
    text: `${list.map((t, i) => `**${i + 1}.** ${t}`).join("\n")}\n\n🖼️ **Thumbnail concepts**\n${thumbs.join("\n")}\n\n*${tip}*`,
  };
}

// ---- /hooks ---------------------------------------------------------------

const HOOKS = [
  ["Bold claim", "This is the only {topic} video you'll ever need."],
  ["Question", "Why does nobody talk about this {topic} trick?"],
  ["Stakes", "If I mess up this {topic} challenge, I give a viewer {money}."],
  ["Pattern interrupt", "(Start mid-action, loud sound) — okay, THAT wasn't supposed to happen."],
  ["Result first", "This is what {time} of {topic} did to me."],
  ["Callout", "If you're into {topic}, you're probably doing this wrong."],
  ["Secret", "{number} {topic} secrets I learned the hard way."],
  ["Countdown", "You have {number} seconds to guess how this {topic} ends."],
  ["Relatable", "POV: you just got into {topic} and everyone's ahead of you."],
  ["Contrarian", "Unpopular opinion: {topic} is way easier than people say."],
  ["Visual hook", "(Show the finished result for 1 second, then cut to black) Let me show you how."],
  ["Challenge", "I gave myself {time} to master {topic}."],
  ["Warning", "Don't try {topic} until you've seen this."],
  ["Story", "{time} ago I knew nothing about {topic}. Now look."],
];

export function hooks({ topic }) {
  const list = pickMany(HOOKS, 7).map(([label, h], i) => `**${i + 1}. ${label}:** ${fill(h, { topic })}`);
  return {
    title: `🎣 Hooks for: ${topic}`,
    text: `${list.join("\n")}\n\n*Say the hook within the first 1-2 seconds, and put it as on-screen text too, since lots of people watch muted.*`,
  };
}

// ---- /rate ----------------------------------------------------------------

// `up` turns the idea into a stronger version when that element is missing.
const CHECKS = [
  { test: /\d/, pts: 1, good: "Has a specific number (people love specifics).", fix: "Add a number: '7 days', '$10', '100 players'." },
  { test: /\b(day|days|hour|hours|week|weeks|month|year|minute|minutes|24|48|100)\b/i, pts: 1.5, good: "Has a time frame, which creates a challenge.", fix: "Add a time limit: 'in 24 hours', 'for 30 days'." },
  { test: /\b(try|tried|survive|survived|challenge|only|without|can't|cannot|no )\b/i, pts: 1.5, good: "Has a restriction or challenge.", fix: "Add a rule that makes it harder: '…but I can only use free items'." },
  { test: /\b(vs|versus|beat|beats|against|1v1|battle|compare|cheap|expensive)\b/i, pts: 1, good: "Has a face-off, which gets people picking sides.", fix: "Make it a face-off: 'noob vs pro', 'cheap vs expensive'." },
  { test: /\b(secret|nobody|never|truth|why|what happens|hidden|shocking|actually)\b/i, pts: 1, good: "Has a curiosity gap.", fix: "Open a question: '…and what happened next shocked me'." },
  { test: /\b(before|after|from zero|glow ?up|transform|turned|turning|noob to pro|became|learn|learning)\b/i, pts: 1, good: "Has a transformation, so there's a clear payoff.", fix: "Show a change: 'from zero to…', 'turning X into Y'." },
  { test: /\b(pov|when you|me |my |i |we )\b/i, pts: 0.5, good: "Personal and relatable.", fix: "Make it personal: tell it as *your* story with 'I'." },
  { test: /\b(comment|chat|viewers|followers|subscribers|vote|you decide)\b/i, pts: 1, good: "Brings the audience in.", fix: "Let viewers take part: 'comments decide', 'chat controls'." },
];

export function rate({ idea: text }) {
  const words = text.trim().split(/\s+/).length;
  let score = 2.5;
  const good = [];
  const fixes = [];
  for (const c of CHECKS) {
    if (c.test.test(` ${text} `)) {
      score += c.pts;
      good.push(c.good);
    } else fixes.push(c.fix);
  }
  if (words >= 4 && words <= 15) {
    score += 1;
    good.push("Short and easy to understand.");
  } else if (words > 25) {
    score -= 1;
    fixes.unshift("Make it shorter: one sentence someone could text a friend.");
  } else if (words < 4) fixes.unshift("Add more detail. What exactly happens?");
  score = Math.max(1, Math.min(10, Math.round(score)));

  const base = text.replace(/[.!?]+$/, "");
  const has = (i) => CHECKS[i].test.test(` ${text} `);
  // Only suggest versions that add something the idea is missing.
  const options = [
    !has(1) && `${cap(base)} in ${pick(["24 hours", "7 days", "30 days"])}`,
    !has(2) && `${cap(base)}, but ${pick(["chat decides everything", "I can only use free stuff", "every mistake costs me $10", "I can't talk the whole time"])}`,
    !has(3) && `Beginner vs pro: ${base.replace(/^(\w)(?! )/, (c) => c.toLowerCase())}`,
    !has(4) && `${cap(base)} (the ending surprised me)`,
    !has(7) && `${cap(base)}, but the comments decide what happens`,
  ].filter(Boolean);
  const upgrades = options.length ? pickMany(options, 2) : [`${cap(base)}: Part 2, but harder`];

  const bar = "🟩".repeat(score) + "⬜".repeat(10 - score);
  return {
    title: "📊 Viral potential check",
    text: [
      `> ${text}`,
      `\n**Score: ${score}/10**\n${bar}`,
      good.length ? `\n✅ **What's working**\n${good.map((g) => `• ${g}`).join("\n")}` : "",
      fixes.length ? `\n🔧 **Upgrades to try**\n${fixes.slice(0, 3).map((f) => `• ${f}`).join("\n")}` : "",
      `\n✨ **Stronger versions**\n${upgrades.map((u) => `• ${u}`).join("\n")}`,
      "\n*This score is a quick checklist, not a guarantee. Execution and the first 3 seconds matter most.*",
    ].join("\n"),
  };
}

// ---- /formats -------------------------------------------------------------

const FORMATS = {
  YouTube: [
    ["24 hour / 100 day challenge", "Do it with a friend who has the opposite skill level."],
    ["Tier list ranking", "Let viewers vote on the last spot in a community post."],
    ["Beginner vs pro", "Swap roles halfway through."],
    ["I tested viral hacks", "Only test hacks your audience sent you."],
    ["Documentary / deep dive", "Cover a small, weird niche story nobody's covered."],
    ["Cheap vs expensive", "Add a 'mystery' third option."],
    ["Recreating something famous on a budget", "Set a strict budget and show the receipt."],
  ],
  "YouTube Shorts": [
    ["Day X of… series", "End each Short by teasing tomorrow's twist."],
    ["Satisfying process", "Speed it up, but show the final 2 seconds in real time."],
    ["Did you know?", "Use a single surprising fact plus a visual proof."],
    ["Looping Short", "Make the last frame flow into the first."],
    ["Reply to a comment", "Pick the weirdest comment, not the nicest."],
    ["Rating things 1-10", "Rate things in a category no one rates."],
  ],
  TikTok: [
    ["POV skits", "Play every character yourself with quick outfit swaps."],
    ["Stitch / duet reactions", "Add something new: a fix, a test, or a rebuttal."],
    ["Storytime with gameplay background", "Tell a true story in 3 parts."],
    ["Get ready with me + topic", "Swap GRWM for 'build with me' or 'game with me'."],
    ["Trend sound remixes", "Use the sound in a niche nobody's tried it in."],
    ["Photo carousel", "Make it a mini tier list or a 'which one are you?'."],
  ],
  "Instagram Reels": [
    ["Before / after", "Hide the after behind a 'wait for it'."],
    ["Carousel tips", "End with 'save this for later'."],
    ["Aesthetic routine", "Add text on screen with one useful tip per clip."],
    ["Expectation vs reality", "Make reality wholesome instead of a fail."],
    ["Mini tutorial", "Teach one thing in under 20 seconds."],
  ],
  Twitch: [
    ["Subathon", "Add mini-games that unlock at milestones."],
    ["Chat controls the game", "Use channel points for chaos effects."],
    ["Viewer tournaments", "Give the winner a feature in your next video."],
    ["Learning a skill live", "Track progress with a public goal bar."],
    ["Co-stream with another small streamer", "Do a challenge where you swap games halfway."],
  ],
  Spotify: [
    ["Release a sped-up / slowed version", "Post the alternate version as its own single."],
    ["Theme-based singles", "Tie songs to a season, game or moment ('study night', 'final boss')."],
    ["Collab with a small artist", "Each artist promotes it to their own fans."],
    ["Snippet-first strategy", "Post 3 versions of the hook on TikTok, release the one that wins."],
    ["Mood playlists", "Curate a playlist with your song plus similar artists."],
  ],
  Roblox: [
    ["Simulator with fast progression", "Add a weird theme (e.g., sneeze simulator)."],
    ["Obby with a twist", "Each stage changes a rule or gravity."],
    ["Horror story game", "Short, replayable chapters with secret endings."],
    ["Social hangout / roleplay", "Add one mini-game that brings people together."],
    ["Tycoon", "Let players sabotage each other's tycoons."],
  ],
};

export const formatPlatforms = Object.keys(FORMATS);

export function formats({ platform }) {
  const list = pickMany(FORMATS[platform] || FORMATS.YouTube, 5);
  return {
    title: `🔁 Formats that work on ${platform}`,
    text: list.map(([f, twist], i) => `**${i + 1}. ${f}**\n↳ Twist: ${twist}`).join("\n\n"),
  };
}

// ---- /song ----------------------------------------------------------------

const SONG = {
  vibe: {
    "lo-fi": "chill, 70-90 BPM, dusty drums, soft keys",
    phonk: "dark and hard, 130-150 BPM, cowbell, heavy 808",
    drill: "gritty, 140 BPM, sliding 808s, sharp hi-hats",
    pop: "upbeat, 100-120 BPM, big catchy chorus",
    trap: "hard-hitting, 130-150 BPM, rolling hi-hats",
    "r&b": "smooth, 60-90 BPM, warm chords",
    edm: "high-energy, 125-128 BPM, build-up and drop",
    rock: "driving, 110-140 BPM, loud guitars",
    hyperpop: "chaotic, 150+ BPM, pitched vocals, glitchy",
    afrobeats: "bouncy, 100-115 BPM, groovy percussion",
  },
  titleT: ["{theme} Season", "Not Over {theme}", "{theme} (Sped Up)", "Midnight {theme}", "{theme} on Repeat", "Lost in {theme}", "Call Me {theme}", "{theme} Forever"],
  theme: ["summer", "heartbreak", "late nights", "winning", "school's out", "glow up", "lag", "Monday"],
  chorus: [
    ["Oh-oh, {theme} on my mind", "Can't shake it, every time", "Turn it up, let it ride", "{theme}, {theme} all night"],
    ["They said I'd never make it out", "Now {theme} is all they talk about", "Hands up if you feel it now", "{theme}, say it loud"],
    ["Run it back, run it back", "{theme} hitting like that", "No skip, never that", "Run it back, run it back"],
    ["I don't need nobody else", "{theme} got me by myself", "Every beat, I'm someone else", "{theme}, {theme}, tell 'em"],
  ],
  promo: [
    "Post the chorus over a trending video format and challenge people to use the sound.",
    "Make a 'which version is better?' video with 3 versions of the hook.",
    "Film a 'making this song in 10 minutes' Short and drop the final song at the end.",
    "Create a dance or hand-move for the chorus that's easy to copy.",
    "Use the song as a 'POV' sound: write 5 POV captions that fit the mood.",
  ],
  cover: [
    "Close-up of one object under neon light, blurry background",
    "Grainy film photo of an empty street at night",
    "Bold text only, on a single bright color",
    "You, from behind, looking at a sunset or city skyline",
    "Retro video-game style pixel art of the song's mood",
  ],
};

export function song({ genre, theme }) {
  const th = theme || pick(SONG.theme);
  const bank = { theme: cap(th) };
  const vibe = SONG.vibe[genre.toLowerCase()] || "pick a tempo that matches the mood; 100-130 BPM works for most hooks";
  const chorus = pick(SONG.chorus).map((l) => `*${fill(l, bank)}*`).join("\n");
  return {
    title: `🎵 Song concept: ${genre}`,
    text: [
      `**Title:** ${fill(pick(SONG.titleT), bank)}`,
      `**Vibe:** ${vibe}`,
      `\n**Chorus hook (starter lyrics, make them yours):**\n${chorus}`,
      `\n📱 **Promo angle:** ${pick(SONG.promo)}`,
      `🎨 **Cover art:** ${pick(SONG.cover)}`,
    ].join("\n"),
  };
}

// ---- /roblox --------------------------------------------------------------

const ROBLOX = {
  genres: {
    obby: { loop: ["Jump through stages that get harder", "Race other players to the top"], twist: ["the stage layout changes every round", "gravity flips randomly", "the floor turns to lava every 30 seconds"] },
    tycoon: { loop: ["Build a business, earn cash, unlock upgrades", "Collect resources and expand your base"], twist: ["players can raid each other", "the economy crashes every 10 minutes", "your tycoon is on a moving train"] },
    simulator: { loop: ["Click to collect, sell, upgrade, repeat", "Train stats and unlock new zones"], twist: ["pets fuse into weird hybrids", "you get smaller the stronger you get", "every zone has a boss you fight with the server"] },
    horror: { loop: ["Explore, solve puzzles, escape the monster", "Survive the night with friends"], twist: ["one player is secretly the monster", "the monster learns your hiding spots", "the lights go out when someone talks in chat"] },
    roleplay: { loop: ["Pick a job, earn money, decorate your home", "Live a life in a themed town"], twist: ["the town changes era every week", "players vote for a mayor who sets rules", "random disasters hit the town"] },
    survival: { loop: ["Gather, craft, survive the waves", "Last as long as possible as the map shrinks"], twist: ["the map is on the back of a giant creature", "every night a new random rule appears", "teams must trade to survive"] },
    "tower defense": { loop: ["Place towers, upgrade, stop the waves", "Team up to defend the base"], twist: ["towers are made from items players find", "enemies copy the strongest tower", "you defend a moving target"] },
  },
  adj: ["Mega", "Tiny", "Chaos", "Sky", "Neon", "Haunted", "Speed", "Lava", "Pet", "Gravity", "Secret", "Dino"],
  noun: ["Tower", "Island", "Factory", "Escape", "Kingdom", "Race", "Lab", "City", "Arena", "Mansion"],
  money: ["Cosmetic skins and trails (no pay-to-win)", "A VIP server with fun extras", "A 2x speed gamepass for grinding, not for PvP power", "Seasonal battle pass with free and paid tiers", "Pet/emote packs that are purely visual"],
  icon: ["Your avatar's shocked face + the game's main hazard in the background", "Bright, saturated scene with one giant object in the center", "Cartoon chaos: lots of avatars running from one big thing", "Before/after split: tiny base vs huge base"],
  share: ["Give players a bonus for inviting friends", "Make fails look funny on camera so players clip them", "Daily rewards and a leaderboard that resets weekly", "Secret badges people will make videos about"],
};

export function roblox({ genre }) {
  const names = Object.keys(ROBLOX.genres);
  const wanted = genre?.trim().toLowerCase();
  // A requested genre gets all 3 slots; otherwise pick 3 different genres.
  const list = wanted ? [wanted, wanted, wanted] : pickMany(names, 3);
  // Shuffle each pool once so the 3 ideas never repeat a part.
  const [adj, noun, share, money, icon] = [ROBLOX.adj, ROBLOX.noun, ROBLOX.share, ROBLOX.money, ROBLOX.icon].map((p) => pickMany(p, p.length));
  const twists = {};
  const ideas = list.map((g, i) => {
    const data = ROBLOX.genres[g] || ROBLOX.genres[pick(names)]; // unknown genre: borrow mechanics
    twists[g] ??= pickMany(data.twist, data.twist.length);
    const n = list.slice(0, i).filter((x) => x === g).length; // how many times this genre came before
    return [
      `**${adj[i]} ${noun[i]} ${cap(g)}**`,
      `🔁 **Core loop:** ${data.loop[n % data.loop.length]}, but ${twists[g][n % twists[g].length]}.`,
      `📣 **Shareable:** ${share[i % share.length]}`,
      `💰 **Monetization:** ${money[i % money.length]}`,
      `🖼️ **Icon:** ${icon[i % icon.length]}`,
    ].join("\n");
  });
  return { title: `🧱 Roblox game ideas${genre ? `: ${genre}` : ""}`, text: numbered(ideas) };
}

// ---- /tip -----------------------------------------------------------------

const TIPS = [
  "The first 3 seconds decide everything. Cut your intro and start with the most interesting moment.",
  "Post consistently on a schedule you can actually keep. 2 good videos a week beats 7 rushed ones.",
  "Reply to comments in the first hour after posting. Early engagement helps the algorithm.",
  "Turn one long video into 3-5 Shorts/TikToks. Same work, more reach.",
  "Study your best video: what made it different? Make 3 more like it.",
  "Thumbnails: one subject, one emotion, max 4 words of text.",
  "Collab with creators your size. You share audiences without needing a big name.",
  "Ask a specific question at the end ('which one would you pick?'), not just 'like and subscribe'.",
  "Don't chase every trend. Put your niche's twist on trends that fit you.",
  "Audio quality matters more than video quality. A cheap mic is the best first upgrade.",
  "Use on-screen text. Lots of people scroll with sound off.",
  "Make a series. 'Part 2' gives people a reason to follow.",
  "Check retention graphs: where people leave is where your video needs work.",
  "Your title and thumbnail should make one promise, and the video must keep it.",
  "Roblox devs: update often, and announce updates in a Discord to keep players coming back.",
  "Musicians: post the hook before the song is finished, and let the audience pick the version.",
];

export function tip() {
  return { title: "📌 Creator tip", text: pick(TIPS) };
}

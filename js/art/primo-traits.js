// Collection traits -> the fields js/art/head-back.js draws a head out of.
//
// WHY THIS EXISTS. The runner is seen from behind, so the PFP itself can never
// be shown — but the head still has to be recognisably YOUR Primo, and until
// now it was not: js/art/primo-head.js sampled colours off the art and then
// hard-coded `hairStyle: 'messy'` with `cap` set to the same colour as the
// hair. Every one of the 3,069 came out as the same messy head in a slightly
// different shade, so a mariachi hat rendered as a grey baseball cap.
//
// Colour is the one thing pixels are good for. STRUCTURE — a wide brim, a
// mullet, a bandana knot, hoops — cannot be read off a crown sample, and does
// not need to be: every token's metadata states it, and the harvester now keeps
// it. So sampling still owns the palette and this owns the shape.
//
// Anything not in these tables falls through to a sensible default rather than
// disappearing, because the tables are written from a 3,069-token vocabulary
// that the collection's owner can extend at any time.

// Hair colour names, as the collection spells them. Values are picked to read
// at 40px against a sunset, not to match the PFP exactly — head-back.js
// value-normalises whatever it gets anyway (see normHair there).
const HAIR_COLOR = {
  black: '#221a1e',
  brown: '#4a2c1b',
  blonde: '#d9a441',
  blue: '#2f4fb8',
  'light blue': '#63b6e8',
  green: '#2f8f4f',
  mint: '#7fd8b8',
  pink: '#ef77b4',
  purple: '#6b3fa8',
  white: '#e8e2dc',
  dior: '#6d5a48',
};

// The six hair silhouettes. `long` and `pony` were already understood by
// head-back.js; the rest are new and are what stop six different cuts reading
// as one.
const HAIR_STYLE = {
  messy: 'messy',
  casual: 'casual',
  short: 'short',
  long: 'long',
  bushy: 'bushy',
  mullet: 'mullet',
};

/**
 * Headwear, by silhouette class rather than by name — from behind, a cowboy hat
 * and a mariachi hat are the same read (a brim wider than the skull) and a
 * RIPDEV cap and a Primos cap are the same read (a dome with a nape strap).
 *
 * `kind` is what head-back.js switches on. `color` is the crown.
 */
const HATS = {
  'Primos':              { kind: 'cap',    color: '#141019' },
  'RIPDEV':              { kind: 'cap',    color: '#20242c' },
  'Snake Skin':          { kind: 'cap',    color: '#8a7a46' },
  'Love Gun':            { kind: 'cap',    color: '#b8324f' },
  'Poker Visor':         { kind: 'visor',  color: '#1f6b4a' },
  'Construction Helmet': { kind: 'helmet', color: '#f0a81e' },
  'Cowboy Hat':          { kind: 'brim',   color: '#6d4a2c' },
  'Mariachi Hat':        { kind: 'brim',   color: '#171219' },
  'Black Bandana':       { kind: 'durag',  color: '#17141c' },
  'Horns':               { kind: 'horns',  color: '#8c2f2f' },
};

const BANDANA = {
  'Blue Bandana': '#3552c4',
  'Red Bandana': '#c0342f',
};

// Every pair of glasses reduces to the colour of the temple arm hooking over
// the ear, because that is the only part of a pair of glasses visible from
// behind. Reading glasses are wire, locs are black plastic, blues are gold.
const GLASSES = {
  'Gold Blues': '#e8b53c',
  'Locs Slim': '#15121a',
  'Mogs': '#15121a',
  'ODB': '#2b2440',
  'Round Shades': '#1d1a22',
  'Sunglasses': '#1d1a22',
  'Reading Glasses': '#c9c3bb',
  'Round Reading': '#c9c3bb',
};

const EARRING = {
  'Gold Hoop': '#e8b53c',
  'Gold Stud': '#e8b53c',
  'Cross': '#e8b53c',
  'Silver Stud': '#cfd4dc',
  'Diamond': '#bfe9ff',
  'Double Diamond': '#bfe9ff',
  'Diamond And Heart': '#bfe9ff',
  'Heart': '#e0518b',
};

// Skin. `Demon` and `Alien` are not humans with a tan — a Primo whose base is
// Demon is RED, and sampling occasionally lands on a cheek shadow and reports
// something plausible-but-brown instead. The trait is authoritative.
const BASE_SKIN = {
  'Tan': '#c98f5e',
  'Oak': '#b9784e',
  'Brown': '#9c6238',
  'Dark Brown': '#6f4326',
  'Demon': '#b8413c',
  'Alien': '#6fa86a',
};

/** "Mullet Brown" -> { style: 'mullet', color: '#4a2c1b' } */
function readHair(value) {
  if (!value) return null;
  const parts = String(value).trim().split(/\s+/);
  const style = HAIR_STYLE[parts[0].toLowerCase()];
  // The colour is everything after the style word, so "Messy Light Blue"
  // resolves as "light blue" rather than as "light".
  const color = HAIR_COLOR[parts.slice(1).join(' ').toLowerCase()];
  if (!style && !color) return null;
  return { style: style || 'messy', color: color || null };
}

/**
 * Merge a token's traits over a rig built by sampling its art.
 *
 * Sampled colours WIN for anything the traits do not name, and the traits win
 * for structure — so a Primo whose crown sample came out a good match keeps it,
 * and one whose sample landed on a photographic background gets the trait's
 * colour instead of a shop shelf.
 *
 * @param {object} rig     the sampled rig ({ hair, cap, skin, shirt, … })
 * @param {object|null} traits from primo-picker's traitsFor()
 * @returns {object} a new rig — the input is not mutated
 */
export function applyTraits(rig, traits) {
  if (!traits) return rig;
  const out = { ...rig };

  const hair = readHair(traits.hair);
  if (hair) {
    out.hairStyle = hair.style;
    // Only override the sampled hair when the collection names a colour the
    // sampler could not have got right — a blue-haired Primo sampled off a blue
    // sky is the case this exists for.
    if (hair.color) out.hair = hair.color;
  }

  const hat = HATS[traits.hat];
  if (hat) {
    out.hatKind = hat.kind;
    out.cap = hat.color;
    // `beanie` was head-back.js's only way to say "this comes further down the
    // skull". A do-rag does; nothing else here does.
    out.beanie = hat.kind === 'durag' ? hat.color : null;
  } else {
    // No hat is a REAL answer now, not an absence of data. head-back.js used to
    // put a cap on every short-haired Primo because it could not tell the
    // difference; it can now, and a bare head is drawn bare.
    out.hatKind = 'none';
    out.cap = null;
  }

  if (traits.bandana) out.bandana = BANDANA[traits.bandana] || '#c0342f';
  if (traits.glasses) out.shades = GLASSES[traits.glasses] || '#15121a';
  if (traits.earring) out.hoops = EARRING[traits.earring] || '#e8b53c';
  if (traits.base && BASE_SKIN[traits.base]) {
    out.skin = BASE_SKIN[traits.base];
    out.skinDark = shade(BASE_SKIN[traits.base], 0.78);
  }
  return out;
}

/** #rrggbb scaled toward black. Local so this file pulls in nothing. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

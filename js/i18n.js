// Every word the game says, in one table.
//
// VOICE. This is the community writing for itself, so Spanish is the default
// register in BOTH languages — "English mode" is Spanish copy with English
// connective tissue, not the other way round. The tone is dry and a little
// exasperated: the callejón has seen all of this before. The jokes are
// understatement, never exclamation marks, and the cultural references are
// played completely straight — la vecina's laundry, la chancla, "claro, la
// migra". If you know, you know, and that IS the joke. Nothing here explains
// itself, glosses itself, or winks at the reader.
//
// The sarcasm is aimed at the situation — the checkpoints, the chase, the
// alley — and never at people.
//
// Rows that read the same on both sides are deliberate, not missing
// translations: that is the shared vocabulary the game is written in. Where a
// line can only land in one language, Spanish gets the joke and English gets
// the plainer read.
//
// Hot path: t() is called from drawHUD and drawTutorial on EVERY frame. It is
// therefore one property read against a pre-flattened pack — no string
// building, no template literals, no Intl, no allocation. The `{en, es}` shape
// below is for humans; the packs the lookup actually hits are built once at
// module load.

export const LANGS = ['en', 'es'];

const STR = {
  // ----------------------------------------------------------------- menu
  'menu.tagline':     { en: 'Los Ángeles · 3 carriles · sin frenos',
                        es: 'Los Ángeles · 3 carriles · sin frenos' },
  'menu.play':        { en: 'CORRE', es: 'CORRE' },
  'menu.fine':        { en: 'Unofficial fan project, not affiliated with the Primos collection. '
                          + 'No collection artwork is stored here — images load from public IPFS at your request.',
                        es: 'Proyecto de fans, no oficial ni afiliado a la colección Primos. '
                          + 'Aquí no se guarda nada del arte — las imágenes se cargan desde IPFS público cuando tú lo pides.' },

  'stat.best':        { en: 'RÉCORD',   es: 'RÉCORD' },
  'stat.chelas':      { en: 'CHELAS',   es: 'CHELAS' },
  'stat.runs':        { en: 'CORRIDAS', es: 'CORRIDAS' },

  // ---------------------------------------------------------- how to run
  'how.title':        { en: 'Cómo se corre', es: 'Cómo se corre' },
  'how.lane.k':       { en: 'Desliza ← →', es: 'Desliza ← →' },
  'how.lane.v':       { en: '/ arrows — cambia de carril', es: '/ flechas — cambia de carril' },
  'how.jump.k':       { en: 'Desliza ↑', es: 'Desliza ↑' },
  'how.jump.v':       { en: '/ space — brinca los botes', es: '/ espacio — brinca los botes' },
  'how.slide.k':      { en: 'Desliza ↓', es: 'Desliza ↓' },
  'how.slide.v':      { en: '/ down — agáchate bajo la ropa de la vecina',
                        es: '/ abajo — agáchate bajo la ropa de la vecina' },
  'how.wall.k':       { en: 'Retenes y el muro', es: 'Retenes y el muro' },
  'how.wall.v':       { en: 'no se saltan. Never have. Dales la vuelta.',
                        es: 'no se saltan. Nunca. Dales la vuelta.' },
  'how.taco.k':       { en: 'Los tacos', es: 'Los tacos' },
  'how.taco.v':       { en: 'son gasolina. Run out and la patrulla eats you.',
                        es: 'son gasolina. Sin gas, te alcanza la patrulla.' },

  // -------------------------------------------------------- primo loader
  'primo.title':      { en: 'Corre como un Primo de verdad', es: 'Corre como un Primo de verdad' },
  'primo.hintNum':    { en: 'Type a number from the collection — the art loads live from IPFS.',
                        es: 'Escribe un número de la colección — el arte se carga en vivo desde IPFS.' },
  'primo.numPh':      { en: 'Primo #', es: 'Primo #' },
  'primo.load':       { en: 'CARGAR', es: 'CARGAR' },
  'primo.random':     { en: 'SORPRÉNDEME', es: 'SORPRÉNDEME' },
  'primo.hintUrl':    { en: '¿Eres holder? Use your own — right-click your Primo on Magic Eden, copy the image address, paste it here.',
                        es: '¿Eres holder? Usa el tuyo — clic derecho en tu Primo en Magic Eden, copia la dirección de la imagen y pégala aquí.' },
  'primo.urlPh':      { en: 'Paste an image URL', es: 'Pega un URL de imagen' },
  'primo.file':       { en: 'Or choose a file', es: 'O escoge un archivo' },
  'primo.clear':      { en: 'BORRAR', es: 'BORRAR' },

  // Status line under the loader. %s / %n / %h are filled at the call site —
  // t() itself never builds a string.
  'status.loading':   { en: 'Loading %s…', es: 'Cargando %s…' },
  'status.ready':     { en: '%s is ready to run.', es: '%s ya está listo para correr.' },
  'status.badImage':  { en: "Couldn't load that image. Use a direct .png/.jpg link, or pick a file.",
                        es: 'No se pudo cargar esa imagen. Usa un enlace directo .png/.jpg, o escoge un archivo.' },
  'status.badFile':   { en: "Couldn't read that file.", es: 'No se pudo leer ese archivo.' },
  'status.notIndexed':{ en: "Primo #%n isn't in the offline index (%h of 3,069 are). Paste its image URL below and it will work.",
                        es: 'El Primo #%n no está en el índice sin conexión (%h de 3,069 sí están). Pega el URL de su imagen aquí abajo y va a jalar.' },
  'status.noIndex':   { en: 'Index unavailable.', es: 'Índice no disponible.' },
  'status.cleared':   { en: 'Primo borrado.', es: 'Primo borrado.' },
  'label.yourPrimo':  { en: 'Your Primo', es: 'Tu Primo' },
  'label.primoNum':   { en: 'Primo #', es: 'Primo #' },

  // ----------------------------------------------------------- crew picker
  'crew.primoNum':    { en: 'PRIMO #', es: 'PRIMO #' },
  'crew.tileMi':      { en: 'MI', es: 'MI' },
  'crew.tilePrimo':   { en: 'PRIMO', es: 'PRIMO' },
  'crew.tag.load':    { en: 'Load one from the collection below',
                        es: 'Carga uno de la colección aquí abajo' },
  'crew.tag.barrio':  { en: 'Directo del barrio', es: 'Directo del barrio' },
  'crew.tag.collection': { en: 'Directo de la colección', es: 'Directo de la colección' },
  'crew.tag.chuy':    { en: 'Pendleton azul · Blues doradas', es: 'Pendleton azul · Blues doradas' },
  'crew.tag.lupe':    { en: 'Rojo Base · Paliacate negro', es: 'Rojo Base · Paliacate negro' },
  'crew.tag.rosa':    { en: 'Colita · Arracadas · Franela rosa', es: 'Colita · Arracadas · Franela rosa' },
  'crew.tag.beto':    { en: 'Bigote · Gorro · Cuadros grises', es: 'Bigote · Gorro · Cuadros grises' },

  // ---------------------------------------------------------------- pause
  'pause.title':      { en: 'EN PAUSA', es: 'EN PAUSA' },
  'pause.resume':     { en: 'SIGUE', es: 'SIGUE' },
  'pause.soundOn':    { en: 'SONIDO: SÍ', es: 'SONIDO: SÍ' },
  'pause.soundOff':   { en: 'SONIDO: NO', es: 'SONIDO: NO' },
  'pause.quit':       { en: 'SALIR AL MENÚ', es: 'SALIR AL MENÚ' },

  // ------------------------------------------------------------ game over
  // The one line the whole run ends on. Deadpan is the entire point: nobody in
  // this alley is surprised about who it was.
  'over.reason.migra':{ en: 'OF COURSE. LA MIGRA.', es: 'CLARO. LA MIGRA.' },
  'over.scoreLabel':  { en: 'PUNTOS', es: 'PUNTOS' },
  'over.pb':          { en: '¡ÓRALE, RÉCORD!', es: '¡ÓRALE, RÉCORD!' },
  'over.chelas':      { en: 'CHELAS', es: 'CHELAS' },
  'over.tacos':       { en: 'TACOS', es: 'TACOS' },
  'over.meters':      { en: 'METROS', es: 'METROS' },
  'over.again':       { en: 'OTRA VEZ', es: 'OTRA VEZ' },
  'over.menu':        { en: 'MENÚ', es: 'MENÚ' },

  // ------------------------------------------------------------------ HUD
  'hud.migra':        { en: 'LA MIGRA', es: 'LA MIGRA' },
  'hud.sinGas':       { en: 'SIN GAS', es: 'SIN GAS' },
  // Power pills. Short on purpose — the pill shrinks a long label rather than
  // wrap it, and a shrunk label is an unreadable one.
  'power.magnet':     { en: 'IMÁN PIÑATA', es: 'IMÁN PIÑATA' },
  'power.chancla':    { en: 'CHANCLAZO', es: 'CHANCLAZO' },
  'power.lowrider':   { en: 'LOWRIDER', es: 'LOWRIDER' },
  'toast.taco':       { en: '¡TACO! +GASOLINA', es: '¡TACO! +GASOLINA' },
  'toast.lowriderDown': { en: 'ADIÓS, LOWRIDER', es: 'ADIÓS, LOWRIDER' },

  // ---------------------------------------------------------------- intro
  'intro.tail':       { en: 'LA MIGRA. QUÉ SORPRESA.', es: 'LA MIGRA. QUÉ SORPRESA.' },
  'intro.primo':      { en: 'PRIMO', es: 'PRIMO' },

  // ------------------------------------------------- tutorial: the course
  'tut.welcome.tag':  { en: 'CORRUPT TE ENSEÑA', es: 'CORRUPT TE ENSEÑA' },
  'tut.welcome.title':{ en: 'ESCUELA DEL CALLEJÓN', es: 'ESCUELA DEL CALLEJÓN' },
  'tut.welcome.body': { en: 'Soy Corrupt. Tres carriles, cero frenos, y atrás La Migra. Shocking, I know. '
                          + 'Give me treinta segundos and the callejón stops killing you for free.',
                        es: 'Soy Corrupt. Tres carriles, cero frenos, y atrás La Migra. Sorpresa. '
                          + 'Dame treinta segundos y el callejón deja de matarte de gratis.' },
  'tut.welcome.cue':  { en: 'TAP PARA EMPEZAR', es: 'TAP PARA EMPEZAR' },

  'tut.lane.tag':     { en: 'PASO 1', es: 'PASO 1' },
  'tut.lane.title':   { en: 'CAMBIA DE CARRIL', es: 'CAMBIA DE CARRIL' },
  'tut.lane.body':    { en: 'Izquierda, centro, derecha. Swipe sideways. This one move answers most of '
                          + 'what the callejón throws at you, so learn it now.',
                        es: 'Izquierda, centro, derecha. Deslízate de lado. Este movimiento resuelve casi '
                          + 'todo lo que te avienta el callejón, así que apréndetelo ya.' },
  'tut.lane.keys':    { en: 'FLECHAS  ·  A  D', es: 'FLECHAS  ·  A  D' },

  'tut.jump.tag':     { en: 'PASO 2', es: 'PASO 2' },
  'tut.jump.title':   { en: 'SALTA LA BASURA', es: 'SALTA LA BASURA' },
  'tut.jump.body':    { en: 'Botes, cajas, conos — all of it fits under your jump. Swipe up. '
                          + 'Nobody is moving that dumpster for you.',
                        es: 'Botes, cajas, conos — todo eso cabe debajo de tu salto. Deslízate hacia arriba. '
                          + 'Nadie va a mover ese bote por ti.' },
  'tut.jump.keys':    { en: 'ESPACIO  ·  ARRIBA  ·  TAP', es: 'ESPACIO  ·  ARRIBA  ·  TAP' },

  'tut.slide.tag':    { en: 'PASO 3', es: 'PASO 3' },
  'tut.slide.title':  { en: 'AGÁCHATE', es: 'AGÁCHATE' },
  'tut.slide.body':   { en: 'Tendederos and taquería toldos hang right at head height. Swipe down. '
                          + 'And no, la vecina is not taking her laundry in for you.',
                        es: 'Los tendederos y los toldos de la taquería cuelgan justo a la altura de tu cabeza. '
                          + 'Deslízate hacia abajo. Y no, la vecina no va a meter su ropa por ti.' },
  'tut.slide.keys':   { en: 'ABAJO  ·  S', es: 'ABAJO  ·  S' },

  'tut.wall.tag':     { en: '¡AGUAS!', es: '¡AGUAS!' },
  'tut.wall.title':   { en: 'ESTO NO SE SALTA', es: 'ESTO NO SE SALTA' },
  'tut.wall.body':    { en: 'Retenes, el muro, la patrulla. Taller than your jump. Always have been. '
                          + 'Jumping one is a hit, every single time — dales la vuelta.',
                        es: 'Retenes, el muro, la patrulla. Más altos que tu salto. Siempre lo han sido. '
                          + 'Saltarlos es golpe seguro, cada vez — dales la vuelta.' },

  'tut.loot.tag':     { en: 'PASO 4', es: 'PASO 4' },
  'tut.loot.title':   { en: 'LA CALLE PROVEE', es: 'LA CALLE PROVEE' },
  'tut.loot.body':    { en: 'Chelas are points and they build your combo. Los tacos son gasolina. '
                          + 'The rest are poderes. Take everything — you are not coming back for it.',
                        es: 'Las chelas son puntos y te suben el combo. Los tacos son gasolina. '
                          + 'Lo demás son poderes. Agárrate todo — no vas a regresar por ello.' },

  'tut.migra.tag':    { en: 'PASO 5', es: 'PASO 5' },
  'tut.migra.title':  { en: 'NO TE DEJES AGARRAR', es: 'NO TE DEJES AGARRAR' },
  'tut.migra.body':   { en: 'Every hit feeds LA MIGRA. Your gasolina drains the whole run, and on empty '
                          + 'the meter fills itself — qué conveniente. Only tacos refill it.',
                        es: 'Cada golpe le sube a LA MIGRA. La gasolina se te va toda la corrida, y en ceros '
                          + 'el medidor se llena solito — qué conveniente. Solo los tacos la recargan.' },

  'tut.go.title':     { en: '¡ÓRALE!', es: '¡ÓRALE!' },
  'tut.go.body':      { en: 'YA SABES. CORRE.', es: 'YA SABES. CORRE.' },

  'tut.cue.next':     { en: 'TAP PARA SEGUIR', es: 'TAP PARA SEGUIR' },
  'tut.cue.up':       { en: 'DESLIZA  ↑', es: 'DESLIZA  ↑' },
  'tut.cue.down':     { en: 'DESLIZA  ↓', es: 'DESLIZA  ↓' },
  'tut.cue.both':     { en: 'DESLIZA  ←   O   →', es: 'DESLIZA  ←   O   →' },
  'tut.cue.left':     { en: 'DESLIZA  ←', es: 'DESLIZA  ←' },
  'tut.cue.right':    { en: 'DESLIZA  →', es: 'DESLIZA  →' },
  'tut.cue.done':     { en: '¡ESO!', es: '¡ESO!' },
  'tut.cue.skipStep': { en: 'TAP PARA SALTAR ESTE PASO', es: 'TAP PARA SALTAR ESTE PASO' },
  'tut.skip':         { en: 'SALTAR ENTRENAMIENTO', es: 'SALTAR ENTRENAMIENTO' },

  'tut.guide.jump':   { en: 'TU SALTO', es: 'TU SALTO' },
  'tut.guide.stand':  { en: 'DE PIE', es: 'DE PIE' },
  'tut.guide.crouch': { en: 'AGACHADO', es: 'AGACHADO' },

  'tut.meter.migra':  { en: 'LA MIGRA', es: 'LA MIGRA' },
  'tut.meter.hit':    { en: 'CADA GOLPE LA SUBE.', es: 'CADA GOLPE LA SUBE.' },
  'tut.meter.full':   { en: 'LLENA = TE AGARRARON', es: 'LLENA = TE AGARRARON' },
  'tut.meter.gas':    { en: 'GAS', es: 'GAS' },

  // Tile names and their verdict chips — the alley's own vocabulary, identical
  // on both sides by design, same as the step titles above.
  'tut.tile.beer':        { en: 'CHELA', es: 'CHELA' },
  'tut.tile.beer.n':      { en: '+10 · COMBO', es: '+10 · COMBO' },
  'tut.tile.taco':        { en: 'TACO', es: 'TACO' },
  'tut.tile.taco.n':      { en: '+GASOLINA', es: '+GASOLINA' },
  'tut.tile.magnet':      { en: 'PIÑATA', es: 'PIÑATA' },
  'tut.tile.magnet.n':    { en: 'IMÁN', es: 'IMÁN' },
  'tut.tile.chancla':     { en: 'CHANCLA', es: 'CHANCLA' },
  'tut.tile.chancla.n':   { en: 'ROMPE TODO', es: 'ROMPE TODO' },
  'tut.tile.lowrider':    { en: 'LOWRIDER', es: 'LOWRIDER' },
  'tut.tile.lowrider.n':  { en: 'AGUANTA 1', es: 'AGUANTA 1' },
  'tut.tile.dumpster':    { en: 'DUMPSTER', es: 'DUMPSTER' },
  'tut.tile.crates':      { en: 'CAJAS', es: 'CAJAS' },
  'tut.tile.cones':       { en: 'CONOS', es: 'CONOS' },
  'tut.tile.jump.n':      { en: 'SALTA', es: 'SALTA' },
  'tut.tile.clothesline': { en: 'TENDEDERO', es: 'TENDEDERO' },
  'tut.tile.awning':      { en: 'TOLDO', es: 'TOLDO' },
  'tut.tile.duck.n':      { en: 'AGÁCHATE', es: 'AGÁCHATE' },
  'tut.tile.checkpoint':  { en: 'RETÉN', es: 'RETÉN' },
  'tut.tile.border':      { en: 'EL MURO', es: 'EL MURO' },
  'tut.tile.copcar':      { en: 'LA PATRULLA', es: 'LA PATRULLA' },
  'tut.tile.no.n':        { en: 'NO SE SALTA', es: 'NO SE SALTA' },
};

/**
 * game.js is read-only from here, so the handful of literals it hands out
 * (toast text, the game-over reason) are translated on the way to the screen
 * instead. Anything not listed passes through untouched.
 */
const FROM_GAME = {
  'CAUGHT BY LA MIGRA': 'over.reason.migra',
  '¡TACO! +STAMINA': 'toast.taco',
  'LOWRIDER TOTALED': 'toast.lowriderDown',
  'PIÑATA MAGNET': 'power.magnet',
  'CHANCLA RUSH': 'power.chancla',
  LOWRIDER: 'power.lowrider',
};

// --------------------------------------------------------------- the packs

// Flattened once, so the per-frame lookup is a single hash read on a plain
// object rather than two reads plus a branch through the `{en, es}` shape.
const PACKS = { en: Object.create(null), es: Object.create(null) };
for (const key in STR) {
  PACKS.en[key] = STR[key].en;
  PACKS.es[key] = STR[key].es;
}

let lang = 'en';
let active = PACKS.en;
const listeners = [];

/**
 * Look up a string. Hot path — keep it this dumb.
 * A key with no Spanish falls back to English; a key that does not exist at
 * all returns the key itself, so a typo shows up as a visible key on screen
 * and never as the word "undefined".
 */
export function t(key) {
  const v = active[key];
  if (v !== undefined) return v;
  const e = PACKS.en[key];
  return e !== undefined ? e : (key || '');
}

/** Translate a literal that came out of the read-only simulation layer. */
export function tRaw(str) {
  const key = FROM_GAME[str];
  return key ? t(key) : (str || '');
}

export function getLang() {
  return lang;
}

/**
 * Best guess for a first-time player. Honours the ORDER of the browser's
 * preference list, so a device that lists Spanish above English opens in
 * Spanish and one that lists it below does not.
 */
export function detectLang() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav) return 'en';
  const list = (nav.languages && nav.languages.length) ? nav.languages : [nav.language];
  for (let i = 0; i < list.length; i++) {
    const tag = list[i];
    if (typeof tag !== 'string' || !tag) continue;
    const two = tag.slice(0, 2).toLowerCase();
    if (two === 'es') return 'es';
    if (two === 'en') return 'en';
  }
  return 'en';
}

/**
 * Boot-time pick. An explicit saved choice wins forever; anything else (first
 * run, or a save written before this shipped) falls back to the device.
 * Silent — the caller paints the UI once itself rather than through a listener.
 */
export function initLang(saved) {
  lang = PACKS[saved] ? saved : detectLang();
  active = PACKS[lang];
  return lang;
}

/** Switch language and notify. No-op when already there. */
export function setLang(code) {
  const next = PACKS[code] ? code : 'en';
  if (next === lang) return lang;
  lang = next;
  active = PACKS[next];
  for (let i = 0; i < listeners.length; i++) listeners[i](lang);
  return lang;
}

/** @returns {() => void} unsubscribe */
export function onLangChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

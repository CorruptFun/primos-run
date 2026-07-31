// Every word the game says, in one table.
//
// VOICE. `es` is Spanish, all of it, always. The whole policy is about `en`.
//
// `en` IS FULL ENGLISH. Not Spanglish, not English with a seasoning of Spanish
// — English sentences, all the way down. A player who picked ENGLISH and gets
// Spanish back thinks the toggle is broken, and they are right.
//
// This rule has now been narrowed three times and it is settled. The old
// "protected vocabulary" list — taco, barrio, ¡órale!, CORRE on the play
// button — IS RETRACTED. Do not reinstate it, and do not read an older comment
// or an older commit as policy: a previous edit documented a retracted rule as
// if it were current and the next session put the Spanish straight back.
//
//   THE ONLY THINGS THAT STAY, and this is the whole list — PROPER NOUNS.
//   Names of things, never vocabulary:
//     · Primos — the collection and the brand
//     · Primos: Barrio Run — the game's own title, where it IS the title
//     · Corrupt — he is a person
//     · any Primo's name or number — PRIMO #1701, CHUY, TÍO BETO
//     · Pendleton, Rojo Base — a brand and the collection's own name for a
//       colourway, sitting in the same slot as each other. Names, not words.
//
//   "taco" / "tacos" is an English word and stays ONLY where it names the food
//   — the pickup, the shop, the tile, the tally. Where a Spanish word was
//   doing flavour work inside a sentence, plain English wins.
//
//   ALREADY TRANSLATED, all of it, permanently: chela → beer · gasolina →
//   fuel · el callejón → the alley · la vecina → the neighbour · retenes →
//   checkpoints · el muro → the wall · la patrulla → the cruiser · la tiendita
//   → the corner store · piñata / chancla → what the power-up DOES · bigote →
//   moustache · paliacate → bandana · taquería → taco shop · CORRE → RUN ·
//   ¡órale! → an English exclamation.
//
//   THE ANTAGONIST IS NAMED IN THE READER'S LANGUAGE. `en` says ICE, `es` says
//   LA MIGRA — which is the Spanish name for the same agency, so nothing is
//   lost either way. This is the one thing that must land plainly rather than
//   as a term the reader might not parse, because it is what is being
//   satirised. (The cruiser already wears ICE on its door — see intro.js.)
//
// FULL ENGLISH IS NOT NEUTRAL ENGLISH, and this is the half that gets lost.
// The register is deadpan, sarcastic, politically pointed satire about
// immigration enforcement, and it is identical on both sides. `over.reason
// .migra` — "OF COURSE. ICE." — is the whole voice in three words: dry,
// unsurprised, played completely straight, because the alley has seen all of
// this before. Every other `en` line is measured against it. Translating the
// vocabulary must not sand any of that off; an `en` row that reads corporate,
// cheerful or softened is wrong in a different direction, and just as wrong.
//
// The sarcasm is aimed at the situation — the checkpoints, the chase, the
// alley — and never at people.
//
// Rows that read the same on both sides are the proper nouns above, or words
// English and Spanish genuinely share. They are not missing translations.
//
// Hot path: t() is called from drawHUD and drawTutorial on EVERY frame. It is
// therefore one property read against a pre-flattened pack — no string
// building, no template literals, no Intl, no allocation. The `{en, es}` shape
// below is for humans; the packs the lookup actually hits are built once at
// module load.

export const LANGS = ['en', 'es'];

const STR = {
  // ----------------------------------------------------------------- menu
  // The city is a proper noun either way; the ACCENT is the Spanish spelling of
  // it, so `en` uses the English one.
  'menu.tagline':     { en: 'Los Angeles · 3 lanes · no brakes',
                        es: 'Los Ángeles · 3 carriles · sin frenos' },
  // The play button. It sits directly under the wordmark and used to be kept
  // as CORRE on the grounds that it read as a brand word rather than a verb.
  // It does not — it reads as Spanish on the single most-pressed control in
  // the game, which is the worst possible place for it. It is a verb, so `en`
  // says the verb.
  'menu.play':        { en: 'RUN', es: 'CORRE' },
  // The one line the game speaks as itself rather than in character, so it is
  // played completely straight — no deadpan, no joke. Sentence two is a
  // technical commitment the repo actually keeps (the index holds IPFS CIDs
  // only; the pixels are fetched client-side at the player's request) and
  // stands whatever the affiliation says.
  'menu.fine':        { en: 'An official Primos project. '
                          + 'No collection artwork is stored here — images load from public IPFS at your request.',
                        es: 'Un proyecto oficial de Primos. '
                          + 'Aquí no se guarda nada del arte — las imágenes se cargan desde IPFS público cuando tú lo pides.' },

  'stat.best':        { en: 'BEST',  es: 'RÉCORD' },
  'stat.chelas':      { en: 'BEERS', es: 'CHELAS' },
  'stat.runs':        { en: 'RUNS',  es: 'CORRIDAS' },

  // ---------------------------------------------------------- how to run
  // Each row is drawn as `<b>k</b> <span>v</span>`, so k and v have to read as
  // one sentence across the gap in whichever language is up.
  'how.title':        { en: 'How to run', es: 'Cómo se corre' },
  'how.lane.k':       { en: 'Swipe ← →', es: 'Desliza ← →' },
  'how.lane.v':       { en: '/ arrows — change lanes', es: '/ flechas — cambia de carril' },
  'how.jump.k':       { en: 'Swipe ↑', es: 'Desliza ↑' },
  'how.jump.v':       { en: '/ space — jump the trash', es: '/ espacio — brinca los botes' },
  'how.slide.k':      { en: 'Swipe ↓', es: 'Desliza ↓' },
  'how.slide.v':      { en: "/ down — duck under the neighbour's laundry",
                        es: '/ abajo — agáchate bajo la ropa de la vecina' },
  'how.wall.k':       { en: 'Checkpoints and the wall', es: 'Retenes y el muro' },
  'how.wall.v':       { en: "can't be jumped. Never could. Go around.",
                        es: 'no se saltan. Nunca. Dales la vuelta.' },
  'how.taco.k':       { en: 'Tacos', es: 'Los tacos' },
  'how.taco.v':       { en: 'are fuel. Run out and ICE takes you.',
                        es: 'son gasolina. Sin gas, te alcanza la patrulla.' },

  // -------------------------------------------------------- primo loader
  'primo.title':      { en: 'Run as a real Primo', es: 'Corre como un Primo de verdad' },
  'primo.hintNum':    { en: 'Type a number from the collection — the art loads live from IPFS.',
                        es: 'Escribe un número de la colección — el arte se carga en vivo desde IPFS.' },
  'primo.numPh':      { en: 'Primo #', es: 'Primo #' },
  'primo.load':       { en: 'LOAD', es: 'CARGAR' },
  'primo.random':     { en: 'SURPRISE ME', es: 'SORPRÉNDEME' },
  'primo.hintUrl':    { en: 'Holder? Use your own — right-click your Primo on Magic Eden, copy the image address, paste it here.',
                        es: '¿Eres holder? Usa el tuyo — clic derecho en tu Primo en Magic Eden, copia la dirección de la imagen y pégala aquí.' },
  'primo.urlPh':      { en: 'Paste an image URL', es: 'Pega un URL de imagen' },
  'primo.file':       { en: 'Or choose a file', es: 'O escoge un archivo' },
  'primo.clear':      { en: 'CLEAR', es: 'BORRAR' },

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
  'status.cleared':   { en: 'Primo cleared.', es: 'Primo borrado.' },
  'label.yourPrimo':  { en: 'Your Primo', es: 'Tu Primo' },
  'label.primoNum':   { en: 'Primo #', es: 'Primo #' },

  // ----------------------------------------------------------- crew picker
  'crew.primoNum':    { en: 'PRIMO #', es: 'PRIMO #' },
  // Two lines stacked on the empty custom tile: "MY / PRIMO", "MI / PRIMO".
  'crew.tileMi':      { en: 'MY', es: 'MI' },
  'crew.tilePrimo':   { en: 'PRIMO', es: 'PRIMO' },
  // The same slot's name under the tiles. runner.js hardcodes 'MI PRIMO' as
  // CUSTOM_TEMPLATE.name and is read-only from here, so main.js substitutes
  // this instead — otherwise the tile face says MY PRIMO and the label under
  // it says MI PRIMO in the same breath.
  'crew.customName':  { en: 'MY PRIMO', es: 'MI PRIMO' },
  'crew.tag.load':    { en: 'Load one from the collection below',
                        es: 'Carga uno de la colección aquí abajo' },
  'crew.tag.barrio':  { en: 'Straight off the block', es: 'Directo del barrio' },
  'crew.tag.collection': { en: 'Straight from the collection', es: 'Directo de la colección' },
  // Outfits, named in whichever language is up. Pendleton and Rojo Base stay
  // as they are in both: one is a brand, the other is the collection's own
  // name for a colourway, and neither is a Spanish word being kept for
  // flavour — they are the proper nouns the full-English rule exempts. The
  // words around them are not: `bigote` and `rosa` are vocabulary and are
  // translated here even though runner.js's own taglines keep them.
  'crew.tag.chuy':    { en: 'Blue Pendleton · Gold blues', es: 'Pendleton azul · Blues doradas' },
  'crew.tag.lupe':    { en: 'Rojo Base · Black bandana', es: 'Rojo Base · Paliacate negro' },
  'crew.tag.rosa':    { en: 'Ponytail · Hoops · Pink flannel', es: 'Colita · Arracadas · Franela rosa' },
  'crew.tag.beto':    { en: 'Moustache · Beanie · Grey plaid', es: 'Bigote · Gorro · Cuadros grises' },

  // ---------------------------------------------------------------- pause
  'pause.title':      { en: 'PAUSED', es: 'EN PAUSA' },
  'pause.resume':     { en: 'KEEP GOING', es: 'SIGUE' },
  'pause.soundOn':    { en: 'SOUND: ON', es: 'SONIDO: SÍ' },
  'pause.soundOff':   { en: 'SOUND: OFF', es: 'SONIDO: NO' },
  'pause.quit':       { en: 'QUIT TO MENU', es: 'SALIR AL MENÚ' },

  // ----------------------------------------------------------------- help
  // The menu's `how` list is only reachable from the menu, which is no use to
  // the player who is already dead and does not know why. This is the same
  // material, reachable mid-run from pause and again from the game over sheet,
  // with the rule that actually kills new players pulled out of the list and
  // given its own box — buried in a bullet it was read as trivia.
  //
  // Rows are drawn `<b>k</b> <span>v</span>` and have to read as one sentence
  // across the gap, same contract as `how.*` above, which this reuses for the
  // three swipes and the tacos.
  'help.open':        { en: 'HOW TO PLAY', es: 'CÓMO SE JUEGA' },
  'help.title':       { en: 'HOW TO PLAY', es: 'CÓMO SE JUEGA' },
  'help.tap.k':       { en: 'Tap anywhere', es: 'Toca donde sea' },
  'help.tap.v':       { en: '— jump. Same as swiping up.', es: '— brinca. Igual que deslizar hacia arriba.' },
  'help.rule.tag':    { en: 'THE ONE THAT GETS YOU', es: 'LO QUE TE AGARRA' },
  'help.rule.title':  { en: 'THESE DO NOT GET JUMPED', es: 'ESTO NO SE SALTA' },
  'help.rule.body':   { en: 'Checkpoints, the wall, the ICE cruiser. Every one of them is taller '
                          + 'than your jump, and always has been. Jumping one is a hit, every '
                          + 'single time. Change lanes instead.',
                        es: 'Retenes, el muro, la patrulla. Todos son más altos que tu salto, y '
                          + 'siempre lo han sido. Saltarlos es golpe seguro, cada vez. Mejor '
                          + 'cámbiate de carril.' },
  'help.back':        { en: 'GOT IT', es: 'ENTENDIDO' },

  // ------------------------------------------------------------ game over
  // The one line the whole run ends on, and the best joke in the game. Deadpan
  // is the entire point: nobody in this alley is surprised about who it was.
  // Named in the reader's own language so the resignation lands on the first
  // read rather than the second. LENGTH IS CAPPED: .bust animates its
  // letter-spacing in from 0.36em, and a longer line reflows off two lines
  // onto one mid-entrance at 320px. Sixteen characters clears that at full
  // tracking, and both of these are inside it.
  'over.reason.migra':{ en: 'OF COURSE. ICE.', es: 'CLARO. LA MIGRA.' },
  'over.scoreLabel':  { en: 'SCORE', es: 'PUNTOS' },
  // Same shape as the Spanish — one bark, then the news. Under sixteen
  // characters for the same reason `.bust` above is.
  'over.pb':          { en: 'NICE! NEW BEST!', es: '¡ÓRALE, RÉCORD!' },
  'over.chelas':      { en: 'BEERS', es: 'CHELAS' },
  'over.tacos':       { en: 'TACOS', es: 'TACOS' },
  'over.meters':      { en: 'METERS', es: 'METROS' },
  'over.again':       { en: 'RUN AGAIN', es: 'OTRA VEZ' },
  'over.menu':        { en: 'MENU', es: 'MENÚ' },

  // ------------------------------------------------------------------ HUD
  'hud.migra':        { en: 'ICE', es: 'LA MIGRA' },
  'hud.sinGas':       { en: 'NO GAS', es: 'SIN GAS' },
  // Power pills. Short on purpose — the pill shrinks a long label rather than
  // wrap it, and a shrunk label is an unreadable one.
  //
  // The magnet's art is a soft pouch and the chancla's is a pistol (see the
  // block comment above drawPowerup in art/props.js), so neither `en` name can
  // be the object without contradicting the picture. Both are therefore named
  // for what they DO, which is true whichever way the art lands.
  'power.magnet':     { en: 'BEER MAGNET', es: 'IMÁN PIÑATA' },
  'power.chancla':    { en: 'RAMPAGE', es: 'CHANCLAZO' },
  'power.lowrider':   { en: 'LOWRIDER', es: 'LOWRIDER' },
  'toast.taco':       { en: 'TACO! +FUEL', es: '¡TACO! +GASOLINA' },
  'toast.lowriderDown': { en: 'LOWRIDER TOTALED', es: 'ADIÓS, LOWRIDER' },

  // ---------------------------------------------------------------- intro
  'intro.tail':       { en: 'ICE. WHAT A SURPRISE.', es: 'LA MIGRA. QUÉ SORPRESA.' },
  'intro.primo':      { en: 'PRIMO', es: 'PRIMO' },

  // ------------------------------------------------- tutorial: the course
  'tut.welcome.tag':  { en: 'CORRUPT SHOWS YOU HOW', es: 'CORRUPT TE ENSEÑA' },
  'tut.welcome.title':{ en: 'ALLEY SCHOOL', es: 'ESCUELA DEL CALLEJÓN' },
  'tut.welcome.body': { en: "I'm Corrupt. Three lanes, no brakes, and ICE behind you. Shocking, I know. "
                          + 'Give me thirty seconds and the alley stops killing you for free.',
                        es: 'Soy Corrupt. Tres carriles, cero frenos, y atrás La Migra. Sorpresa. '
                          + 'Dame treinta segundos y el callejón deja de matarte de gratis.' },
  'tut.welcome.cue':  { en: 'TAP TO START', es: 'TAP PARA EMPEZAR' },

  'tut.lane.tag':     { en: 'STEP 1', es: 'PASO 1' },
  'tut.lane.title':   { en: 'CHANGE LANES', es: 'CAMBIA DE CARRIL' },
  'tut.lane.body':    { en: 'Left, middle, right. Swipe sideways. This one move answers most of '
                          + 'what the alley throws at you, so learn it now.',
                        es: 'Izquierda, centro, derecha. Deslízate de lado. Este movimiento resuelve casi '
                          + 'todo lo que te avienta el callejón, así que apréndetelo ya.' },
  'tut.lane.keys':    { en: 'ARROWS  ·  A  D', es: 'FLECHAS  ·  A  D' },

  'tut.jump.tag':     { en: 'STEP 2', es: 'PASO 2' },
  'tut.jump.title':   { en: 'JUMP THE TRASH', es: 'SALTA LA BASURA' },
  'tut.jump.body':    { en: 'Dumpsters, crates, cones — all of it fits under your jump. Swipe up. '
                          + 'Nobody is moving any of it for you.',
                        es: 'Botes, cajas, conos — todo eso cabe debajo de tu salto. Deslízate hacia arriba. '
                          + 'Nadie va a mover ese bote por ti.' },
  'tut.jump.keys':    { en: 'SPACE  ·  UP  ·  TAP', es: 'ESPACIO  ·  ARRIBA  ·  TAP' },

  'tut.slide.tag':    { en: 'STEP 3', es: 'PASO 3' },
  'tut.slide.title':  { en: 'DUCK', es: 'AGÁCHATE' },
  'tut.slide.body':   { en: 'Clotheslines and taco-shop awnings hang right at head height. Swipe down. '
                          + 'And no, the neighbour is not taking her laundry in for you.',
                        es: 'Los tendederos y los toldos de la taquería cuelgan justo a la altura de tu cabeza. '
                          + 'Deslízate hacia abajo. Y no, la vecina no va a meter su ropa por ti.' },
  'tut.slide.keys':   { en: 'DOWN  ·  S', es: 'ABAJO  ·  S' },

  'tut.wall.tag':     { en: 'HEADS UP', es: '¡AGUAS!' },
  'tut.wall.title':   { en: 'NO JUMPING THESE', es: 'ESTO NO SE SALTA' },
  'tut.wall.body':    { en: 'Checkpoints, the wall, the cruiser. Taller than your jump. Always have been. '
                          + 'Jumping one is a hit, every single time — go around.',
                        es: 'Retenes, el muro, la patrulla. Más altos que tu salto. Siempre lo han sido. '
                          + 'Saltarlos es golpe seguro, cada vez — dales la vuelta.' },

  'tut.loot.tag':     { en: 'STEP 4', es: 'PASO 4' },
  'tut.loot.title':   { en: 'THE STREET PROVIDES', es: 'LA CALLE PROVEE' },
  'tut.loot.body':    { en: 'Beers are points and they build your combo. Tacos are fuel. '
                          + 'The rest are power-ups. Take everything — you are not coming back for it.',
                        es: 'Las chelas son puntos y te suben el combo. Los tacos son gasolina. '
                          + 'Lo demás son poderes. Agárrate todo — no vas a regresar por ello.' },

  'tut.migra.tag':    { en: 'STEP 5', es: 'PASO 5' },
  'tut.migra.title':  { en: "DON'T GET CAUGHT", es: 'NO TE DEJES AGARRAR' },
  'tut.migra.body':   { en: 'Every hit feeds ICE. Your fuel drains the whole run, and on empty '
                          + 'the meter fills itself — how convenient. Only tacos refill it.',
                        es: 'Cada golpe le sube a LA MIGRA. La gasolina se te va toda la corrida, y en ceros '
                          + 'el medidor se llena solito — qué conveniente. Solo los tacos la recargan.' },

  // The last card. `es` keeps its bark; `en` needs one that carries the same
  // energy without being the Spanish one — Corrupt is faintly, briefly
  // impressed, and then immediately over it in the line below.
  'tut.go.title':     { en: 'THERE IT IS!', es: '¡ÓRALE!' },
  'tut.go.body':      { en: 'NOW YOU KNOW. RUN.', es: 'YA SABES. CORRE.' },

  'tut.cue.next':     { en: 'TAP TO CONTINUE', es: 'TAP PARA SEGUIR' },
  'tut.cue.up':       { en: 'SWIPE  ↑', es: 'DESLIZA  ↑' },
  'tut.cue.down':     { en: 'SWIPE  ↓', es: 'DESLIZA  ↓' },
  'tut.cue.both':     { en: 'SWIPE  ←   OR   →', es: 'DESLIZA  ←   O   →' },
  'tut.cue.left':     { en: 'SWIPE  ←', es: 'DESLIZA  ←' },
  'tut.cue.right':    { en: 'SWIPE  →', es: 'DESLIZA  →' },
  'tut.cue.done':     { en: "THAT'S IT!", es: '¡ESO!' },
  'tut.cue.skipStep': { en: 'TAP TO SKIP THIS STEP', es: 'TAP PARA SALTAR ESTE PASO' },
  'tut.skip':         { en: 'SKIP THE LESSON', es: 'SALTAR ENTRENAMIENTO' },

  'tut.guide.jump':   { en: 'YOUR JUMP', es: 'TU SALTO' },
  'tut.guide.stand':  { en: 'STANDING', es: 'DE PIE' },
  'tut.guide.crouch': { en: 'DUCKING', es: 'AGACHADO' },

  'tut.meter.migra':  { en: 'ICE', es: 'LA MIGRA' },
  'tut.meter.hit':    { en: 'EVERY HIT RAISES IT.', es: 'CADA GOLPE LA SUBE.' },
  'tut.meter.full':   { en: 'FULL = THEY GOT YOU', es: 'LLENA = TE AGARRARON' },
  'tut.meter.gas':    { en: 'GAS', es: 'GAS' },

  // Tile names and their verdict chips. Every name shrinks to fit its tile
  // rather than wrapping, so length is free here — but three to a row at
  // 320px means a shrunk name is a small one, and short still wins.
  'tut.tile.beer':        { en: 'BEER', es: 'CHELA' },
  'tut.tile.beer.n':      { en: '+10 · COMBO', es: '+10 · COMBO' },
  'tut.tile.taco':        { en: 'TACO', es: 'TACO' },
  'tut.tile.taco.n':      { en: '+FUEL', es: '+GASOLINA' },
  'tut.tile.magnet':      { en: 'MAGNET', es: 'PIÑATA' },
  'tut.tile.magnet.n':    { en: 'PULLS BEERS', es: 'IMÁN' },
  'tut.tile.chancla':     { en: 'RAMPAGE', es: 'CHANCLA' },
  'tut.tile.chancla.n':   { en: 'BREAKS ALL', es: 'ROMPE TODO' },
  'tut.tile.lowrider':    { en: 'LOWRIDER', es: 'LOWRIDER' },
  'tut.tile.lowrider.n':  { en: 'TAKES 1 HIT', es: 'AGUANTA 1' },
  'tut.tile.dumpster':    { en: 'DUMPSTER', es: 'DUMPSTER' },
  'tut.tile.crates':      { en: 'CRATES', es: 'CAJAS' },
  'tut.tile.cones':       { en: 'CONES', es: 'CONOS' },
  'tut.tile.jump.n':      { en: 'JUMP IT', es: 'SALTA' },
  'tut.tile.clothesline': { en: 'CLOTHESLINE', es: 'TENDEDERO' },
  'tut.tile.awning':      { en: 'AWNING', es: 'TOLDO' },
  'tut.tile.duck.n':      { en: 'DUCK', es: 'AGÁCHATE' },
  'tut.tile.checkpoint':  { en: 'CHECKPOINT', es: 'RETÉN' },
  'tut.tile.border':      { en: 'THE WALL', es: 'EL MURO' },
  'tut.tile.copcar':      { en: 'ICE CRUISER', es: 'LA PATRULLA' },
  'tut.tile.no.n':        { en: 'GO AROUND', es: 'NO SE SALTA' },

  // --------------------------------------------- the board / la tabla
  // The board is the one screen where players read each other's names, so the
  // copy stays as flat as the rest: it states the rule and gets out of the way.
  'menu.boards':      { en: 'LEADERBOARD', es: 'LA TABLA' },
  'menu.account':     { en: 'ACCOUNT', es: 'CUENTA' },
  'board.title':      { en: 'LEADERBOARD', es: 'LA TABLA' },
  'board.daily':      { en: 'TODAY', es: 'HOY' },
  'board.weekly':     { en: 'WEEK', es: 'SEMANA' },
  'board.back':       { en: 'BACK', es: 'ATRÁS' },
  'board.loading':    { en: 'Loading…', es: 'Cargando…' },
  // %k is the day or week key, filled at the call site.
  'board.keyDaily':   { en: '%k · resets at midnight UTC',
                        es: '%k · se reinicia a medianoche UTC' },
  'board.keyWeekly':  { en: '%k · the sum of your daily bests',
                        es: '%k · la suma de tus mejores del día' },
  'board.offBuild':   { en: 'The board is not switched on in this build.',
                        es: 'La tabla todavía no está encendida en esta versión.' },
  'board.signedOut':  { en: 'Sign in from ACCOUNT and your run goes on the board.',
                        es: 'Entra desde CUENTA y tu corrida sale en la tabla.' },
  'board.nobody':     { en: 'Nobody has run this one yet. Be the first.',
                        es: 'Nadie ha corrido esta todavía. Sé el primero.' },
  'board.you':        { en: 'YOU', es: 'TÚ' },
  // The continue mark. A run that bought its way past the bust still ranks —
  // so the tag rides the score wherever it is shown, and the note explains it
  // the first time one appears on the board. Short, because it sits inside a
  // ~60px column at 320px.
  'board.contTag':    { en: 'CONT', es: 'CONT' },
  'board.contNote':   { en: 'CONT · that run paid Corrupt to keep going. It still counts.',
                        es: 'CONT · esa corrida le pagó a Corrupt para seguir. Cuenta igual.' },
  // %n is the rank. The game-over line, under the score.
  'over.rankFirst':   { en: "#1 ON TODAY'S BOARD", es: '#1 EN LA TABLA DE HOY' },
  'over.rank':        { en: "#%n ON TODAY'S BOARD", es: '#%n EN LA TABLA DE HOY' },
  'over.rankFirstCont': { en: "#1 ON TODAY'S BOARD — BOUGHT",
                          es: '#1 EN LA TABLA DE HOY — PAGADA' },
  'over.rankCont':    { en: "#%n ON TODAY'S BOARD — BOUGHT",
                        es: '#%n EN LA TABLA DE HOY — PAGADA' },

  // -------------------------------------------------- the account / cuenta
  'acct.title':       { en: 'ACCOUNT', es: 'CUENTA' },
  'acct.back':        { en: 'BACK', es: 'ATRÁS' },
  'acct.offBuild':    { en: 'The cloud is not switched on in this build — but your run is saved '
                          + 'on this phone, and you can back it up below.',
                        es: 'La nube todavía no está encendida en esta versión — pero tu corrida está '
                          + 'guardada en este teléfono, y aquí abajo la puedes respaldar.' },
  // %s is the email.
  'acct.signedInAs':  { en: 'Signed in as %s — your progress syncs on its own.',
                        es: 'Entraste como %s — tu progreso se sincroniza solo.' },
  'acct.signedIn':    { en: 'Signed in — your progress syncs on its own.',
                        es: 'Ya entraste — tu progreso se sincroniza solo.' },
  'acct.signOut':     { en: 'SIGN OUT', es: 'CERRAR SESIÓN' },
  'acct.signingOut':  { en: 'SIGNING OUT…', es: 'CERRANDO…' },
  'acct.pitch':       { en: 'Sign in with Google and your run follows you — another phone, another '
                          + 'browser, even after you clear everything.',
                        es: 'Entra con Google y tu corrida te sigue — otro teléfono, otro navegador, '
                          + 'aunque borres todo.' },
  'acct.signIn':      { en: 'SIGN IN WITH GOOGLE', es: 'ENTRAR CON GOOGLE' },
  'acct.continuing':  { en: 'CONTINUING…', es: 'CONTINUANDO…' },
  'acct.signInFail':  { en: 'Could not open Google. Try again.',
                        es: 'No se pudo abrir Google. Inténtalo otra vez.' },

  'acct.nameTitle':   { en: 'Runner name', es: 'Nombre de corredor' },
  'acct.nameCopyIn':  { en: 'It shows next to your score on the board. Nobody sees your email. '
                          + 'Changing it also updates every board you are already on.',
                        es: 'Sale junto a tu score en la tabla. Tu correo no lo ve nadie. '
                          + 'Si lo cambias, se actualiza también en las tablas donde ya saliste.' },
  'acct.nameCopyOut': { en: 'It shows next to your score once you sign in. Nobody sees your email.',
                        es: 'Sale junto a tu score una vez que entres. Tu correo no lo ve nadie.' },
  'acct.namePh':      { en: 'e.g. neonghost', es: 'ej. neonghost' },
  'acct.nameSave':    { en: 'SAVE', es: 'GUARDAR' },
  // %s is the sanitized handle, or the anonymous name.
  'acct.nameShows':   { en: 'On the board: %s', es: 'En la tabla: %s' },
  'acct.nameAnon':    { en: 'No name — the board calls you: %s',
                        es: 'Sin nombre — la tabla te pone: %s' },
  'acct.nameNone':    { en: 'No name yet.', es: 'Sin nombre todavía.' },
  'acct.nameSet':     { en: 'You are %s now.', es: 'Quedaste como %s.' },
  'acct.nameCleared': { en: 'Name cleared.', es: 'Nombre borrado.' },

  // Gameplay stats. The copy says exactly what is collected and exactly what is
  // not, because the whole reason the identity is a random id rather than a
  // fingerprint is so this paragraph can be written honestly.
  'acct.statsTitle':  { en: 'Gameplay stats', es: 'Estadísticas de juego' },
  'acct.statsCopy':   { en: 'Anonymous counts — runs, scores, which buttons get used — '
                          + 'tied to a random id, never to you. No trackers, no ad networks, '
                          + 'nobody else gets it.',
                        es: 'Conteos anónimos — carreras, puntajes, qué botones se usan — '
                          + 'ligados a un id al azar, nunca a ti. Sin rastreadores, sin redes '
                          + 'de anuncios, nadie más lo recibe.' },
  'acct.statsLabel':  { en: 'Share anonymous gameplay stats',
                        es: 'Compartir estadísticas anónimas' },
  'acct.statsOn':     { en: 'Thanks — stats are on.', es: 'Gracias — estadísticas activadas.' },
  'acct.statsOff':    { en: 'Stats are off on this device.',
                        es: 'Estadísticas apagadas en este aparato.' },

  'acct.backupTitle': { en: 'Backup on this device', es: 'Respaldo en este aparato' },
  'acct.backupCopy':  { en: 'Download a backup file — it survives clearing your browser, '
                          + 'and you load it back on any device.',
                        es: 'Baja un archivo de respaldo — aguanta aunque borres el navegador, '
                          + 'y lo cargas de vuelta en cualquier aparato.' },
  'acct.backupFile':  { en: 'DOWNLOAD BACKUP', es: 'BAJAR RESPALDO' },
  'acct.backupCode':  { en: 'COPY CODE', es: 'COPIAR CÓDIGO' },
  'acct.restoreFile': { en: 'Restore from a file', es: 'Restaurar desde un archivo' },
  'acct.restorePh':   { en: 'Or paste a backup code', es: 'O pega un código de respaldo' },
  'acct.restore':     { en: 'LOAD', es: 'CARGAR' },
  'acct.savedFile':   { en: 'Backup downloaded. Put it somewhere safe.',
                        es: 'Respaldo bajado. Guárdalo en buen lugar.' },
  'acct.copied':      { en: 'Code copied.', es: 'Código copiado.' },
  'acct.copyManual':  { en: 'Copy the code above.', es: 'Copia el código de arriba.' },
  'acct.noDownload':  { en: 'No downloads here — use the code.',
                        es: 'Aquí no se puede bajar — usa el código.' },
  'acct.needCode':    { en: 'Paste a code first.', es: 'Primero pega un código.' },
  'acct.badCode':     { en: 'That code did not work.', es: 'Ese código no jaló.' },
  'acct.badBackup':   { en: 'That file did not work.', es: 'Ese archivo no jaló.' },

  // ------------------------------------------------------------- invites
  // The currency is BEERS in `en` and CHELAS in `es`, like everywhere else.
  // Corrupt handles the payout, so he gets to have an opinion about it.
  'invite.title':     { en: 'Invite a friend', es: 'Invita a un amigo' },
  'invite.pitch':     { en: 'Send them your link. Once they sign in and put up %s, '
                          + 'you get %r beers and they get %f. Corrupt keeps the receipts.',
                        es: 'Mándales tu liga. Cuando entren y hagan %s, '
                          + 'tú te llevas %r chelas y ellos %f. Corrupt guarda los recibos.' },
  'invite.copy':      { en: 'COPY', es: 'COPIAR' },
  'invite.share':     { en: 'SHARE', es: 'COMPARTIR' },
  'invite.minting':   { en: 'Making your link…', es: 'Armando tu liga…' },
  'invite.noCode':    { en: 'No link yet — try again in a moment.',
                        es: 'Sin liga todavía — inténtalo en un momento.' },
  'invite.stats':     { en: '%i invited · %q played enough · %c collected',
                        es: '%i invitados · %q ya jugaron · %c cobrados' },
  'invite.statsOff':  { en: 'Could not check your invites right now.',
                        es: 'No se pudieron revisar tus invitaciones ahora.' },
  'invite.claim':     { en: 'COLLECT · %c BEERS', es: 'COBRAR · %c CHELAS' },
  'invite.claimed':   { en: '+%c beers. Corrupt counted them out loud.',
                        es: '+%c chelas. Corrupt las contó en voz alta.' },
  'invite.claimFail': { en: 'Could not collect that. Try again.',
                        es: 'No se pudo cobrar. Inténtalo otra vez.' },
  'invite.copied':    { en: 'Link copied. Go send it.', es: 'Liga copiada. Ve a mandarla.' },
  // The game's own title, so it stays as-is in both — see the PROPER NOUNS list.
  'invite.shareTitle': { en: 'Primos: Barrio Run', es: 'Primos: Barrio Run' },
  'invite.shareText': { en: 'Run the alley with me. ICE is already behind you.',
                        es: 'Córrele conmigo en el callejón. La Migra ya viene atrás.' },
  'invite.welcome':   { en: '+%c beers for showing up on a friend’s link. Welcome to the alley.',
                        es: '+%c chelas por llegar con la liga de un amigo. Bienvenido al callejón.' },

  // ----------------------------------------------- the shop / la tiendita
  // `en` calls it the corner store, `es` calls it la tiendita. Corrupt is
  // doing you a favour and would like you to know it.
  'shop.open':        { en: 'CORNER STORE', es: 'LA TIENDITA' },
  'shop.kicker':      { en: 'CORRUPT RUNS THE COUNTER', es: 'LA TIENDA DE CORRUPT' },
  'shop.blurb':       { en: 'Corrupt keeps the good stuff behind the counter. Beers only — he does not take cards.',
                        es: 'Corrupt guarda lo bueno detrás del mostrador. Solo chelas — no acepta tarjeta.' },
  'shop.wallet':      { en: 'YOUR BEERS', es: 'TUS CHELAS' },
  'shop.short':       { en: 'SHORT %n', es: 'FALTAN %n' },
  'shop.have':        { en: 'On the shelf with your name on it: %n',
                        es: 'En el estante con tu nombre: %n' },
  'shop.bought':      { en: 'Done. %s is waiting for your next run.',
                        es: 'Hecho. %s te espera en la próxima corrida.' },
  'shop.denied':      { en: 'Not enough beers. Corrupt counted twice, out loud.',
                        es: 'No te alcanza. Corrupt contó dos veces, en voz alta.' },
  'shop.broke':       { en: 'Nothing here you can afford yet. The alley is full of beer — go get some.',
                        es: 'Todavía nada te alcanza. El callejón está lleno de chelas — ve por ellas.' },
  'shop.back':        { en: 'BACK TO IT', es: 'A DARLE' },

  // Shelf items. The names are the alley's own words where the alley has one.
  // Blurbs are one short line each. They sit in a ~110px column at 320px, and
  // a second sentence turns every row into a paragraph.
  'item.gasolina':    { en: 'FULL TANK', es: 'TANQUE LLENO' },
  'item.gasolina.b':  { en: 'Start with the fuel bar full.', es: 'Arrancas con la gasolina llena.' },
  'item.magnet':      { en: 'BEER MAGNET', es: 'IMÁN PIÑATA' },
  'item.magnet.b':    { en: 'Beers come to you for ten seconds.',
                        es: 'Las chelas se te vienen solas diez segundos.' },
  'item.chancla':     { en: 'RAMPAGE', es: 'CHANCLAZO' },
  'item.chancla.b':   { en: 'Open the run swinging. It all breaks.',
                        es: 'Arrancas con todo. Todo se rompe.' },
  'item.vida':        { en: 'ONE MORE LIFE', es: 'UNA VIDA MÁS' },
  'item.vida.b':      { en: 'He looks away the first time they catch you.',
                        es: 'Mira para otro lado la primera vez que te agarran.' },
  'item.lowrider':    { en: 'LOWRIDER', es: 'LOWRIDER' },
  'item.lowrider.b':  { en: 'Roll out on the lowrider. It takes one crash.',
                        es: 'Sales en el lowrider. Te aguanta un golpe.' },

  // ----------------------------------------------------------- the continue
  'cont.kicker':      { en: 'ICE HAS YOU', es: 'LA MIGRA TE TIENE' },
  'cont.title':       { en: 'KEEP RUNNING', es: 'SIGUE CORRIENDO' },
  'cont.body':        { en: 'Corrupt pulls up in the lowrider and leaves the door open. He is not doing it for free, '
                          + 'and he is not doing it twice for the same price.',
                        es: 'Corrupt llega en el lowrider y deja la puerta abierta. No lo hace gratis, '
                          + 'y no lo hace dos veces al mismo precio.' },
  'cont.keeps':       { en: 'YOU KEEP ALL OF IT', es: 'TE QUEDAS CON TODO' },
  'cont.cost':        { en: 'HE WANTS', es: 'ÉL QUIERE' },
  'cont.have':        { en: 'YOU HAVE', es: 'TÚ TIENES' },
  'cont.pay':         { en: 'PAY THE MAN', es: 'PÁGALE' },
  'cont.no':          { en: "NAH — I'M DONE", es: 'NEL, YA ESTUVO' },
  'cont.short':       { en: 'You are %n beers short. Corrupt shrugs and closes the door.',
                        es: 'Te faltan %n chelas. Corrupt se encoge de hombros y cierra la puerta.' },
  // Toast, when a vida bought earlier pays for itself. Short on purpose — it
  // is a pill on the canvas, not a sentence.
  'toast.vida':       { en: 'CORRUPT LOOKED AWAY', es: 'CORRUPT SE HIZO EL LOCO' },
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
  'CORRUPT LOOKED AWAY': 'toast.vida',
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

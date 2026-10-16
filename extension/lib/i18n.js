// The viewer's words in Spanish (the default) and English. The choice is per browser
// (localStorage "lang"); the toggle sits next to the theme one.
//
// Static text in viewer.html carries its key: data-i18n (text), data-i18n-title,
// data-i18n-placeholder, data-i18n-aria-label. The markup is written in Spanish so the
// first paint is already right for most people; translateStatic() swaps it.

const plural = (n, one, many) => (n === 1 ? one : many);

const STRINGS = {
  es: {
    findPerson: 'Buscar a alguien',
    searchPlaceholder: 'Buscar  /',
    matchingPeople: 'Personas que coinciden',
    shareTitle: 'Guarda el grafo con nombres y fotos en el almacenamiento compartido y copia un link corto. Nada de eso es privado.',
    shareWide: 'Copiar link',
    shareNarrow: 'Compartir',
    combineTitle: 'Pegá el link de un amigo para ver sus círculos juntos en un grafo',
    combineWide: 'Combinar con un amigo…',
    combineNarrow: 'Combinar',
    uncombineTitle: 'Volver al grafo de una sola persona',
    exploreText: 'Explorar datos',
    exploreTitle: 'Hacerle preguntas a estos grafos',
    hint: 'Hacé clic en alguien para ver quién sigue a quién · Esc limpia',
    openOnInstagram: 'Abrir en Instagram ↗',
    clearSelection: 'Limpiar selección (Esc)',
    filterPeople: 'Filtrar a estas personas',
    groupsTabs: 'Grupos',
    inviteTitle: 'Una extensión gratis de Chrome; tus seguidores no salen de tu navegador hasta que los compartís',
    inviteWide: 'Mapeá tus propios seguidores ↗',
    inviteNarrow: 'Mapeá los tuyos ↗',
    combineDialogTitle: 'Combinar con el grafo de un amigo',
    combineDialogText:
      'Pegá un link que tu amigo hizo con esta herramienta. Los círculos se dibujan juntos: la gente que conocen los dos, y la que conoce solo uno.',
    friendLink: 'Link de tu amigo',
    cancel: 'Cancelar',
    combine: 'Combinar',
    emptyExtension: 'Todavía no hay grafo. Corré un crawl desde el popup de la extensión.',
    emptySiteBefore: 'Abrí un link compartido de la ',
    emptySiteLink: 'extensión IG Social Graph',
    emptySiteAfter: ' para ver un grafo acá.',
    tryExample: 'Probar un ejemplo',
    followerGraph: 'Grafo de seguidores',

    circleOf: (u) => `El círculo de @${u}`,
    counts: (people, links) => `${people} personas · ${links} conexiones`,
    loners: (n) => ` · ${n} ${plural(n, 'solitario oculto', 'solitarios ocultos')} hasta que alguien los seleccione`,
    partial: ' · parcial',
    inBoth: (n) => ` · ${n} en ambos círculos`,
    inMoreThanOne: (n) => ` · ${n} en más de un círculo`,
    graphLabel: (n, groups) =>
      `Grafo de seguidores de ${n} personas` +
      (groups > 1 ? ` en ${groups} grupos de amigos` : '') +
      '. Usá la búsqueda para elegir a alguien; sus conexiones aparecen en un panel.',
    onlyOwner: (u) => `Solo @${u}`,
    private: 'privada',
    verified: 'verificada',
    showPhotoOf: (u) => `Ver la foto de @${u} más grande`,
    showLarger: 'Ver más grande',
    openOnInstagramOf: (u) => `Abrir @${u} en Instagram (pestaña nueva)`,
    follower: (name, n) => `${n} ${plural(n, 'sigue', 'siguen')} a @${name}`,
    following: (name, n) => `@${name} sigue a ${n}`,
    mutual: (name, n) => (n ? `@${name} y ${n} se siguen mutuamente` : 'sin seguimientos mutuos'),
    tabMutual: (n) => `Mutuos · ${n}`,
    tabFollower: (n) => `Lo siguen · ${n}`,
    tabFollowing: (n) => `Sigue · ${n}`,
    showAllGroups: 'Mostrar todos los grupos de nuevo',
    showOnlyGroup: 'Mostrar solo este grupo (pasá el mouse para previsualizar)',
    noMatch: 'Sin coincidencias',
    showAll: (n) => `Mostrar los ${n}`,
    selectionCleared: 'Selección limpia.',
    foldPanel: 'Plegar panel',
    unfoldPanel: 'Desplegar panel',
    holdGroup: 'Clic para mantener este grupo resaltado',
    groupPeople: (label, n) => `${label} (${n} ${plural(n, 'persona', 'personas')})`,
    groupN: (i) => `Grupo ${i}`,
    groupNameLabel: (i, n) => `Nombre del grupo ${i} (${n} ${plural(n, 'persona', 'personas')})`,
    renameGroup: (i) => `Renombrar grupo ${i}`,
    renameTitle: 'Renombrar este grupo (se guarda en el link)',
    circles: 'Círculos ',
    friendGroups: 'Grupos de amigos ',
    circleBoth: 'En ambos círculos',
    circleMany: 'En más de uno',
    circleOnly: (u) => `Solo de @${u}`,
    toLight: 'Cambiar a tema claro',
    toDark: 'Cambiar a tema oscuro',
    switchTheme: 'Cambiar tema',
    langButton: 'EN',
    langLabel: 'Switch to English',
    notShared: (u) => `@${u} todavía no compartió su grafo`,
    notALink: 'Eso no es un link para compartir: llevan "#o=" después de la dirección.',
    alreadyCombined: 'Ese link ya combina gente. Pedí uno solo con el de tu amigo.',
    noOwner: 'ese link no dice de quién es el grafo',
    couldNotCombine: (msg) => `No se pudo combinar: ${msg}.`,
    opening: 'Abriendo el grafo compartido…',
    didNotOpen: (msg) => `Este link no abrió: ${msg}. Pedilo de nuevo.`,
    uploading: 'Subiendo…',
    linkCopied: 'Link copiado',
    couldNotShare: (msg) => `No se pudo compartir: ${msg}.`,
    copyThisLink: 'Copiá este link:',
  },
  en: {
    findPerson: 'Find a person',
    searchPlaceholder: 'Search  /',
    matchingPeople: 'Matching people',
    shareTitle: 'Saves the graph with names and photos to the shared storage and copies a short link. Nothing there is private.',
    shareWide: 'Copy share link',
    shareNarrow: 'Share',
    combineTitle: "Paste a friend's share link to see your circles together in one graph",
    combineWide: 'Combine with a friend…',
    combineNarrow: 'Combine',
    uncombineTitle: "Go back to one person's graph",
    exploreText: 'Explore data',
    exploreTitle: 'Ask these graphs questions',
    hint: 'Click someone to see who follows whom · Esc clears',
    openOnInstagram: 'Open on Instagram ↗',
    clearSelection: 'Clear selection (Esc)',
    filterPeople: 'Filter these people',
    groupsTabs: 'Groups',
    inviteTitle: 'A free Chrome extension; your followers never leave your browser until you share them',
    inviteWide: 'Map your own followers ↗',
    inviteNarrow: 'Map yours ↗',
    combineDialogTitle: "Combine with a friend's graph",
    combineDialogText:
      'Paste a share link your friend made with this tool. The circles are drawn together: the people you both know, and the ones only one of you does.',
    friendLink: "Friend's share link",
    cancel: 'Cancel',
    combine: 'Combine',
    emptyExtension: 'No graph yet. Run a crawl from the extension popup.',
    emptySiteBefore: 'Open a share link from the ',
    emptySiteLink: 'IG Social Graph extension',
    emptySiteAfter: ' to see a graph here.',
    tryExample: 'Try an example',
    followerGraph: 'Follower graph',

    circleOf: (u) => `@${u}'s circle`,
    counts: (people, links) => `${people} people · ${links} connections`,
    loners: (n) => ` · ${n} ${plural(n, 'loner', 'loners')} hidden until selected`,
    partial: ' · partial',
    inBoth: (n) => ` · ${n} in both circles`,
    inMoreThanOne: (n) => ` · ${n} in more than one circle`,
    graphLabel: (n, groups) =>
      `Follower graph of ${n} people` +
      (groups > 1 ? ` in ${groups} friend groups` : '') +
      '. Use search to pick someone; their connections are listed in a panel.',
    onlyOwner: (u) => `@${u} only`,
    private: 'private',
    verified: 'verified',
    showPhotoOf: (u) => `Show @${u}'s photo larger`,
    showLarger: 'Show larger',
    openOnInstagramOf: (u) => `Open @${u} on Instagram (new tab)`,
    follower: (name, n) => `${n} ${plural(n, 'follows', 'follow')} @${name}`,
    following: (name, n) => `@${name} follows ${n}`,
    mutual: (name, n) => (n ? `@${name} and ${n} follow each other` : 'no mutual follows'),
    tabMutual: (n) => `Each other · ${n}`,
    tabFollower: (n) => `Follow them · ${n}`,
    tabFollowing: (n) => `They follow · ${n}`,
    showAllGroups: 'Show all groups again',
    showOnlyGroup: 'Show only this group (hover to preview)',
    noMatch: 'No match',
    showAll: (n) => `Show all ${n}`,
    selectionCleared: 'Selection cleared.',
    foldPanel: 'Fold panel',
    unfoldPanel: 'Unfold panel',
    holdGroup: 'Click to keep this group highlighted',
    groupPeople: (label, n) => `${label} (${n} ${plural(n, 'person', 'people')})`,
    groupN: (i) => `Group ${i}`,
    groupNameLabel: (i, n) => `Name for group ${i} (${n} ${plural(n, 'person', 'people')})`,
    renameGroup: (i) => `Rename group ${i}`,
    renameTitle: 'Rename this group (saved in the share link)',
    circles: 'Circles ',
    friendGroups: 'Friend groups ',
    circleBoth: 'In both circles',
    circleMany: 'In more than one',
    circleOnly: (u) => `Only @${u}'s`,
    toLight: 'Switch to light theme',
    toDark: 'Switch to dark theme',
    switchTheme: 'Switch theme',
    langButton: 'ES',
    langLabel: 'Cambiar a español',
    notShared: (u) => `@${u} has not shared a graph yet`,
    notALink: 'That is not a share link: they contain "#o=" after the address.',
    alreadyCombined: 'That link already combines people. Ask for one with only theirs.',
    noOwner: 'that link does not say whose graph it is',
    couldNotCombine: (msg) => `Could not combine: ${msg}.`,
    opening: 'Opening the shared graph…',
    didNotOpen: (msg) => `This share link did not open: ${msg}. Ask for it again.`,
    uploading: 'Uploading…',
    linkCopied: 'Link copied',
    couldNotShare: (msg) => `Could not share: ${msg}.`,
    copyThisLink: 'Copy this link:',
  },
};

// The extension popup (p.) and the Explore page (x.).
const POPUP_AND_EXPLORE = {
  es: {
    'p.loading': 'Cargando…',
    'p.account': 'Cuenta',
    'p.checked': 'Seguidores revisados',
    'p.connections': 'Conexiones',
    'p.requests': 'Pedidos',
    'p.timeLeft': 'Tiempo restante',
    'p.openInstagram': 'Abrir Instagram',
    'p.start': 'Empezar',
    'p.startOver': 'Empezar de nuevo',
    'p.resume': 'Seguir',
    'p.pause': 'Pausar',
    'p.getProfiles': 'Traer nombres y fotos',
    'p.refreshProfiles': 'Actualizar nombres y fotos',
    'p.profilesTitle': 'Vuelve a listar tus seguidores (más o menos un pedido cada 50) para traer nombres reales y fotos de perfil',
    'p.intro': 'Tus datos quedan en este navegador hasta que los compartís. ',
    'p.guide': 'Guía paso a paso',
    'p.view': 'Ver grafo',
    'p.share': 'Copiar link',
    'p.settings': 'Ajustes',
    'p.delay': 'Segundos entre pedidos ',
    'p.max': 'Seguidores a revisar (0 = todos) ',
    'p.settingsNote':
      'Más lento es más seguro. Instagram limita qué tan rápido navega una cuenta; si frena, el crawl espera y sigue solo. Dejá una pestaña de instagram.com abierta (se abre una por vos).',
    'p.reset': 'Borrar los datos juntados',
    'p.fetchingProfiles': 'Trayendo nombres y fotos…',
    'p.listing': 'Listando tus seguidores…',
    'p.checking': 'Revisando quién sigue a quién…',
    'p.paused': 'En pausa.',
    'p.cooldown': (time) => `Esperando a Instagram — sigue a las ${time}.`,
    'p.done': 'Listo.',
    'p.stopped': 'Frenado.',
    'p.pitch': 'Mapea quiénes de tus seguidores se conocen entre sí. Tarda más o menos una hora cada 500 seguidores, y corre solo.',
    'p.logInFirst': 'Primero iniciá sesión en Instagram en este navegador. Usa tu propia sesión.',
    'p.listingCount': (n) => `listando… ${n}`,
    'p.atLeast': (d) => `al menos ${d}`,
    'p.measuredTitle': 'Según el ritmo hasta ahora, incluyendo las veces que Instagram hizo esperar al crawl.',
    'p.floorTitle': 'Todavía no se revisaron suficientes seguidores para medir el ritmo; esto es el mínimo con la demora actual.',
    'p.confirmRestart': '¿Descartar el grafo actual y crawlear de nuevo?',
    'p.confirmReset': '¿Borrar todo lo juntado hasta ahora?',
    'p.noOwner': 'el crawl no dice de quién es el grafo',

    'x.title': 'Explorar el grafo',
    'x.intro': 'Hacele preguntas a los grafos compartidos. Todo corre en esta página; no se sube nada. ',
    'x.back': 'Volver al grafo',
    'x.graphs': 'Grafos',
    'x.ownersPlaceholder': 'usuarios separados por comas: sebas.favaron, nachonnc',
    'x.load': 'Cargar',
    'x.loading': 'Cargando…',
    'x.loaded': (people, follows, ms) => `${people} personas · ${follows} seguimientos · ${ms} ms`,
    'x.question': 'Pregunta',
    'x.caveat':
      'Cada crawl solo ve los seguimientos entre la gente de su dueño. Un seguimiento entre dos personas que no comparten ningún círculo cargado no está en los datos, así que "no hay" ahí quiere decir "no se ve".',
    'x.sqlSummary': 'El SQL de esta pregunta ',
    'x.sqlHint': '· editalo para preguntar lo tuyo',
    'x.run': 'Ejecutar',
    'x.runTitle': 'Ejecutar (Ctrl+Enter)',
    'x.sqlNote': 'SQLite · Ctrl+Enter ejecuta',
    'x.owners': 'de quiénes son los grafos cargados; la posición 0 es la primera',
    'x.people': 'todos los que están en algún grafo cargado',
    'x.follows': 'source sigue a target',
    'x.circles': 'username sigue al dueño, o el dueño lo sigue',
    'x.edges': 'vista: seguimientos en las dos direcciones, para caminos',
    'x.ownSql': 'Tu propio SQL',
    'x.rows': (n) => `${n} ${n === 1 ? 'fila' : 'filas'}`,
    'x.firstShown': (n) => ` (se muestran las primeras ${n})`,
    'x.noRows': 'Sin filas',
    'x.couldNotLoad': (msg) => `No se pudo cargar: ${msg}`,
    'x.typeOwners': 'Escribí uno o más usuarios que hayan compartido su grafo.',
    'x.tooMany': (n) => `Como mucho ${n} grafos a la vez.`,
    'x.openIg': (u) => `Abrir @${u} en Instagram`,
    'x.sqlFailed': 'SQLite no se descargó',
    'x.q.mostFollowed': 'Los más seguidos en estos grafos',
    'x.q.noFollowBack': 'A quién sigue {0} que no lo sigue de vuelta',
    'x.q.mostConnected': 'Los más conectados dentro de cada círculo',
    'x.q.moreThanOne': 'Gente en más de un círculo',
    'x.q.eachOther': '¿{a} y {b} se siguen?',
    'x.q.inBoth': 'En los círculos de {a} y de {b}, y si {0} los conoce',
    'x.q.paths': 'Caminos de {a} a {b} que no pasan por {0} (hasta 3 pasos)',
  },
  en: {
    'p.loading': 'Loading…',
    'p.account': 'Account',
    'p.checked': 'Followers checked',
    'p.connections': 'Connections',
    'p.requests': 'Requests',
    'p.timeLeft': 'Time left',
    'p.openInstagram': 'Open Instagram',
    'p.start': 'Start',
    'p.startOver': 'Start over',
    'p.resume': 'Resume',
    'p.pause': 'Pause',
    'p.getProfiles': 'Get names & photos',
    'p.refreshProfiles': 'Refresh names & photos',
    'p.profilesTitle': 'Lists your followers again (about one request per 50) to pick up real names and profile photos',
    'p.intro': 'Your data stays in this browser until you share it. ',
    'p.guide': 'Step-by-step guide',
    'p.view': 'View graph',
    'p.share': 'Copy share link',
    'p.settings': 'Settings',
    'p.delay': 'Seconds between requests ',
    'p.max': 'Followers to check (0 = all) ',
    'p.settingsNote':
      'Slower is safer. Instagram limits how fast an account can browse; if it pushes back, the crawl waits and resumes on its own. Keep one instagram.com tab open (one is opened for you).',
    'p.reset': 'Delete collected data',
    'p.fetchingProfiles': 'Fetching names and photos…',
    'p.listing': 'Listing your followers…',
    'p.checking': 'Checking who follows whom…',
    'p.paused': 'Paused.',
    'p.cooldown': (time) => `Waiting for Instagram — resumes at ${time}.`,
    'p.done': 'Done.',
    'p.stopped': 'Stopped.',
    'p.pitch': 'Maps who among your followers know each other. It takes about an hour per 500 followers, and runs on its own.',
    'p.logInFirst': 'Log in to Instagram in this browser first. It uses your own session.',
    'p.listingCount': (n) => `listing… ${n}`,
    'p.atLeast': (d) => `at least ${d}`,
    'p.measuredTitle': 'From the pace so far, including the times Instagram made the crawl wait.',
    'p.floorTitle': 'Not enough followers checked yet to measure the pace; this is the minimum at the current delay.',
    'p.confirmRestart': 'Discard the current graph and crawl again?',
    'p.confirmReset': 'Delete everything collected so far?',
    'p.noOwner': 'the crawl does not say whose graph it is',

    'x.title': 'Explore the graph',
    'x.intro': 'Ask the shared graphs anything. Everything runs in this page; nothing is uploaded. ',
    'x.back': 'Back to the graph',
    'x.graphs': 'Graphs',
    'x.ownersPlaceholder': 'usernames, separated by commas: sebas.favaron, nachonnc',
    'x.load': 'Load',
    'x.loading': 'Loading…',
    'x.loaded': (people, follows, ms) => `${people} people · ${follows} follows · ${ms} ms`,
    'x.question': 'Question',
    'x.caveat':
      'Each crawl only sees follows among its owner\'s own people. A follow between two people who share no loaded circle is missing from the data, so "none found" there means "can\'t see".',
    'x.sqlSummary': 'SQL behind this question ',
    'x.sqlHint': '· edit it to ask your own',
    'x.run': 'Run',
    'x.runTitle': 'Run (Ctrl+Enter)',
    'x.sqlNote': 'SQLite · Ctrl+Enter runs',
    'x.owners': 'whose graphs are loaded; position 0 is the first',
    'x.people': 'everyone in any loaded graph',
    'x.follows': 'source follows target',
    'x.circles': 'username follows the owner, or the owner follows them',
    'x.edges': 'view: follows in both directions, for paths',
    'x.ownSql': 'Your own SQL',
    'x.rows': (n) => `${n} ${n === 1 ? 'row' : 'rows'}`,
    'x.firstShown': (n) => ` (first ${n} shown)`,
    'x.noRows': 'No rows',
    'x.couldNotLoad': (msg) => `Could not load: ${msg}`,
    'x.typeOwners': 'Type one or more usernames whose graphs were shared.',
    'x.tooMany': (n) => `At most ${n} graphs at once.`,
    'x.openIg': (u) => `Open @${u} on Instagram`,
    'x.sqlFailed': 'SQLite did not download',
    'x.q.mostFollowed': 'Most followed people in these graphs',
    'x.q.noFollowBack': 'Who {0} follows that does not follow back',
    'x.q.mostConnected': 'Most connected people inside each circle',
    'x.q.moreThanOne': 'People in more than one circle',
    'x.q.eachOther': 'Do {a} and {b} follow each other?',
    'x.q.inBoth': "In both {a}'s and {b}'s circles, and whether {0} knows them",
    'x.q.paths': 'Paths from {a} to {b} that avoid {0} (up to 3 steps)',
  },
};
for (const l of Object.keys(STRINGS)) Object.assign(STRINGS[l], POPUP_AND_EXPLORE[l]);

// The EN/ES button on each page: shows the language it switches to.
export function langButton(button, onChange) {
  const paint = () => {
    button.textContent = t('langButton');
    button.setAttribute('aria-label', t('langLabel'));
    button.title = t('langLabel');
  };
  paint();
  button.onclick = () => {
    setLang(lang === 'es' ? 'en' : 'es');
    paint();
    onChange();
  };
}

export const LANGS = Object.keys(STRINGS);

function saved() {
  try {
    const value = localStorage.getItem('lang');
    return LANGS.includes(value) ? value : null;
  } catch (_) {
    return null;
  }
}

export let lang = saved() || 'es';

export function t(key, ...args) {
  const value = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

export function setLang(next) {
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem('lang', next);
  } catch (_) {}
}

const ATTRIBUTES = ['title', 'placeholder', 'aria-label'];
export function translateStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const attr of ATTRIBUTES) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
  }
}

// every key in one language is in the other (tests read this)
export const _strings = STRINGS;

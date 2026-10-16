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
    exploreTitle: 'Hacerle preguntas a estos grafos en SQL, en una pestaña nueva',
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
    exploreTitle: 'Ask these graphs questions in SQL, in a new tab',
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

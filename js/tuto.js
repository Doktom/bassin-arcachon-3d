// Tutoriel de prise en main : 5 étapes, passable à tout moment, mémorisé dans le navigateur.
const KEY = 'bassin3d-tuto-v1';
const touch = matchMedia('(pointer: coarse)').matches;
const STEPS = [
  { title: 'Bienvenue sur le Bassin', text: 'Une carte 3D de l’eau, des crassats et du balisage du Bassin d’Arcachon, entre forêt de pins et Dune du Pilat. Petit tour en 30 secondes ?', next: 'C’est parti' },
  { title: 'Se déplacer', text: touch
      ? '<b>Un doigt</b> pour se déplacer, <b>deux doigts</b> pour zoomer et pivoter. <b>Touchez</b> l’eau pour connaître la profondeur.'
      : '<b>Glisser</b> pour se déplacer, <b>clic droit</b> pour pivoter, <b>molette</b> pour zoomer. <b>Cliquez</b> sur l’eau pour connaître la profondeur.' },
  { title: 'Jouer avec la marée', target: '#tidebar', text: 'Faites glisser le point sur la courbe : à marée basse, les crassats découvrent. <b>▶</b> anime une marée complète.' },
  { title: 'Chercher et découvrir', target: '#topbar .search', text: 'Un crassat, un chenal, un port… ou un lieu à découvrir : la Dune du Pilat, les cabanes tchanquées, les Passes.' },
  { title: 'Calques et fonds de carte', target: '#layers-btn', text: 'Carte marine, photo aérienne, balisage, forêts… tout se règle ici. Le bouton <b>?</b> relance ce tutoriel.', next: 'Explorer' },
];

export function initTuto({ onClose } = {}) {
  const root = document.getElementById('tuto'), spot = document.getElementById('tuto-spot'), card = document.getElementById('tuto-card');
  const $t = (id) => document.getElementById(id);
  let i = 0;
  const dots = $t('tuto-dots'); dots.innerHTML = STEPS.map(() => '<i></i>').join('');

  function place() {
    const s = STEPS[i];
    $t('tuto-step').textContent = `${i + 1} / ${STEPS.length}`;
    $t('tuto-title').textContent = s.title;
    $t('tuto-text').innerHTML = s.text;
    $t('tuto-next').textContent = s.next || 'Suivant';
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    const el = s.target && document.querySelector(s.target);
    const cw = card.offsetWidth, ch = card.offsetHeight, m = 14;
    if (!el) {
      spot.className = 'center'; spot.style.cssText = '';
      card.style.left = `${(innerWidth - cw) / 2}px`; card.style.top = `${(innerHeight - ch) / 2}px`;
      return;
    }
    const r = el.getBoundingClientRect(), pad = 8;
    spot.className = 'ring';
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    let x, y;
    if (r.left > innerWidth * 0.6 && r.width < 120) { x = r.left - cw - 22; y = r.top - 10; }        // cible à droite : carte à gauche
    else if (r.bottom + ch + 24 < innerHeight) { x = r.left; y = r.bottom + 18; }                       // dessous
    else { x = r.left + r.width / 2 - cw / 2; y = r.top - ch - 18; }                                     // dessus
    card.style.left = `${Math.min(Math.max(x, m), innerWidth - cw - m)}px`;
    card.style.top = `${Math.min(Math.max(y, m), innerHeight - ch - m)}px`;
  }
  function close() {
    root.hidden = true; removeEventListener('resize', place); removeEventListener('keydown', key);
    try { localStorage.setItem(KEY, '1'); } catch {}
    onClose?.();
  }
  function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' || e.key === 'Enter') next(); else if (e.key === 'ArrowLeft' && i > 0) { i--; place(); } }
  function next() { if (++i >= STEPS.length) close(); else place(); }
  $t('tuto-next').onclick = next;
  $t('tuto-skip').onclick = close;

  return {
    open() { i = 0; root.hidden = false; requestAnimationFrame(place); addEventListener('resize', place); addEventListener('keydown', key); $t('tuto-next').focus({ preventScroll: true }); },
    seen() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } },
  };
}

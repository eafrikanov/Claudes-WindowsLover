import { WEAPONS, SLOT_WEAPONS } from './weapons.js';
import { ICONS, WEAPON_ICONS } from './icons.js';

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Hud {
  constructor() {
    this.el = {
      root: $('hud'), hp: $('hp-fill'), hpText: $('hp-text'), ammo: $('ammo-cur'), ammoMax: $('ammo-max'),
      wname: $('weapon-name'), slots: $('slots'), feed: $('killfeed'), timer: $('timer'), score: $('score-top'),
      cross: $('crosshair'), hit: $('hitmarker'), scope: $('scope'), vignette: $('vignette'), dmg: $('dmg-indicators'),
      death: $('death'), deathBy: $('death-by'), deathTimer: $('death-timer'), board: $('scoreboard'), boardBody: $('scoreboard-body'),
      toast: $('toast'), reload: $('reload-bar'), reloadFill: $('reload-fill'), pickupHint: $('pickup-hint'), clickHint: $('click-hint'),
      fps: $('fps'),
    };
    for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon];
    this.el.wicon = $('weapon-icon');
    $('nade-icon').innerHTML = WEAPON_ICONS.grenade;
    this.el.nades = $('nade-count');
    this.el.slots.innerHTML = SLOT_WEAPONS.map((w, i) => `<div class="slot" data-i="${i}" title="${w.name}"><span class="key">${w.key}</span><span class="wicon">${WEAPON_ICONS[w.id]}</span></div>`).join('');
    this.hitT = 0;
    this.toastT = 0;
    this.indicators = [];
  }

  show(v) {
    this.el.root.classList.toggle('hidden', !v);
  }

  health(hp) {
    const k = Math.max(0, hp) / 100;
    this.el.hp.style.transform = `scaleX(${k})`;
    this.el.hp.classList.toggle('low', hp <= 30);
    this.el.hpText.textContent = Math.max(0, Math.ceil(hp));
    this.el.vignette.style.opacity = hp <= 30 ? String(0.25 + (30 - hp) / 60) : '0';
  }

  weapon(i, ammo) {
    const w = WEAPONS[i];
    this.el.wname.textContent = `${w.name} · ${w.kind}`;
    if (this.el.wicon.dataset.id !== w.id) {
      this.el.wicon.dataset.id = w.id;
      this.el.wicon.innerHTML = WEAPON_ICONS[w.id];
    }
    this.el.ammo.textContent = w.mag ? ammo : '∞';
    this.el.ammoMax.textContent = w.mag || '∞';
    this.el.ammo.classList.toggle('low', !!w.mag && ammo <= Math.ceil(w.mag * 0.25));
    for (const s of this.el.slots.children) s.classList.toggle('active', Number(s.dataset.i) === i);
  }

  crosshair(spread, visible) {
    const gap = 6 + spread * 900;
    this.el.cross.style.setProperty('--gap', `${Math.min(60, gap)}px`);
    this.el.cross.style.opacity = visible ? '1' : '0';
  }

  hitmarker(head, kill) {
    this.el.hit.className = `show${head ? ' head' : ''}${kill ? ' kill' : ''}`;
    this.hitT = 0.18;
  }

  scope(v) {
    this.el.scope.classList.toggle('show', v);
  }

  reloadProgress(k) {
    this.el.reload.classList.toggle('show', k >= 0);
    if (k >= 0) this.el.reloadFill.style.transform = `scaleX(${k})`;
  }

  damageFrom(angle) {
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${angle}rad)`;
    this.el.dmg.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  flashDamage() {
    this.el.vignette.classList.remove('hurt');
    void this.el.vignette.offsetWidth;
    this.el.vignette.classList.add('hurt');
  }

  kill(killer, victim, weapon, head, local) {
    const row = document.createElement('div');
    row.className = `kf${local ? ' me' : ''}`;
    const w = WEAPONS[weapon];
    row.innerHTML = `<span style="color:${killer.color}">${esc(killer.name)}</span><span class="wicon">${w ? WEAPON_ICONS[w.id] : ''}</span>${head ? `<span class="ico">${ICONS.head}</span>` : ''}<span style="color:${victim.color}">${esc(victim.name)}</span>`;
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 5600);
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastT = 1.6;
  }

  clock(left) {
    const s = Math.max(0, Math.ceil(left));
    this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.timer.classList.toggle('low', s <= 30);
  }

  topScore(html) {
    this.el.score.innerHTML = html;
  }

  death(show, by, left) {
    this.el.death.classList.toggle('show', show);
    if (by !== undefined) this.el.deathBy.innerHTML = by;
    if (left !== undefined) this.el.deathTimer.textContent = left > 0 ? `Возрождение через ${Math.ceil(left)}…` : 'Возрождение…';
  }

  grenades(n) {
    this.el.nades.textContent = n;
    this.el.nades.parentElement.classList.toggle('empty', n <= 0);
  }

  showFps(v) {
    this.el.fps.classList.toggle('hidden', !v);
  }

  fps(n) {
    this.el.fps.textContent = `${n} FPS`;
  }

  clickHint(v) {
    this.el.clickHint.classList.toggle('show', v);
  }

  pickupHint(v) {
    this.el.pickupHint.classList.toggle('show', v);
  }

  scoreboard(show, roster, localId, teams, teamScores) {
    this.el.board.classList.toggle('show', show);
    if (!show) return;
    const rows = [...roster].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const line = (p) => `<tr class="${p.id === localId ? 'me' : ''}${p.alive ? '' : ' dead'}"><td><i style="background:${p.color}"></i>${esc(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`;
    if (teams) {
      this.el.boardBody.innerHTML = [0, 1].map((t) => `<tr class="team t${t}"><td>${t ? 'Красные' : 'Синие'}</td><td colspan="2">${teamScores[t]}</td></tr>${rows.filter((p) => p.team === t).map(line).join('')}`).join('');
    } else {
      this.el.boardBody.innerHTML = rows.map(line).join('');
    }
  }

  update(dt) {
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.el.hit.className = '';
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el.toast.classList.remove('show');
    }
  }
}

export { esc };

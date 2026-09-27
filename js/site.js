(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const num = v => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Easing curves ported from Webflow IX2 so motion matches the original.
  const easings = {
    '': t => t,
    outQuart: t => -(Math.pow(t - 1, 4) - 1),
    inQuart: t => Math.pow(t, 4),
    outBounce: t => t < 1 / 2.75 ? 7.5625 * t * t
      : t < 2 / 2.75 ? 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
        : t < 2.5 / 2.75 ? 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
          : 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375,
    outElastic: t => {
      if (t === 0 || t === 1) return t;
      const p = 0.3, s = p / (2 * Math.PI) * Math.asin(1);
      return Math.pow(2, -10 * t) * Math.sin(2 * Math.PI * (t - s) / p) + 1;
    },
  };
  const ease = (name, t) => (t <= 0 ? 0 : t >= 1 ? 1 : (easings[name || ''] || easings[''])(t));
  const lerp = (a, b, t) => Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * t) : a + (b - a) * t;

  // Transform parts are tracked separately and composed in Webflow's order.
  const states = new WeakMap();
  const stateOf = el => {
    let s = states.get(el);
    if (!s) {
      s = { move: [0, 0, 0], moveUnits: ['px', 'px', 'px'], scale: [1, 1, 1], rotate: [0, 0, 0], tweens: new Map() };
      states.set(el, s);
    }
    return s;
  };
  const renderTransform = (el, s) => {
    const [x, y, z] = s.move, [ux, uy, uz] = s.moveUnits;
    el.style.transform = `translate3d(${x}${ux}, ${y}${uy}, ${z}${uz}) scale3d(${s.scale.join(', ')}) ` +
      `rotateX(${s.rotate[0]}deg) rotateY(${s.rotate[1]}deg) rotateZ(${s.rotate[2]}deg)`;
    el.style.transformStyle = 'preserve-3d';
  };

  const channels = {
    STYLE_OPACITY: {
      from: el => parseFloat(getComputedStyle(el).opacity),
      to: item => item.value,
      apply: (el, v) => { el.style.opacity = v; },
    },
    TRANSFORM_MOVE: {
      from: el => stateOf(el).move.slice(),
      to: (item, el) => {
        stateOf(el).moveUnits = [item.xUnit, item.yUnit, item.zUnit].map(u => (u || 'px').toLowerCase());
        return [item.xValue ?? 0, item.yValue ?? 0, item.zValue ?? 0];
      },
      apply: (el, v) => { const s = stateOf(el); s.move = v; renderTransform(el, s); },
    },
    TRANSFORM_SCALE: {
      from: el => stateOf(el).scale.slice(),
      to: item => [item.xValue ?? 1, item.yValue ?? 1, item.zValue ?? 1],
      apply: (el, v) => { const s = stateOf(el); s.scale = v; renderTransform(el, s); },
    },
    TRANSFORM_ROTATE: {
      from: el => stateOf(el).rotate.slice(),
      to: item => [item.xValue ?? 0, item.yValue ?? 0, item.zValue ?? 0],
      apply: (el, v) => { const s = stateOf(el); s.rotate = v; renderTransform(el, s); },
    },
    STYLE_BACKGROUND_COLOR: {
      from: el => {
        const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [255, 255, 255];
        return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
      },
      to: item => [item.rValue, item.gValue, item.bValue, item.aValue ?? 1],
      apply: (el, v) => { el.style.backgroundColor = `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${v[3]})`; },
    },
    GENERAL_DISPLAY: {
      discrete: true,
      to: item => item.value,
      apply: (el, v) => { el.style.display = v; },
    },
    PLUGIN_LOTTIE: {
      from: el => lottieProgress(el),
      to: item => item.value / 100,
      apply: (el, v) => lottieSeek(el, v),
    },
  };

  // A newer tween on the same element + channel replaces the running one.
  const tween = (el, item, duration) => new Promise(resolve => {
    const ch = channels[item.type];
    if (!ch) return resolve();
    const s = stateOf(el);
    const running = s.tweens.get(item.type);
    if (running) running.cancel();
    const to = ch.to(item, el);
    // Lottie playback isn't reduced, matching Webflow's player.
    const ms = reducedMotion.matches && item.type !== 'PLUGIN_LOTTIE' ? 0 : duration;
    if (ch.discrete || !(ms > 0)) { ch.apply(el, to); return resolve(); }
    const from = ch.from(el);
    const start = performance.now();
    let raf, done = false;
    const finish = () => { if (done) return; done = true; s.tweens.delete(item.type); resolve(); };
    const step = now => {
      const t = Math.min(1, (now - start) / ms);
      ch.apply(el, lerp(from, to, ease(item.easing, t)));
      if (t < 1) raf = requestAnimationFrame(step); else finish();
    };
    s.tweens.set(item.type, { cancel: () => { cancelAnimationFrame(raf); finish(); } });
    raf = requestAnimationFrame(step);
  });

  // Lottie: same attribute semantics as Webflow's player, plus pause while offscreen.
  const lotties = new Map();
  const whenLottieLoaded = el => new Promise(resolve => {
    if (!lotties.has(el)) loadLottie(el);
    const rec = lotties.get(el);
    if (!rec) return;
    if (rec.loaded) resolve(rec); else rec.waiters.push(resolve);
  });
  const lottieProgress = el => {
    const rec = lotties.get(el);
    return rec && rec.loaded ? rec.anim.currentFrame / Math.max(1, rec.anim.totalFrames) : 0;
  };
  const lottieSeek = (el, p) => whenLottieLoaded(el).then(rec => rec.anim.goToAndStop(p * rec.anim.totalFrames, true));

  const offscreenObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      const rec = lotties.get(e.target);
      if (!rec) continue;
      rec.offscreen = !e.isIntersecting;
      if (!rec.loaded) continue;
      if (rec.offscreen) {
        if (!rec.anim.isPaused) { rec.resume = true; rec.anim.pause(); }
      } else if (rec.pendingPlay) {
        rec.pendingPlay = false;
        rec.play();
      } else if (rec.resume) {
        rec.resume = false;
        rec.anim.play();
      }
    }
  });

  function loadLottie(el) {
    if (lotties.has(el) || !window.lottie) return;
    const d = el.dataset;
    const ixDriven = num(d.isIx2Target) === 1;
    const rec = { loaded: false, waiters: [], offscreen: false };
    lotties.set(el, rec);
    rec.anim = window.lottie.loadAnimation({
      container: el,
      path: d.src,
      renderer: d.renderer || 'svg',
      loop: num(d.loop) === 1,
      autoplay: false,
      rendererSettings: { preserveAspectRatio: d.preserveAspectRatio || 'xMidYMid meet', progressiveLoad: true, hideOnTransparent: true },
    });
    rec.anim.setSubframe(true);
    rec.play = () => rec.anim.goToAndPlay(rec.anim.playDirection === 1 ? 0 : rec.anim.totalFrames, true);
    rec.anim.addEventListener('DOMLoaded', () => {
      rec.loaded = true;
      if (ixDriven) {
        rec.anim.goToAndStop(0, true);
      } else {
        rec.anim.setDirection(num(d.direction) === -1 ? -1 : 1);
        const want = num(d.duration), natural = rec.anim.getDuration(false);
        if (want > 0 && want !== natural) rec.anim.setSpeed(natural / want);
        if (num(d.autoplay) === 1) {
          if (rec.offscreen) rec.pendingPlay = true; else rec.play();
        }
      }
      rec.waiters.splice(0).forEach(fn => fn(rec));
    });
    offscreenObserver.observe(el);
  }

  function initLotties() {
    const els = document.querySelectorAll('[data-animation-type="lottie"]');
    if (!els.length || !window.lottie) return;
    const conn = navigator.connection && navigator.connection.effectiveType;
    const rootMargin = conn === 'slow-2g' || conn === '2g' ? '300% 0%' : conn === '3g' ? '250% 0%' : '150% 0%';
    const lazy = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { lazy.unobserve(e.target); loadLottie(e.target); }
    }), { rootMargin });
    els.forEach(el => (el.dataset.loading === 'lazy' ? lazy.observe(el) : loadLottie(el)));
  }

  // "auto" lottie duration = the element's data-duration, else the file's length.
  const lottieAutoDuration = (el, rec) => {
    const d = num(el.dataset.duration) || num(el.dataset.defaultDuration);
    return d > 0 ? d * 1000 : rec.anim.getDuration(false) * 1000;
  };

  // Interactions: replays the page's exported Webflow IX2 events.
  const ixNode = document.getElementById('ix-data');
  const ix = ixNode ? JSON.parse(ixNode.textContent) : null;

  const byWid = id => [...document.querySelectorAll(`[data-w-id="${id}"], [data-w-id^="${id}_instance"]`)];
  const eventElements = ev => ev.targets.flatMap(t => {
    if (t.appliesTo === 'PAGE') return [document.documentElement];
    if (t.id) return byWid(t.id);
    return t.selector ? [...document.querySelectorAll(t.selector)] : [];
  });

  const affected = (item, triggerEl) => {
    const tg = item.target || {};
    if (tg.useEventTarget === true || tg.appliesTo === 'TRIGGER_ELEMENT') return [triggerEl];
    if (tg.useEventTarget === 'CHILDREN') return [...triggerEl.querySelectorAll(tg.selector)];
    if (tg.useEventTarget === 'SIBLINGS') {
      const parent = triggerEl.parentElement;
      return parent ? [...parent.children].filter(n => n !== triggerEl && n.matches(tg.selector)) : [];
    }
    if (tg.id) return byWid(tg.id);
    return tg.selector ? [...document.querySelectorAll(tg.selector)] : [triggerEl];
  };

  const runItem = async (item, el) => {
    if (item.type !== 'PLUGIN_LOTTIE') return tween(el, item, item.duration);
    const rec = await whenLottieLoaded(el);
    return tween(el, item, item.duration === 'auto' ? lottieAutoDuration(el, rec) : item.duration);
  };

  // Restarting an event on an element invalidates its previous run.
  const runs = new WeakMap();
  const claimRun = (listId, el) => {
    let m = runs.get(el);
    if (!m) runs.set(el, (m = new Map()));
    const token = {};
    m.set(listId, token);
    return () => m.get(listId) === token;
  };
  const stopRun = (listId, el) => { const m = runs.get(el); if (m) m.delete(listId); };

  const applyInitial = (list, triggerEl) => {
    for (const item of list.groups[0]) {
      const ch = channels[item.type];
      if (ch) affected(item, triggerEl).forEach(el => ch.apply(el, ch.to(item, el)));
    }
  };

  const playList = async (ev, triggerEl) => {
    const list = ix.lists[ev.list];
    if (!list || !list.groups) return;
    const alive = claimRun(ev.list, triggerEl);
    // Quick-effect presets use the event's delay as a start delay.
    const delay = ev.action.endsWith('_EFFECT') ? ev.config.delay || 0 : 0;
    if (delay && !reducedMotion.matches) { await wait(delay); if (!alive()) return; }
    for (const group of list.groups.slice(list.initial ? 1 : 0)) {
      if (!alive()) return;
      await Promise.all(group.flatMap(item => affected(item, triggerEl).map(async el => {
        if (item.delay && !reducedMotion.matches) await wait(item.delay);
        if (alive()) await runItem(item, el);
      })));
    }
  };

  const inView = (el, ev) => {
    const r = el.getBoundingClientRect();
    const vh = document.documentElement.clientHeight, vw = document.documentElement.clientWidth;
    const v = ev.config.scrollOffsetValue || 0;
    const off = ev.config.scrollOffsetUnit === 'PX' ? v : vh * v / 100;
    return !(r.left > vw || r.right < 0 || r.top > vh - off || r.bottom < off);
  };

  function scrollProgress(c) {
    const r = c.el.getBoundingClientRect();
    const vh = document.documentElement.clientHeight, sh = document.documentElement.scrollHeight;
    let start = (c.cfg.addStartOffset ? c.cfg.addOffsetValue || 0 : 0) / 100;
    let end = (c.cfg.addEndOffset ? c.cfg.endOffsetValue || 0 : 0) / 100;
    start = c.cfg.startsEntering ? start : 1 - start;
    end = c.cfg.startsExiting ? end : 1 - end;
    const top = r.top + Math.min(r.height * start, vh);
    const span = Math.min(vh + (r.top + r.height * end - top), sh);
    return Math.min(Math.max(0, vh - top), span) / span;
  }

  function renderContinuous(c) {
    const pct = c.pos * 100;
    let a = c.frames[0], b = null, t = 0;
    for (let i = 0; i < c.frames.length; i++) {
      if (pct < c.frames[i].keyframe) continue;
      a = c.frames[i];
      b = c.frames[i + 1] || null;
      t = b ? (pct - a.keyframe) / (b.keyframe - a.keyframe) : 0;
    }
    a.items.forEach((item, i) => {
      const ch = channels[item.type];
      if (!ch) return;
      affected(item, c.el).forEach(el => {
        const from = ch.to(item, el);
        ch.apply(el, b && b.items[i] ? lerp(from, ch.to(b.items[i], el), ease(item.easing, t)) : from);
      });
    });
  }

  function initInteractions() {
    if (!ix) return;
    document.documentElement.classList.add('w-mod-ix');
    const w = window.innerWidth;
    const mq = (ix.mq.find(q => w >= q.min && w <= q.max) || { key: 'main' }).key;
    const active = new Map();
    for (const ev of Object.values(ix.events)) {
      const els = eventElements(ev);
      if (!ev.mq.includes(mq)) {
        // Animation disabled at this breakpoint: show the element as-is.
        els.forEach(el => { if (el.style.opacity === '0') el.style.opacity = ''; });
        continue;
      }
      active.set(ev.id, { ev, els });
      const list = ix.lists[ev.list];
      if (list && list.initial && list.groups) els.forEach(el => applyInitial(list, el));
    }

    const watchers = [], continuous = [];
    for (const { ev, els } of active.values()) {
      if (ev.type === 'PAGE_START') els.forEach(el => playList(ev, el));
      else if (ev.type === 'SCROLL_INTO_VIEW' || ev.type === 'SCROLL_OUT_OF_VIEW') els.forEach(el => watchers.push({ ev, el, visible: undefined, fired: false }));
      else if (ev.type === 'SCROLLING_IN_VIEW') {
        const cfg = Array.isArray(ev.config) ? ev.config[0] : ev.config;
        const frames = ix.lists[ev.list].continuous[cfg.continuousParameterGroupId];
        els.forEach(el => continuous.push({ ev, el, cfg, frames, pos: null, target: null }));
      } else if (ev.type === 'MOUSE_OVER' || ev.type === 'MOUSE_OUT') {
        els.forEach(el => el.addEventListener(ev.type === 'MOUSE_OVER' ? 'mouseenter' : 'mouseleave', () => {
          if (ev.autoStop && active.has(ev.autoStop)) stopRun(active.get(ev.autoStop).ev.list, el);
          playList(ev, el);
        }));
      }
    }

    // IX2 semantics: nothing fires on the very first check unless the element is
    // visible; events with an autoStop partner replay on every flip, others fire once.
    const check = () => {
      for (const s of watchers) {
        const vis = inView(s.el, s.ev);
        const first = s.visible === undefined;
        if (vis === s.visible || (first && !vis)) { s.visible = vis; continue; }
        s.visible = vis;
        if (vis !== (s.ev.type === 'SCROLL_INTO_VIEW')) continue;
        if (s.fired && !s.ev.autoStop) continue;
        s.fired = true;
        if (s.ev.autoStop && active.has(s.ev.autoStop)) stopRun(active.get(s.ev.autoStop).ev.list, s.el);
        playList(s.ev, s.el);
      }
      continuous.forEach(c => { c.target = scrollProgress(c); if (c.pos === null) { c.pos = c.target; renderContinuous(c); } });
    };

    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; check(); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Fonts/images shift layout during load and can bring elements into view without
    // a scroll event, so keep re-checking every frame until the page has settled.
    let settleUntil = Infinity;
    const settle = () => { check(); if (performance.now() < settleUntil) requestAnimationFrame(settle); };
    const markLoaded = () => { settleUntil = performance.now() + 2000; };
    if (document.readyState === 'complete') markLoaded(); else window.addEventListener('load', markLoaded, { once: true });
    settle();

    if (continuous.length) {
      const smooth = () => {
        for (const c of continuous) {
          const k = reducedMotion.matches ? 1 : Math.max(1 - (c.cfg.smoothing || 0) / 100, 0.01);
          const next = c.pos + (c.target - c.pos) * k;
          if (Math.abs(next - c.pos) < 1e-5) continue;
          c.pos = Math.abs(c.target - next) < 1e-4 ? c.target : next;
          renderContinuous(c);
        }
        requestAnimationFrame(smooth);
      };
      requestAnimationFrame(smooth);
    }
  }

  // Navbar: collapses at <=991px; the menu slides down into an overlay.
  function initNavbars() {
    document.querySelectorAll('.w-nav').forEach((nav, idx) => {
      const menu = nav.querySelector('.w-nav-menu');
      const button = nav.querySelector('.w-nav-button');
      if (!menu || !button) return;
      const duration = num(nav.dataset.duration ?? 400);
      const easeIn = nav.dataset.easing || 'ease', easeOut = nav.dataset.easing2 || 'ease';
      const overlay = document.createElement('div');
      overlay.className = 'w-nav-overlay';
      overlay.id = 'w-nav-overlay-' + idx;
      nav.appendChild(overlay);
      const home = { parent: menu.parentNode, next: menu.nextSibling };
      const links = menu.querySelectorAll('.w-nav-link');
      let open = false, closeTimer = null;

      Object.entries({ role: 'button', tabindex: '0', 'aria-controls': overlay.id, 'aria-haspopup': 'menu', 'aria-expanded': 'false' })
        .forEach(([k, v]) => button.setAttribute(k, v));
      if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'menu');

      const offY = () => -(nav.offsetHeight + menu.offsetHeight);
      const overlayHeight = () => document.body.offsetHeight - (getComputedStyle(nav).position === 'fixed' ? 0 : nav.offsetHeight);
      const finishClose = () => {
        menu.style.transition = '';
        menu.style.transform = '';
        menu.removeAttribute('data-nav-menu-open');
        links.forEach(l => l.classList.remove('w--nav-link-open'));
        home.parent.insertBefore(menu, home.next);
        overlay.removeAttribute('style');
        button.setAttribute('aria-expanded', 'false');
      };
      const setOpen = (want, instant) => {
        if (want === open) return;
        open = want;
        clearTimeout(closeTimer);
        if (open) {
          menu.setAttribute('data-nav-menu-open', '');
          links.forEach(l => l.classList.add('w--nav-link-open'));
          button.classList.add('w--open');
          overlay.style.display = 'block';
          overlay.style.height = overlayHeight() + 'px';
          overlay.appendChild(menu);
          button.setAttribute('aria-expanded', 'true');
          if (instant || duration <= 0) return;
          menu.style.transition = 'none';
          menu.style.transform = `translateY(${offY()}px)`;
          menu.getBoundingClientRect();
          menu.style.transition = `transform ${duration}ms ${easeIn}`;
          menu.style.transform = 'translateY(0px)';
        } else {
          button.classList.remove('w--open');
          if (instant || duration <= 0) return finishClose();
          menu.style.transition = `transform ${duration}ms ${easeOut}`;
          menu.style.transform = `translateY(${offY()}px)`;
          closeTimer = setTimeout(finishClose, duration);
        }
      };

      button.addEventListener('click', () => setOpen(!open));
      button.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); }
      });
      nav.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); button.focus(); } });
      menu.addEventListener('click', e => {
        const a = e.target.closest('a');
        if (a && (a.getAttribute('href') || '').startsWith('#')) setOpen(false);
      });
      document.addEventListener('click', e => {
        if (open && !menu.contains(e.target) && !button.contains(e.target)) setOpen(false);
      });
      window.addEventListener('resize', () => {
        if (!open) return;
        if (getComputedStyle(button).display === 'none') setOpen(false, true);
        else overlay.style.height = overlayHeight() + 'px';
      });
    });
  }

  // Sliders: slide / cross-fade, arrows, dots, autoplay, infinite wrap, swipe.
  function initSliders() {
    document.querySelectorAll('.w-slider').forEach((slider, idx) => {
      const mask = slider.querySelector(':scope > .w-slider-mask');
      if (!mask) return;
      const slides = [...mask.querySelectorAll(':scope > .w-slide')];
      const left = slider.querySelector(':scope > .w-slider-arrow-left');
      const right = slider.querySelector(':scope > .w-slider-arrow-right');
      const nav = slider.querySelector(':scope > .w-slider-nav');
      const d = slider.dataset;
      const truthy = v => v === '1' || v === 'true';
      const cross = d.animation === 'outin' || d.animation === 'cross';
      const cfg = {
        crossOver: d.animation === 'outin' ? 0.5 : 0,
        easing: d.easing || 'ease',
        duration: d.duration != null ? parseInt(d.duration, 10) : 500,
        infinite: truthy(d.infinite),
        autoplay: truthy(d.autoplay),
        delay: parseInt(d.delay, 10) || 2000,
        hideArrows: truthy(d.hideArrows),
      };
      if (!slider.hasAttribute('role')) slider.setAttribute('role', 'region');
      if (!slider.hasAttribute('aria-label')) slider.setAttribute('aria-label', 'carousel');
      if (!mask.id) mask.id = 'w-slider-mask-' + idx;
      const live = document.createElement('div');
      live.className = 'w-slider-aria-label';
      live.setAttribute('aria-live', 'off');
      live.setAttribute('aria-atomic', 'true');
      mask.appendChild(live);
      [[left, 'previous slide'], [right, 'next slide']].forEach(([el, label]) => {
        if (!el) return;
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-controls', mask.id);
        if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', label);
      });
      [...mask.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); });

      let index = 0, depth = 1, timer = null, pending = null, dots = [];
      const width = () => mask.getBoundingClientRect().width;
      const setX = (els, x, transition = 'none') => els.forEach(s => {
        s.style.transition = transition;
        s.style.transform = `translateX(${x}px)`;
      });
      const flush = () => { if (pending) { clearTimeout(pending.t); pending.fn(); pending = null; } };

      const markActive = () => {
        dots.forEach((dot, i) => {
          dot.classList.toggle('w-active', i === index);
          dot.setAttribute('aria-pressed', String(i === index));
          dot.setAttribute('tabindex', i === index ? '0' : '-1');
        });
        slides.forEach((s, i) => {
          s.setAttribute('aria-label', `${i + 1} of ${slides.length}`);
          s.setAttribute('role', 'group');
          if (i === index) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
          s.querySelectorAll('a[href], button, iframe, [tabindex]').forEach(f => (i === index ? f.removeAttribute('tabindex') : f.setAttribute('tabindex', '-1')));
        });
        if (cfg.hideArrows) {
          if (left) left.style.display = index === 0 ? 'none' : '';
          if (right) right.style.display = index === slides.length - 1 ? 'none' : '';
        }
      };

      const layout = () => {
        flush();
        const x = -index * width();
        setX(slides, x);
        if (cross) slides.forEach((s, i) => { s.style.opacity = '1'; s.style.visibility = i === index ? '' : 'hidden'; });
      };

      const go = to => {
        flush();
        const n = slides.length, w = width(), prev = index;
        let wrap = null;
        if (to < 0) { to = n - 1; if (cfg.infinite) wrap = 'back'; }
        else if (to >= n) { to = 0; if (cfg.infinite) wrap = 'forward'; }
        index = to;
        markActive();
        if (index === prev) return;
        live.textContent = `Slide ${index + 1} of ${n}.`;
        const dur = cfg.duration, x = -index * w;

        if (cross) {
          const fade = Math.round(dur - dur * cfg.crossOver), lag = dur - fade;
          const a = slides[prev], b = slides[index];
          a.style.transition = `opacity ${fade}ms ${cfg.easing}`;
          a.style.opacity = '0';
          b.style.transition = 'none';
          b.style.transform = `translateX(${x}px)`;
          b.style.opacity = '0';
          b.style.visibility = '';
          b.style.zIndex = String(depth++);
          b.getBoundingClientRect();
          b.style.transition = `opacity ${fade}ms ${cfg.easing} ${lag}ms`;
          b.style.opacity = '1';
          pending = { t: setTimeout(() => { pending = null; layout(); }, dur), fn: layout };
          return;
        }

        const trans = `transform ${dur}ms ${cfg.easing}`;
        if (!wrap) return setX(slides, x, trans);
        // Infinite wrap: bring the destination in from the far side instead of rewinding.
        const others = slides.filter((_, i) => i !== prev);
        const outgoing = slides[prev];
        setX(others, wrap === 'forward' ? w : -n * w);
        setX([outgoing], -prev * w);
        mask.getBoundingClientRect();
        setX(others, x, trans);
        setX([outgoing], -prev * w + (wrap === 'forward' ? -w : w), trans);
        const settle = () => setX([outgoing], x);
        pending = { t: setTimeout(() => { pending = null; settle(); }, dur), fn: settle };
      };

      const stop = () => { clearTimeout(timer); timer = null; };
      const schedule = () => {
        if (!cfg.autoplay) return;
        stop();
        timer = setTimeout(() => { go(index + 1); schedule(); }, cfg.delay);
      };

      if (nav) {
        nav.innerHTML = '';
        dots = slides.map((_, i) => {
          const dot = document.createElement('div');
          dot.className = 'w-slider-dot';
          Object.entries({ 'aria-label': `Show slide ${i + 1} of ${slides.length}`, role: 'button', tabindex: '-1', 'aria-pressed': 'false' })
            .forEach(([k, v]) => dot.setAttribute(k, v));
          if (d.navSpacing != null) dot.style.margin = `0 ${d.navSpacing}px .5em`;
          dot.addEventListener('click', () => go(i));
          dot.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(i); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); dots[Math.max(i - 1, 0)].focus(); }
            else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); dots[Math.min(i + 1, dots.length - 1)].focus(); }
          });
          nav.appendChild(dot);
          return dot;
        });
      }

      [[left, -1], [right, 1]].forEach(([el, dir]) => {
        if (!el) return;
        el.addEventListener('click', () => go(index + dir));
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); go(index + dir); } });
      });

      const focus = { mouse: false, keyboard: false };
      const setFocus = (kind, on) => {
        focus[kind] = on;
        const any = focus.mouse || focus.keyboard;
        live.setAttribute('aria-live', any ? 'polite' : 'off');
        if (cfg.autoplay) { if (any) stop(); else schedule(); }
      };
      slider.addEventListener('mouseenter', () => setFocus('mouse', true));
      slider.addEventListener('mouseleave', () => setFocus('mouse', false));
      slider.addEventListener('focusin', () => setFocus('keyboard', true));
      slider.addEventListener('focusout', e => { if (!slider.contains(e.relatedTarget)) setFocus('keyboard', false); });
      slider.addEventListener('pointerdown', stop, { once: true });

      if (!truthy(d.disableSwipe)) {
        let lastX = null, swiped = false;
        slider.addEventListener('touchstart', e => { if (e.touches.length === 1) { lastX = e.touches[0].clientX; swiped = false; } }, { passive: true });
        slider.addEventListener('touchmove', e => {
          if (lastX === null || swiped) return;
          const x = e.touches[0].clientX, dx = x - lastX;
          lastX = x;
          if (Math.abs(dx) > Math.min(Math.round(0.04 * window.innerWidth), 40) && String(window.getSelection()) === '') {
            swiped = true;
            go(index + (dx < 0 ? 1 : -1));
          }
        }, { passive: true });
        slider.addEventListener('touchend', () => { lastX = null; });
      }

      layout();
      markActive();
      window.addEventListener('resize', layout);
      schedule();
    });
  }

  // Background videos: fetch sources only near the viewport, autoplay muted, keep the toggle.
  function initVideos() {
    const videos = [...document.querySelectorAll('video')];
    const buttonFor = v => document.querySelector(`.w-background-video--control[aria-controls="${v.id}"]`);
    const showPlaying = (btn, playing) => {
      if (!btn) return;
      const [pause, play] = btn.querySelectorAll(':scope > span');
      if (pause) pause.hidden = !playing;
      if (play) play.hidden = playing;
    };
    const load = v => {
      if (v.dataset.loaded) return;
      v.dataset.loaded = '1';
      v.querySelectorAll('source[data-src]').forEach(s => { s.src = s.dataset.src; s.removeAttribute('data-src'); });
      v.load();
    };
    const play = v => {
      load(v);
      const p = v.play();
      if (p && p.catch) p.catch(() => showPlaying(buttonFor(v), false));
    };
    const wantsPlay = v => v.hasAttribute('data-autoplay') && v.dataset.userPaused !== '1' && !reducedMotion.matches;
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      const v = e.target;
      if (e.isIntersecting) { load(v); if (wantsPlay(v) && v.paused) play(v); }
      else if (!v.paused) v.pause();
    }), { rootMargin: '200px 0px' });
    videos.forEach(v => {
      io.observe(v);
      if (!wantsPlay(v)) showPlaying(buttonFor(v), false);
    });
    document.addEventListener('click', e => {
      const btn = e.target.closest('.w-background-video--control');
      const v = btn && document.getElementById(btn.getAttribute('aria-controls'));
      if (!v) return;
      if (v.paused) { v.dataset.userPaused = '0'; showPlaying(btn, true); play(v); }
      else { v.dataset.userPaused = '1'; v.pause(); showPlaying(btn, false); }
    });
    reducedMotion.addEventListener('change', () => videos.forEach(v => {
      if (wantsPlay(v)) { play(v); showPlaying(buttonFor(v), true); }
      else { v.pause(); showPlaying(buttonFor(v), false); }
    }));
  }

  // In-page anchors: Webflow's smooth-scroll curve, plus deep links from other pages.
  const ID_RE = /^#[a-zA-Z0-9][\w:.-]*$/;
  const findAnchor = hash => {
    if (!ID_RE.test(hash)) return null;
    const id = decodeURIComponent(hash.slice(1));
    return document.getElementById(id) || [...document.querySelectorAll('[id]')].find(el => el.id.toLowerCase() === id.toLowerCase()) || null;
  };
  const headerOffset = () => {
    const h = document.querySelector('header, body > .header, body > .w-nav:not([data-no-scroll])');
    return h && getComputedStyle(h).position === 'fixed' ? h.offsetHeight : 0;
  };
  // Layout position ignoring transforms, so entrance animations don't skew the target.
  const docTop = el => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop; return y; };
  const anchorY = el => Math.max(0, docTop(el) - headerOffset());
  const focusTarget = el => {
    const had = el.hasAttribute('tabindex');
    if (!had) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    if (!had) el.removeAttribute('tabindex');
  };
  function smoothScrollTo(el) {
    const from = window.scrollY, to = anchorY(el);
    if (reducedMotion.matches || from === to) { window.scrollTo(0, to); focusTarget(el); return; }
    const duration = 472.143 * Math.log(Math.abs(from - to) + 125) - 2000;
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / duration);
      const c = p < 0.5 ? 4 * p * p * p : (p - 1) * (2 * p - 2) * (2 * p - 2) + 1;
      window.scrollTo(0, from + (anchorY(el) - from) * c);
      if (p < 1) requestAnimationFrame(step); else focusTarget(el);
    };
    requestAnimationFrame(step);
  }
  function initAnchors() {
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.getAttribute('href') === '#') { e.preventDefault(); return; }
      if (!a.hash || a.host !== location.host || a.pathname.replace(/\.html$|\/$/, '') !== location.pathname.replace(/\.html$|\/$/, '')) return;
      const target = findAnchor(a.hash);
      if (!target) return;
      e.preventDefault();
      if (location.hash !== a.hash) history.pushState({ hash: a.hash }, '', a.hash);
      setTimeout(() => smoothScrollTo(target), 0);
    });

    // Content above a deep-link target (images, lotties) grows while loading; keep re-aligning until it settles.
    const target = location.hash && findAnchor(location.hash);
    if (!target) return;
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    let userMoved = false;
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(t => window.addEventListener(t, () => { userMoved = true; }, { once: true, passive: true }));
    const align = () => { if (!userMoved) window.scrollTo(0, anchorY(target)); };
    align();
    const ro = new ResizeObserver(align);
    ro.observe(document.body);
    const stopAligning = () => setTimeout(() => { align(); ro.disconnect(); }, 1500);
    if (document.readyState === 'complete') stopAligning(); else window.addEventListener('load', stopAligning, { once: true });
  }

  // Pilot count-up stats: same step timing as the jQuery counterUp plugin it replaces.
  function initCounters() {
    const counters = document.querySelectorAll('.counter');
    if (!counters.length) return;
    const run = el => {
      if (reducedMotion.matches) return;
      const text = el.textContent.replace(/,/g, '');
      const comma = /[0-9]+,[0-9]+/.test(el.textContent);
      const decimals = /^[0-9]+\.[0-9]+$/.test(text) ? text.split('.')[1].length : 0;
      const steps = 100, nums = [];
      for (let i = steps; i >= 1; i--) {
        let n = decimals ? (text / steps * i).toFixed(decimals) : parseInt(text / steps * i, 10);
        if (comma) n = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        nums.unshift(n);
      }
      el.textContent = '0';
      const tick = () => { el.textContent = nums.shift(); if (nums.length) setTimeout(tick, 10); };
      setTimeout(tick, 10);
    };
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { io.unobserve(e.target); run(e.target); }
    }));
    counters.forEach(el => io.observe(el));
  }

  const boot = () => {
    initNavbars();
    initSliders();
    initVideos();
    initLotties();
    initInteractions();
    initAnchors();
    initCounters();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

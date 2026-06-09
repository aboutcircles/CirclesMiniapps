/**
 * GSAP-powered animations for the NFT Viewer.
 *
 * All motion lives here so it can be tuned, audited, and tested in one place.
 * Honors `prefers-reduced-motion` by snapping to final state (duration 0)
 * instead of animating.
 *
 * No premium GSAP plugins required — core only.
 */
import { gsap } from 'gsap';

// ---------------------------------------------------------------------------
// Reduced-motion detection (cached, reactive)
// ---------------------------------------------------------------------------

const reducedMotionQuery =
  typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-reduced-motion: reduce)')
    : null;

/**
 * @returns {boolean} true if the user has requested reduced motion.
 */
export function prefersReducedMotion() {
  return Boolean(reducedMotionQuery?.matches);
}

// ---------------------------------------------------------------------------
// Animation constants — tweak these to retune the whole experience
// ---------------------------------------------------------------------------

const EASE = {
  out: 'power2.out',
  outStrong: 'power3.out',
  in: 'power2.in',
  inOut: 'power2.inOut',
  backOut: 'back.out(1.7)',
  backIn: 'back.in(1.7)',
  sine: 'sine.inOut',
};

const DUR = {
  fast: 0.3,
  base: 0.6,
  slow: 0.9,
  morph: 0.7,
};

const STAGGER = {
  card: 0.1,
  info: 0.08,
};

// ---------------------------------------------------------------------------
// Demo mode (?demo or ?animate in URL) — ignore reduced-motion and use
// even longer durations. Useful for verifying the system is alive.
// ---------------------------------------------------------------------------

const isDemoMode =
  typeof window !== 'undefined' &&
  /(?:[?&])(?:demo|animate)(?:=|$)/.test(window.location.search);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Apply reduced-motion override if the user prefers it.
 * Returns a new vars object — does not mutate the input.
 * Skipped in demo mode (?demo / ?animate) for diagnostic clarity.
 */
function adjustForReducedMotion(vars) {
  if (isDemoMode) return vars;
  if (!prefersReducedMotion()) return vars;
  return { ...vars, duration: 0, delay: 0 };
}

/**
 * The image-morph (card → detail) was removed — it was glitching in
 * practice. The detail view now appears instantly; only the info rows
 * stagger in.
 */

/**
 * Convert a NodeList / array / single element to a plain array for gsap.
 */
function toArray(target) {
  if (!target) return [];
  if (Array.isArray(target)) return target;
  if (typeof target.length === 'number') return Array.from(target);
  return [target];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new animator instance.
 *
 * The returned object owns the GSAP tweens it creates. Calling `kill()`
 * stops every active tween (timelines, the Gnosis pulse, in-flight morphs).
 */
export function createAnimator() {
  /** @type {Set<gsap.core.Tween | gsap.core.Timeline>} */
  const tweens = new Set();

  /** Track a tween/timeline so we can kill it later. */
  function track(anim) {
    if (!anim) return anim;
    tweens.add(anim);
    // Auto-untrack on completion so the Set doesn't grow forever.
    const origOnComplete = anim.vars?.onComplete;
    anim.eventCallback('onComplete', (...args) => {
      if (typeof origOnComplete === 'function') {
        try { origOnComplete(...args); } catch (e) { console.error(e); }
      }
      tweens.delete(anim);
    });
    return anim;
  }

  /** Animated `gsap.to` with reduced-motion support + tracking. */
  function tweenTo(target, vars) {
    return track(gsap.to(target, adjustForReducedMotion(vars)));
  }

  /** Animated `gsap.from` with reduced-motion support + tracking. */
  function tweenFrom(target, vars) {
    return track(gsap.from(target, adjustForReducedMotion(vars)));
  }

  /** Animated `gsap.fromTo` with reduced-motion support + tracking. */
  function tweenFromTo(target, fromVars, toVars) {
    return track(
      gsap.fromTo(
        target,
        adjustForReducedMotion(fromVars),
        adjustForReducedMotion(toVars),
      ),
    );
  }

  /** Current pulse tween (the Gnosis NFT's gold glow), if any. */
  let activePulse = null;

  // ========================================================================
  // Page load choreography
  // ========================================================================

  /**
   * Initial page entrance: topbar drops in, tabs fade up, then cards stagger.
   *
   * @param {object} els
   * @param {Element} [els.topbar]
   * @param {Element} [els.tabs]
   * @param {Element[]} [els.cards]
   */
  function pageEnter({ topbar, tabs, cards } = {}) {
    if (topbar) {
      tweenFrom(topbar, {
        y: -20,
        opacity: 0,
        duration: DUR.base,
        ease: EASE.out,
      });
    }
    if (tabs) {
      tweenFrom(tabs, {
        y: 10,
        opacity: 0,
        duration: DUR.base,
        ease: EASE.out,
        delay: 0.1,
      });
    }
    if (cards?.length) {
      tweenFrom(cards, {
        y: 30,
        opacity: 0,
        scale: 0.95,
        duration: DUR.slow,
        ease: EASE.outStrong,
        stagger: STAGGER.card,
        delay: 0.2,
      });
    }
  }

  // ========================================================================
  // Grid re-render (tab switch / hide / unhide / wallet change)
  // ========================================================================

  /**
   * Stagger in a freshly-rendered grid of cards.
   *
   * @param {Element[] | NodeListOf<Element>} cards
   */
  function showGrid(cards) {
    const arr = toArray(cards).filter(Boolean);
    if (!arr.length) return;
    tweenFrom(arr, {
      y: 20,
      opacity: 0,
      scale: 0.96,
      duration: DUR.base,
      ease: EASE.out,
      stagger: STAGGER.card,
    });
  }

  // ========================================================================
  // Empty / skeleton / error states
  // ========================================================================

  /**
   * Reveal an empty-state node: icon pops in with overshoot, text fades up.
   *
   * @param {Element} node - the .empty-state container
   */
  function showEmpty(node) {
    if (!node) return;
    const icon = node.querySelector('.icon');
    const text = node.querySelector('p');
    const button = node.querySelector('.btn');

    if (icon) {
      tweenFrom(icon, {
        scale: 0,
        rotate: -180,
        duration: DUR.slow,
        ease: EASE.backOut,
      });
    }
    if (text) {
      tweenFrom(text, {
        y: 10,
        opacity: 0,
        duration: DUR.base,
        ease: EASE.out,
        delay: 0.2,
      });
    }
    if (button) {
      tweenFrom(button, {
        y: 10,
        opacity: 0,
        duration: DUR.base,
        ease: EASE.out,
        delay: 0.3,
      });
    }
  }

  /** Convenience for skeleton grids (skeletons have their own CSS shimmer). */
  function showSkeleton(node) {
    if (!node) return;
    tweenFrom(node, { opacity: 0, duration: DUR.fast, ease: EASE.out });
  }

  /** Errors use the same entrance as empty states. */
  function showError(node) {
    showEmpty(node);
  }

  // ========================================================================
  // Card lifecycle
  // ========================================================================

  /**
   * Animate a card out (e.g. when hidden). Resolves when done.
   *
   * @param {Element} cardEl
   * @returns {Promise<void>}
   */
  function removeCard(cardEl) {
    return new Promise((resolve) => {
      tweenTo(cardEl, {
        scale: 0.6,
        opacity: 0,
        duration: DUR.fast,
        ease: EASE.backIn,
        onComplete: resolve,
      });
    });
  }

  /**
   * Pop a newly-added card in.
   *
   * @param {Element} cardEl
   */
  function addCard(cardEl) {
    if (!cardEl) return;
    tweenFrom(cardEl, {
      scale: 0,
      opacity: 0,
      duration: DUR.base,
      ease: EASE.backOut,
    });
  }

  /**
   * Start the infinite gold-pulse on a highlighted (Gnosis) card.
   * Kills any previous pulse.
   *
   * @param {Element} cardEl
   */
  function pulseHighlighted(cardEl) {
    if (activePulse) {
      activePulse.kill();
      activePulse = null;
    }
    if (!cardEl) return null;
    activePulse = gsap.to(cardEl, {
      boxShadow:
        '0 0 0 2px var(--gold), 0 8px 32px rgba(245, 158, 11, 0.38)',
      duration: 1.5,
      ease: EASE.sine,
      yoyo: true,
      repeat: -1,
    });
    tweens.add(activePulse);
    return activePulse;
  }

  // ========================================================================
  // Toast
  // ========================================================================

  /**
   * Bounce a toast notification in.
   *
   * @param {Element} toastEl
   */
  function showToast(toastEl) {
    if (!toastEl) return;
    tweenFrom(toastEl, {
      y: 100,
      scale: 0.9,
      opacity: 0,
      duration: DUR.base,
      ease: EASE.backOut,
    });
  }

  /** Fade a toast out cleanly. */
  function hideToast(toastEl) {
    if (!toastEl) return;
    tweenTo(toastEl, {
      y: 20,
      opacity: 0,
      scale: 0.95,
      duration: DUR.fast,
      ease: EASE.in,
    });
  }

  // ========================================================================
  // Detail transitions (info-only — no image morph)
  // ========================================================================

  /**
   * Reveal the detail view's hero image. Runs alongside the info-row
   * stagger in openDetail() — the image fades + scales in while the
   * info rows stagger.
   *
   * @param {Element} imgEl - the detail image element (or placeholder)
   * @returns {Promise<void>}
   */
  function showDetailImage(imgEl) {
    if (!imgEl) return Promise.resolve();
    return new Promise((resolve) => {
      tweenFrom(imgEl, {
        opacity: 0,
        scale: 0.95,
        duration: 0.7,
        ease: EASE.outStrong,
        onComplete: resolve,
      });
    });
  }

  /**
   * Reveal the detail view's info panel. The detail view itself appears
   * instantly (no image morph — the hand-rolled clone-and-animate approach
   * was glitchy in practice).
   *
   * @param {object} args
   * @param {Element} [args.infoEl] - the info panel whose children stagger in
   * @returns {Promise<void>}
   */
  function openDetail({ infoEl } = {}) {
    return new Promise((resolve) => {
      if (infoEl) {
        tweenFrom(toArray(infoEl.children), {
          y: 20,
          opacity: 0,
          duration: DUR.base,
          ease: EASE.out,
          stagger: STAGGER.info,
          onComplete: resolve,
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Re-stagger the gallery grid (used on back / hide from detail).
   *
   * @param {object} args
   * @param {Element} [args.gridEl] - the rendered gallery grid
   * @returns {Promise<void>}
   */
  function closeDetail({ gridEl } = {}) {
    return new Promise((resolve) => {
      if (gridEl?.children?.length) {
        tweenFrom(toArray(gridEl.children), {
          y: 12,
          opacity: 0,
          scale: 0.96,
          duration: DUR.base,
          ease: EASE.out,
          stagger: STAGGER.card,
          onComplete: resolve,
        });
      } else {
        resolve();
      }
    });
  }

  // ========================================================================
  // Zoom / lightbox
  // ========================================================================

  /**
   * Animate a lightbox/zoom overlay open. The image scales from 0.92
   * to 1 while the backdrop fades in.
   *
   * @param {object} els
   * @param {Element} els.backdrop - the full-viewport overlay container
   * @param {Element} els.img      - the image element being zoomed
   * @param {Element} [els.caption] - optional caption element
   * @returns {Promise<void>}
   */
  function zoomIn({ backdrop, img, caption } = {}) {
    return new Promise((resolve) => {
      if (backdrop) {
        tweenFrom(backdrop, {
          opacity: 0,
          duration: 0.3,
          ease: EASE.out,
        });
      }
      if (img) {
        tweenFrom(img, {
          opacity: 0,
          scale: 0.92,
          duration: 0.5,
          ease: EASE.outStrong,
          onComplete: resolve,
        });
      } else {
        resolve();
      }
      if (caption) {
        tweenFrom(caption, {
          y: 10,
          opacity: 0,
          duration: 0.4,
          ease: EASE.out,
          delay: 0.2,
        });
      }
    });
  }

  /**
   * Animate a lightbox/zoom overlay closed. Resolves when the backdrop
   * fade-out is complete.
   *
   * @param {object} els
   * @param {Element} els.backdrop
   * @param {Element} els.img
   * @param {Element} [els.caption]
   * @returns {Promise<void>}
   */
  function zoomOut({ backdrop, img, caption } = {}) {
    return new Promise((resolve) => {
      if (caption) {
        tweenTo(caption, {
          opacity: 0,
          y: 10,
          duration: 0.2,
          ease: EASE.in,
        });
      }
      if (img) {
        tweenTo(img, {
          opacity: 0,
          scale: 0.96,
          duration: 0.3,
          ease: EASE.in,
        });
      }
      if (backdrop) {
        tweenTo(backdrop, {
          opacity: 0,
          duration: 0.3,
          ease: EASE.in,
          onComplete: resolve,
        });
      } else {
        resolve();
      }
    });
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  /** Kill every active tween/timeline. Call on app teardown. */
  function kill() {
    for (const t of tweens) t.kill();
    tweens.clear();
    activePulse = null;
  }

  return {
    // entrance
    pageEnter,
    showGrid,
    // states
    showEmpty,
    showSkeleton,
    showError,
    // card lifecycle
    removeCard,
    addCard,
    pulseHighlighted,
    // toast
    showToast,
    hideToast,
    // detail
    showDetailImage,
    openDetail,
    closeDetail,
    // zoom
    zoomIn,
    zoomOut,
    // lifecycle
    kill,
  };
}

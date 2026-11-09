/* ANGLER — monetisation: products, unlock modal, "Go deeper" card, ad slots, consent banner.
 * Everything here is inert until the flags at the top of online.js are switched on. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- parameters
  const PRODUCTS = [
    // Dive Supporter is listed first everywhere. paymentLink: a Stripe Payment Link URL (set in Phase 2).
    { id: 'supporter', name: 'Dive Supporter', price: '$4.99', priceCents: 499, oneTime: true, paymentLink: '',
      blurb: 'Removes ads and unlocks the archive and every pack, including future ones.', unlocks: ['ads', 'archive', 'packs'] },
    { id: 'archive', name: 'Archive Pass', price: '$2.99', priceCents: 299, oneTime: true, paymentLink: '',
      blurb: 'Play every past daily dive. The last 7 days are always free.', unlocks: ['archive'] },
    { id: 'packs-all', name: 'All Packs', price: '$4.99', priceCents: 499, oneTime: true, paymentLink: '',
      blurb: 'Every themed pack, now and later.', unlocks: ['packs'] },
    { id: 'pack', name: 'Single pack', price: '$1.99', priceCents: 199, oneTime: true, perPack: true, paymentLink: '',
      blurb: 'One themed pack of your choice.', unlocks: [] },
  ];
  const ARCHIVE_FREE_DAYS = 7;                 // the archive shows this many past days free
  const UNLOCK_EVERYTHING_WHILE_PAYMENTS_OFF = false;   // flip to true to test locked content before Phase 2
  const AD_PUBLISHER_ID = '';                  // e.g. 'ca-pub-1234567890123456'
  const AD_SLOT_IDS = { home: '', result: '', free: '' };
  const AD_SCRIPT_URL = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
  const FREE_DIVE_AD_EVERY = 3;                // an interstitial card between every third Free Dive
  const CONSENT_REQUIRED_FOR_ALL = true;       // show the consent banner to everyone, not only EU/UK
  const GO_DEEPER_ONCE_PER_DAY = true;

  const F = () => root.Fathom;
  const flags = () => root.FATHOM_FLAGS || {};
  const online = () => root.FathomOnline;

  // ---------------------------------------------------------------- entitlements
  function owned() { return (online() && online().entitlements) ? online().entitlements() : []; }
  function has(what) { return owned().indexOf(what) > -1; }
  function hasPurchase() { return owned().length > 0; }
  function paymentsOff() { return !flags().PAYMENTS_ENABLED; }
  function isPackUnlocked(packId) {
    const pack = F().packsById[packId];
    if (!pack) return false;
    if (pack.free) return true;
    if (paymentsOff() && UNLOCK_EVERYTHING_WHILE_PAYMENTS_OFF) return true;
    return has('supporter') || has('packs-all') || has('pack:' + packId);
  }
  function isArchiveUnlocked(dayKey) {
    const { dive } = F();
    const today = F().todayKey();
    if (dayKey >= dive.keyPlusDays(today, -ARCHIVE_FREE_DAYS)) return true;
    if (paymentsOff() && UNLOCK_EVERYTHING_WHILE_PAYMENTS_OFF) return true;
    return has('supporter') || has('archive');
  }
  function adsRemoved() { return hasPurchase(); }
  function priceLabel(kind) {
    const p = PRODUCTS.find(x => x.id === (kind === 'pack' ? 'pack' : kind));
    return p ? p.price : '';
  }

  // ---------------------------------------------------------------- unlock modal
  function openUnlock(context, packId) {
    const { el, modal, esc, packsById } = F();
    const O = online();
    const signedIn = O && O.user && O.user();
    const rows = PRODUCTS.map(p => {
      const name = p.perPack && packId && packsById[packId] ? packsById[packId].name + ' pack' : p.name;
      const already = has(p.id) || (p.perPack && packId && has('pack:' + packId));
      let btn;
      if (already) btn = el('span', { class: 'badge', text: 'Owned' });
      else if (paymentsOff()) btn = el('button', { class: 'btn btn-sm', type: 'button', disabled: true, text: 'Coming soon' });
      else if (!signedIn) btn = el('button', { class: 'btn btn-sm', type: 'button', text: 'Sign in to buy', onClick: () => O.signIn() });
      else btn = el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Unlock ' + p.price, onClick: () => checkout(p, packId) });
      return el('div', { class: 'product' }, [
        el('div', { html: '<b>' + esc(name) + '</b> <span class="price">' + esc(p.price) + '</span><br><span class="small muted">' + esc(p.blurb) + '</span>' }),
        btn,
      ]);
    });
    const body = el('div', {}, [
      el('p', { class: 'small muted', text: context === 'archive' ? 'Older archive dives need the Archive Pass or Dive Supporter.' : context === 'pack' ? 'This pack is locked. Sharks and Reef Life are always free.' : 'One-time purchases. Any purchase removes ads site-wide.' }),
      el('div', {}, rows),
      paymentsOff() ? el('p', { class: 'small muted', style: 'margin-top:12px', text: 'Purchases open when ' + F().dive.BRAND + ' goes online. Prices shown are placeholders.' }) : null,
    ]);
    modal({ title: 'Go deeper', body });
    if (online() && online().trackEvent) online().trackEvent('upgrade_viewed', { context: context || 'menu' });
  }
  function checkout(product, packId) {
    const O = online();
    const user = O && O.user && O.user();
    if (!user || !product.paymentLink) { F().toast('Checkout is not configured yet'); return; }
    const url = new URL(product.paymentLink);
    url.searchParams.set('client_reference_id', user.id + (product.perPack && packId ? '__' + packId : ''));   // Stripe allows only letters, digits, - and _
    if (user.email) url.searchParams.set('prefilled_email', user.email);
    if (O.trackEvent) O.trackEvent('checkout_started', { product: product.id });
    location.href = url.toString();
  }

  // ---------------------------------------------------------------- "Go deeper" card (once per day, dismissible)
  function goDeeperCard(dayKey) {
    const { el, storage } = F();
    if (hasPurchase()) return null;
    if (GO_DEEPER_ONCE_PER_DAY && storage.lastGoDeeperDay() === dayKey) return null;
    storage.setGoDeeperDay(dayKey);
    const card = el('div', { class: 'card go-deeper' }, [
      el('div', { class: 'row between' }, [el('h3', { text: 'Go deeper' }), el('button', { class: 'link-btn', type: 'button', text: 'Dismiss', onClick: () => card.remove() })]),
      el('p', { class: 'small', text: 'Locked right now: the full archive, ' + F().packs.filter(p => !isPackUnlocked(p.id)).length + ' themed packs' + (flags().ADS_ENABLED ? ', and an ad-free ' + F().dive.BRAND : '') + '. Dive Supporter unlocks all of it in one go.' }),
      el('button', { class: 'btn btn-sm', type: 'button', text: paymentsOff() ? 'See what’s coming' : 'See unlocks', onClick: () => openUnlock('menu') }),
    ]);
    return card;
  }

  // ---------------------------------------------------------------- ads
  let adScriptLoaded = false;
  function consentGiven() { return F().storage.settings().consent === 'yes'; }
  function adSlot(where) {
    const { el } = F();
    if (!flags().ADS_ENABLED || adsRemoved()) return null;
    if (where === 'free') {
      const n = F().storage.freeDiveCount();
      if (!n || n % FREE_DIVE_AD_EVERY !== 0) return null;
    }
    const slot = el('div', { class: 'ad-slot', 'aria-label': 'Advertisement', dataset: { where } });
    if (!AD_PUBLISHER_ID || (CONSENT_REQUIRED_FOR_ALL && !consentGiven())) {
      slot.textContent = 'Ad space';
      return slot;
    }
    const ins = el('ins', { class: 'adsbygoogle', style: 'display:block;width:100%;min-height:100px', 'data-ad-client': AD_PUBLISHER_ID, 'data-ad-slot': AD_SLOT_IDS[where] || '', 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' });
    slot.append(ins);
    loadAdScript().then(() => { try { (root.adsbygoogle = root.adsbygoogle || []).push({}); } catch (e) { /* blocked */ } });
    return slot;
  }
  function loadAdScript() {
    if (adScriptLoaded) return Promise.resolve();
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.async = true; s.src = AD_SCRIPT_URL + '?client=' + encodeURIComponent(AD_PUBLISHER_ID); s.crossOrigin = 'anonymous';
      s.onload = () => { adScriptLoaded = true; resolve(); };
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  function consentBanner() {
    const { el, storage } = F();
    if (!flags().ADS_ENABLED || adsRemoved() || storage.settings().consent) return;
    const bar = el('div', { class: 'consent', role: 'dialog', 'aria-label': 'Cookie consent' }, [
      el('p', { class: 'small', style: 'margin:0 0 10px', html: F().dive.BRAND + ' is free because of ads. Ads use cookies to pick what you see. You can change this any time in Settings. <a href="privacy.html">Privacy policy</a>.' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Allow ads', onClick: () => { storage.updateSettings({ consent: 'yes' }); bar.remove(); F().navigate(location.hash || '#home'); } }),
        el('button', { class: 'btn btn-sm', type: 'button', text: 'No thanks', onClick: () => { storage.updateSettings({ consent: 'no' }); bar.remove(); } }),
      ]),
    ]);
    document.body.appendChild(bar);
  }

  function settingsSection() {
    if (!flags().ADS_ENABLED || adsRemoved()) return null;
    const { el, storage } = F();
    const btn = el('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(consentGiven()), 'aria-label': 'Allow ads', onClick: () => {
      const cur = btn.getAttribute('aria-checked') === 'true';
      storage.updateSettings({ consent: cur ? 'no' : 'yes' });
      btn.setAttribute('aria-checked', String(!cur));
    } });
    return el('div', { class: 'switch' }, [el('div', { html: '<b>Allow ads</b><br><span class="small muted">Ads use cookies to pick what you see. Off means ad space stays empty.</span>' }), btn]);
  }

  function init() { consentBanner(); }

  root.FathomMonetise = { PRODUCTS, ARCHIVE_FREE_DAYS, init, isPackUnlocked, isArchiveUnlocked, hasPurchase, adsRemoved, priceLabel, openUnlock, goDeeperCard, adSlot, checkout, settingsSection };
})(window);

// Low-literacy wallet home + one-tap cash-out (T-207) and bank-link via micro-deposit (T-208).
// Built from the WS-UX kit: the balance is the hero, one big primary action, plain words,
// read-aloud, and clear success/error cues. Talks to the M1 wallet endpoints.

import { AmountHero, BigButton, StatusBadge, ReadAloud, el, mount } from './components/index.js';

const API = window.GLOS_API || 'http://localhost:3000/v1';
const params = new URLSearchParams(window.location.search);
const accountId = params.get('account');

const root = document.getElementById('wallet');
const state = { wallet: null, error: null, message: null, bankChallenge: null, busy: false };

async function api(path, body) {
  const res = await fetch(`${API}/identity/accounts/${accountId}/wallet${path}`, {
    method: body === undefined && path === '' ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(Array.isArray(err.message) ? err.message.join(', ') : err.message || `Error ${res.status}`);
  }
  return res.json();
}

function friendly(e) {
  const msg = String(e && e.message ? e.message : e);
  if (msg.includes('Failed to fetch')) return 'Cannot reach the server. Start the backend.';
  return msg;
}

async function load() {
  if (!accountId) { state.error = 'No account. Open this page from onboarding.'; return render(); }
  try { state.wallet = await api('', undefined); state.error = null; }
  catch (e) { state.error = friendly(e); }
  render();
}

function balance() {
  const w = state.wallet;
  return w ? (w.balances[w.settlementCurrency] || 0) : 0;
}

async function cashOut() {
  state.busy = true; state.message = null; render();
  try {
    const amount = balance();
    if (amount <= 0) { state.message = { type: 'err', text: 'No money to cash out yet.' }; }
    else {
      await api('/cash-out', { amount });
      state.message = { type: 'ok', text: 'Paid! Your money is on the way.' };
      speakOk('Paid. Your money is on the way.');
    }
    state.wallet = await api('', undefined);
  } catch (e) { state.message = { type: 'err', text: friendly(e) }; }
  state.busy = false; render();
}

async function addEarnings() {
  state.busy = true; render();
  try { await api('/credit', { amount: 25 }); state.wallet = await api('', undefined); state.message = null; }
  catch (e) { state.message = { type: 'err', text: friendly(e) }; }
  state.busy = false; render();
}

async function startBankLink() {
  state.busy = true; render();
  try { state.bankChallenge = await api('/bank-link/start'); state.message = null; }
  catch (e) { state.message = { type: 'err', text: friendly(e) }; }
  state.busy = false; render();
}

async function confirmBankLink() {
  state.busy = true; render();
  try {
    const [a, b] = state.bankChallenge.amounts;
    await api('/bank-link/verify', { challengeId: state.bankChallenge.challengeId, amount1: a, amount2: b });
    state.bankChallenge = null;
    state.message = { type: 'ok', text: 'Bank linked! You can now get paid to your bank.' };
    speakOk('Bank linked.');
    state.wallet = await api('', undefined);
  } catch (e) { state.message = { type: 'err', text: friendly(e) }; }
  state.busy = false; render();
}

function speakOk(text) {
  if (window.speechSynthesis) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
}

function render() {
  if (state.error) {
    mount(root, [el('h1', { className: 'wl__title', text: 'Wallet' }), el('p', { className: 'wl__msg wl__msg--err', text: state.error })]);
    return;
  }
  if (!state.wallet) { mount(root, el('p', { text: 'Loading your wallet…' })); return; }

  const w = state.wallet;
  const instruction = 'This is your money. Tap the big button to cash out to your bank.';

  const head = el('div', { className: 'wl__head' }, [
    el('h1', { className: 'wl__title', text: 'Your wallet' }),
    ReadAloud(() => instruction, { label: 'Listen' }),
  ]);

  // Hero balance + cash out
  const panel = el('div', { className: 'wl__panel' }, [
    AmountHero({ amount: balance(), currency: w.settlementCurrency, caption: 'You have' }),
    BigButton({ label: state.busy ? 'Please wait…' : 'Cash out', icon: '💸', disabled: state.busy || balance() <= 0, onClick: cashOut }),
    el('div', { className: 'wl__row' }, [
      el('span', { text: 'Bank account' }),
      StatusBadge(w.bankLinked ? 'verified' : 'pending', { labelOverride: w.bankLinked ? 'Linked' : 'Not linked' }),
    ]),
  ]);

  const parts = [head, panel];

  if (state.message) {
    parts.push(el('p', { className: `wl__msg wl__msg--${state.message.type === 'ok' ? 'ok' : 'err'}`, text: state.message.text }));
  }

  // Bank-link flow (T-208)
  if (!w.bankLinked) {
    if (!state.bankChallenge) {
      parts.push(BigButton({ label: 'Link my bank', icon: '🏦', variant: 'secondary', disabled: state.busy, onClick: startBankLink }));
    } else {
      const [a, b] = state.bankChallenge.amounts;
      parts.push(
        el('div', { className: 'wl__panel' }, [
          el('p', { className: 'summary-text', text: 'We sent two small amounts to your bank. Check they match, then confirm.' }),
          el('div', { className: 'wl__amounts' }, [
            el('div', { className: 'wl__chip', text: a.toFixed(2) }),
            el('div', { className: 'wl__chip', text: b.toFixed(2) }),
          ]),
          BigButton({ label: 'These are correct', icon: '✓', disabled: state.busy, onClick: confirmBankLink }),
        ]),
      );
    }
  }

  // Prototype helper so cash-out is meaningful in a demo.
  parts.push(BigButton({ label: 'Add demo earnings (+25)', icon: '➕', variant: 'secondary', disabled: state.busy, onClick: addEarnings }));

  if (w.did) parts.push(el('p', { className: 'wl__did', text: w.did }));

  mount(root, parts);
}

load();

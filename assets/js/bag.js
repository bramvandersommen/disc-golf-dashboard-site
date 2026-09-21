// Bag page — standalone. Reads only the Discs tab and renders the bag view.
import { loadDiscs } from './data.js?v=202609212201';
import { renderBag } from './render.js?v=202609212201';

const $ = sel => document.querySelector(sel);

async function boot() {
  $('#load-state').hidden = false;
  $('#error-state').hidden = true;
  try {
    const discs = await loadDiscs();
    $('#load-state').hidden = true;
    $('#bag-page').hidden = false;
    renderBag({ discs });
  } catch (err) {
    console.error(err);
    $('#load-state').hidden = true;
    $('#bag-page').hidden = true;
    $('#error-state').hidden = false;
    $('#error-detail').textContent =
      `${err.message}. The Sheet publishes as CSV with a few minutes of cache lag — if this persists, check the network tab.`;
  }
}

$('#retry-btn')?.addEventListener('click', boot);
boot();

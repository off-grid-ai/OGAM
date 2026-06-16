---
layout: default
title: Get Pro
nav_order: 5
description: Buy Off Grid Pro. Enter your email and check out. $50 one-time, no subscription. Have a promo code? Apply it at checkout.
---

<div class="early-access-hero">
  <div class="early-access-badge">Off Grid Pro</div>
  <h1>Pay once.<br>Run it forever.</h1>
  <p class="early-access-sub">Off Grid Pro adds voice, custom personas, and tool integrations. All of it runs on your phone, the same as the rest. Enter your email below to check out. Your email is the account the purchase attaches to, so use the one you sign into the app with.</p>
</div>

<div class="early-access-form-section ea-form-top">
  <form id="payForm" class="early-access-form" novalidate>
    <div class="ea-inline-group">
      <input type="email" id="payEmail" class="ea-input" placeholder="your@email.com" autocomplete="email" aria-invalid="false" aria-describedby="payStatus" required>
      <button type="submit" class="ea-submit" id="paySubmit" disabled>Continue to checkout</button>
    </div>
    <div class="ea-form-footer">
      <p class="ea-pricing-note">$50 one-time · no subscription · promo codes apply at checkout</p>
    </div>
    <p class="ea-status" id="payStatus" aria-live="polite"></p>
  </form>
  <p class="ea-slack-direct">
    Have a promo code? Enter it on the checkout page after this step. Checkout is handled by RevenueCat. Nothing on this page touches your phone's models or data.
  </p>
</div>

---

<div class="early-access-perks">
  <div class="perk-card">
    <div class="perk-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    </div>
    <div>
      <div class="perk-title">Voice in, voice out</div>
      <div class="perk-desc">Whisper transcribes what you say, Kokoro speaks the reply. Hold to talk, listen back. No audio leaves the device.</div>
    </div>
  </div>
  <div class="perk-card">
    <div class="perk-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    </div>
    <div>
      <div class="perk-title">Custom personas</div>
      <div class="perk-desc">Build assistants with your own prompts, voices, and memory. Switch contexts in a tap.</div>
    </div>
  </div>
  <div class="perk-card">
    <div class="perk-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.59 13.41a1.998 1.998 0 0 1 0-2.83l4.24-4.24a4 4 0 0 1 5.66 5.66l-1.41 1.41"/><path d="M13.41 10.59a1.998 1.998 0 0 1 0 2.83l-4.24 4.24a4 4 0 0 1-5.66-5.66l1.41-1.41"/></svg>
    </div>
    <div>
      <div class="perk-title">Tool integrations</div>
      <div class="perk-desc">Read your inbox, draft a reply, schedule a meeting, file a ticket. Slack, calendar, email, any MCP server. You approve every action that leaves the phone.</div>
    </div>
  </div>
  <div class="perk-card">
    <div class="perk-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    </div>
    <div>
      <div class="perk-title">Pay once, keep it</div>
      <div class="perk-desc"><strong>$50 one-time</strong>. No subscription, no surprise pricing. Have a promo code? Enter it at checkout to adjust the price.</div>
    </div>
  </div>
</div>

---

## How checkout works

You enter your email and we send you to RevenueCat's hosted checkout with that email attached. The purchase is tied to your email, so sign into the app with the same address to unlock Pro.

Have a promo code? Apply it on the checkout page, before you pay. The price updates once the code is accepted.

Pro is a one-time $50 purchase, not a subscription. The open-source core has 100K downloads already. Pro is an extension of it, not a rewrite.

If we do not ship Pro within 12 weeks, email us and you get a full refund.

<script src="{{ '/assets/js/revenuecat-link.js' | relative_url }}"></script>
<script>
  (function() {
    var LINK_ID = {{ site.revenuecat_link_id | jsonify }};
    var form = document.getElementById('payForm');
    var emailInput = document.getElementById('payEmail');
    var submit = document.getElementById('paySubmit');
    var status = document.getElementById('payStatus');
    if (!form || !window.RevenueCatLink) return;

    // Sync the button state on load too - the browser may have autofilled the
    // field (or restored it on back-navigation) without firing an input event.
    submit.disabled = emailInput.value.trim() === '';

    function clearError() {
      emailInput.classList.remove('ea-input-error');
      emailInput.setAttribute('aria-invalid', 'false');
      if (status.classList.contains('ea-status-error')) {
        status.textContent = '';
        status.className = 'ea-status';
      }
    }

    function showError(message) {
      emailInput.classList.add('ea-input-error');
      emailInput.setAttribute('aria-invalid', 'true');
      status.textContent = message;
      status.className = 'ea-status ea-status-error';
    }

    // Enable the button only once something is typed; clear errors as they type.
    emailInput.addEventListener('input', function() {
      submit.disabled = emailInput.value.trim() === '';
      clearError();
    });

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var email = emailInput.value.trim();
      if (!RevenueCatLink.isValidEmail(email)) {
        showError('Enter a valid email address.');
        emailInput.focus();
        return;
      }
      var url = RevenueCatLink.buildPurchaseUrl(LINK_ID, email);
      if (!url) {
        // Email is valid, so a null URL means the link id is not configured.
        showError('Checkout is not available right now. Please try again later.');
        return;
      }
      if (typeof posthog !== 'undefined') {
        // Never let an analytics failure (blocked, errored) stop the purchase.
        try {
          posthog.identify(email, { email: email });
          posthog.capture('pro_checkout_started', {
            email: email,
            source: window.location.pathname
          });
        } catch (err) {
          console.warn('PostHog tracking failed:', err);
        }
      }
      status.innerHTML = 'Checkout opened in a new tab. <a href="' + url + '" target="_blank" rel="noopener">Reopen it</a> if your browser blocked the popup.';
      status.className = 'ea-status ea-status-success';
      // No features string: a non-empty one forces a popup window; '_blank'
      // alone opens a real new tab and already defaults to noopener.
      window.open(url, '_blank');
    });
  })();
</script>

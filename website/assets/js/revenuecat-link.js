// Builds a RevenueCat Web Purchase Link from a customer email.
//
// RevenueCat identifies the customer by the App User ID, which is a *path*
// segment (not a query parameter). We use the email itself as the App User ID
// so the purchase is tied to a stable id we can later match to the app account.
// The `email` query parameter only prefills the email field on the checkout
// page (subscribers cannot override it).
//
//   https://pay.rev.cat/<token>/<urlEncodedEmail>?email=<urlEncodedEmail>
//
// This file is loaded as a browser global by /pay/ and imported directly by the
// unit test, so it has no dependencies and works in both environments.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RevenueCatLink = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Linear-time email check (no overlapping quantifiers, so no catastrophic
  // backtracking / ReDoS): local part, '@', then dot-separated domain labels
  // that themselves contain no dots.
  var EMAIL_RE = /^[^\s@]+@[^\s.@]+(\.[^\s.@]+)+$/;

  function isValidEmail(email) {
    return typeof email === 'string' && EMAIL_RE.test(email.trim());
  }

  // Returns the purchase URL, or null if the inputs are invalid.
  // opts may include { packageId } to pre-select a package.
  function buildPurchaseUrl(token, email, opts) {
    if (!token || typeof token !== 'string') return null;
    if (!isValidEmail(email)) return null;

    var trimmed = email.trim();
    var encoded = encodeURIComponent(trimmed);
    // String concatenation (not template literals) keeps this file ES5-only.
    /* eslint-disable prefer-template */
    var url =
      'https://pay.rev.cat/' + encodeURIComponent(token) + '/' + encoded + '?email=' + encoded;

    if (opts && opts.packageId) {
      url += '&package_id=' + encodeURIComponent(opts.packageId);
    }
    /* eslint-enable prefer-template */
    return url;
  }

  return {
    isValidEmail: isValidEmail,
    buildPurchaseUrl: buildPurchaseUrl,
  };
});

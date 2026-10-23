// Redaction.
//
// Governing principle: emit what is visible, never more. A password field
// renders as dots, so emitting its value would not just leak — it would be a
// factually wrong description of what the user is looking at.
//
// These rules apply to control values AND to ancestor names used as context,
// since an aria-label is just as capable of carrying a patient name as an
// input is.

(function () {
  const C4C = (globalThis.C4C = globalThis.C4C || {});

  const DOTS = "••••••";

  const SENSITIVE_AUTOCOMPLETE = new Set([
    "current-password",
    "new-password",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "one-time-code",
  ]);

  // Matched against name/id/placeholder/aria-label, not against the value.
  const SENSITIVE_NAME = /pass(word|phrase)|secret|token|api[-_ ]?key|ssn|social.?security|cvv|cvc|security.?code|routing|account.?number|pin\b/i;

  // Matched against values that look like credentials regardless of labelling.
  const TOKEN_SHAPED = /^(?:[A-Za-z0-9_-]{32,}|[A-Fa-f0-9]{32,}|(?:ey[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,})$/;
  const DIGIT_RUN = /^[\d \-]{12,24}$/;

  function luhn(value) {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 12 || digits.length > 19) return false;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (double) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      double = !double;
    }
    return sum % 10 === 0;
  }

  C4C.mask = {
    count: 0,

    reset() {
      this.count = 0;
    },

    // True when the control's identity alone disqualifies it, before we ever
    // read .value.
    isSensitiveControl(el) {
      if (!el) return false;
      if (el.type === "password") return true;

      const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
      if (auto.split(/\s+/).some((t) => SENSITIVE_AUTOCOMPLETE.has(t))) return true;

      const hay = [
        el.name,
        el.id,
        el.placeholder,
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
      ]
        .filter(Boolean)
        .join(" ");
      return SENSITIVE_NAME.test(hay);
    },

    // Value-shape check, for fields nobody bothered to label.
    looksSecret(text) {
      if (!text) return false;
      const t = text.trim();
      if (TOKEN_SHAPED.test(t)) return true;
      if (DIGIT_RUN.test(t) && luhn(t)) return true;
      return false;
    },

    value(el, text) {
      if (this.isSensitiveControl(el) || this.looksSecret(text)) {
        this.count++;
        return DOTS;
      }
      return text;
    },

    // Ancestor names are page content the user did not select, so they get the
    // same treatment.
    name(text) {
      if (!text) return text;
      if (SENSITIVE_NAME.test(text) || this.looksSecret(text)) {
        this.count++;
        return DOTS;
      }
      return text;
    },

    // Query strings are a routine token-leak path.
    url(href) {
      try {
        const u = new URL(href);
        return u.origin + u.pathname;
      } catch {
        return "";
      }
    },

    // Link targets can't be query-stripped wholesale — ?v=, ?q= and friends
    // carry the actual destination. Mask individual params instead, so magic
    // links and signed URLs don't ride along into a chat.
    href(raw, base) {
      try {
        const u = new URL(raw, base);
        for (const [k, v] of Array.from(u.searchParams)) {
          if (/token|secret|auth|sig|signature|password|api[-_]?key|session/i.test(k) || this.looksSecret(v)) {
            // ASCII, not the bullet character: URL encoding turns a bullet
            // into %E2%80%A2 repeated, which is unreadable in a footnote.
            u.searchParams.set(k, "REDACTED");
            this.count++;
          }
        }
        return u.href;
      } catch {
        return raw;
      }
    },
  };
})();

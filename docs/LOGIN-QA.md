# Local login regression

Run `npm run qa:runtime`. It prints a loopback URL and fictional owner. Mail is captured by the disposable fixture; no SMTP message is sent. Keep login and `/qa-inbox` in separate tabs. The gateway forwards real response bytes and cookies and is excluded from the production image.

1. Request a link and leave `/login` open. Obtain its captured URL from the inbox and navigate the existing login tab to it. Verify automatic sign-in without a second button, a fragment-free address and the protected fictional report.
2. Sign out and reopen the consumed link. Verify an understandable error, usable email form and passkey option. Request another link and open it in that same tab; verify recovery.
3. Request a link in one browser and open it in another browser/profile with no flow/session cookie. It must sign in automatically. Also verify a new tab/email-app-style initial navigation. A background tab should wait until visible.
4. Sign out, request two links A/B and choose **Hold next confirmation** in the inbox. Open A in the login tab. Verify the inbox reports a real held 204 and issued session cookie. Open B in that same tab while A is pending, then choose **Release held response** within 15 seconds. The login tab must leave for the protected report without another click; the inbox must show a 200 report response with a real session cookie. No B POST should race A. The delay holds actual HTTP Set-Cookie headers, not a mocked fetch response.
5. Use Back/Forward after sign-in and sign-out. No consumed fragment should reappear or be submitted again. Check the login layout at a narrow/mobile width and confirm all controls fit and remain understandable.

`test/login.test.mjs` executes the shipped page script with controlled DOM events and network outcomes: initial/same-document links, hidden/prerender activation, failures/replacements, late successes/errors, interrupted session reconciliation, invalid fragments, back/forward restoration and the passkey path. HTTP/protocol tests cover GET/HEAD non-consumption, absent/different browser cookies, multiple links, replay, expiry, durable concurrent redemption, schema upgrade, CSRF and unchanged WebAuthn checks.

These visibility guards cannot stop a scanner that executes JavaScript in a visible browser. No real device credential should be registered for this QA. Stop the process to remove its temporary fixture.

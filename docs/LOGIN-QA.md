# Local login regression

Run `npm run qa:runtime`. It prints a loopback URL and a fictional owner email. Mail is captured by this temporary fixture; no SMTP message is sent. Use one browser profile and keep the login and captured inbox in separate tabs.

1. Request a link on `/login` and leave that tab open. Open `/qa-inbox` in a separate tab. Copy the first captured link and navigate the original login tab to it. Do not reload or leave `/login` first. Continue must become visible and enabled, the address must immediately become `/login` without a fragment, and the report must remain closed until Continue is clicked.
2. Click Continue and verify the fictional protected report opens. Sign out, then open the consumed link in the same login tab and click Continue. Verify the error is shown and the email form is usable.
3. Request another link from that form. Refresh only the separate inbox tab, then open the new link in the existing login tab. Verify the error clears and Continue is enabled. Use Back and Forward before confirming; neither address may contain the token and neither action may sign in. Click Continue and verify the report opens.
4. Sign out, request another link, and open it in a new tab in the same browser profile. Verify the fragment is cleared and explicit confirmation still succeeds.

`test/login.test.mjs` also executes the shipped browser script against controlled DOM events and pending network responses. It covers initial/same-document links, rejected and interrupted confirmations, replacement links arriving while a prior request is pending, late success/error responses, duplicate clicks and empty-token fragments. These deterministic tests supplement the real-browser checks above. Protocol and HTTP tests separately verify expiry, browser binding, single-use redemption and that GET requests cannot consume a link.

Stop the QA process when finished to remove its temporary fixture. Never use a real email, SMTP sender or device credential for this regression.

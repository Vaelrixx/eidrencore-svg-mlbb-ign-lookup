# Eidren UI behavior contract

This document records UI-level workflow conventions for the multi-route developer console. Product rules remain owned by the API handlers and database policies; see `README.md`, `src/app/api/**`, and the Supabase migrations for authoritative behavior.

## Navigation and route ownership

- `/` is the public MLBB Player ID + Zone ID lookup.
- `/login`, `/forgot-password`, and `/reset-password` own authentication and recovery entry points.
- `/dashboard` is the account overview. The shared `ConsoleFrame` in `src/components/console-frame.tsx` owns the top bar, desktop navigation, mobile navigation, current-section heading, sign-out action, and footer.
- `/dashboard/keys`, `usage`, `docs`, `billing`, `account`, `workspaces`, `webhooks`, and `logs` are separate routes with a consistent shared shell. Active route state must be visible and keyboard accessible.
- Preserve the current destination and query-string intent during sign-in redirects; do not create a new route-local navigation shell.

## Form and asynchronous states

- Forms keep their values while a request is pending or fails. Disable duplicate submission while busy and keep the primary button's geometry stable.
- Loading, success, empty, and error states are explicit and use existing inline/status components. Errors remain readable text; never rely on color alone.
- Tools require sign-up or an API key; signed-out visitors see a sign-in gate, never a working tool. The lookup treats provider unavailability separately from a confirmed player-not-found result; UI copy must not imply that a timeout proves an account is invalid.
- API keys are sensitive. Show newly issued key material only in the existing creation result flow; never add it to URLs, logs, or decorative examples presented as real user data.
- Copy controls retain their labels and show a short, visible success state. Clipboard failures must remain recoverable.
- Billing UI reflects server-returned plan and order state. Visual work must not change checkout, verification, or webhook semantics.

## Destructive and security-sensitive actions

- Revoking an API key, signing out, changing passwords, revoking sessions, or changing workspace membership must retain the existing server authorization and error recovery.
- Destructive actions use explicit labels and distinguish danger from normal actions. Do not introduce a fake confirmation or success state.
- Session expiry and unauthenticated API responses return through the existing sign-in flow, preserving safe return paths.

## Responsive and accessibility contract

- At narrow widths, the console's mobile route navigator exposes all destinations through horizontal scrolling; the desktop sidebar is hidden only when the mobile navigation is available.
- Layout uses natural page scrolling. Wide tables scroll within their own wrapper; they must not clip sibling forms or the page heading.
- Every actionable element is a native link or button, with visible focus, hover/pressed, and disabled/busy states.
- Keep field labels associated with inputs, status and error copy exposed to assistive technology, and keyboard operation intact.
- Respect `prefers-reduced-motion`. Glass blur is progressive enhancement; contrast and readable surfaces must remain if blur is unsupported.

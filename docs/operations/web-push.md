# Web Push notifications

Web Push is built into every AllChat Instance and requires no provider account
or administrator-supplied credentials.

On first startup, the Instance creates `web-push-vapid.json` in its data
directory with mode `0600`. Keep this file with the Instance backup. Replacing
it invalidates existing browser subscriptions and Members must enable
notifications again.

## Requirements

- Serve AllChat over HTTPS. Browsers expose service workers and PushManager only
  in a secure context (localhost is the development exception).
- Permit outbound HTTPS to the browser push services used by Chrome/Chromium,
  Firefox, Safari, and Edge.
- Members must click **Enable background notifications** and approve the browser
  permission prompt. An administrator cannot grant this permission for them.
- On iPhone and iPad, Members must install the site on the Home Screen before
  Safari offers Web Push permission.

Subscriptions stay in the Instance database and are bound to the authenticated
Session that created them. Revoking that Session immediately stops delivery.
Expired endpoints are removed after a push provider returns HTTP 404 or 410.

The Instance applies Community and conversation notification levels before
sending. A `mentions_only` subscription receives only structured Mentions, muted
conversations receive nothing, and the notification sound setting maps to the
Web Notification `silent` option. When an AllChat tab is visible, the service
worker suppresses the operating-system notification because the live client has
already handled that Message.

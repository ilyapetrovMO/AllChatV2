# Activities

Activities are modular browser applications installed on one AllChat Instance. The bundled `allchat.sketchboard` Activity is the reference implementation.

## Package format

A third-party Activity is a zip archive no larger than 10 MiB. It contains only static browser assets and a root `manifest.json`:

```json
{
  "id": "example.timer",
  "name": "Shared Timer",
  "description": "A timer for everyone in the room.",
  "developer": "Example",
  "version": "1.0.0",
  "host_api_versions": [1],
  "capabilities": ["community.identity"],
  "entry_point": "index.html"
}
```

IDs use reverse-domain-style lowercase names. Paths must remain inside the archive. An archive may contain at most 100 files and 25 MiB of uncompressed data. Activity packages cannot contain or execute Instance-side code.

The Community Owner installs a package with `POST /api/v1/admin/activities/install`, sending the zip as the request body with their normal session and CSRF headers. New and updated packages are disabled by default. The owner reviews the manifest and enables it with `PUT /api/v1/admin/activities/{activityID}` and `{"enabled":true}`.

## Runtime contract

The client launches an enabled Activity through `POST /api/v1/activities/{activityID}/launch`. The response contains a runtime URL and short-lived Activity token. Clients load the URL in an iframe with `sandbox="allow-scripts"` and put the token in the URL fragment. Fragments are not sent in HTTP requests.

Activity code reads `location.hash.slice(1)` and authenticates host API calls with:

```text
Authorization: Activity <token>
```

`GET /api/v1/activities/session` returns the Activity ID, current Member identity, optional Activity Resource ID, expiry, and host API version. Activity tokens cannot authenticate normal AllChat APIs and are invalidated when the Activity is disabled.

The runtime sends a restrictive Content Security Policy, disables referrers and MIME sniffing, and has no access to the parent page's cookies or DOM. Installed files are served from `/activity-runtime/{activityID}/`.

## Sketchboard

Opening Sketchboard first shows a grid of current Sketchboards, their owner, and active participants. Any Member may create or enter one. Only its creator may delete it. Drawing changes are durable, server-ordered operations; active participant presence uses renewable leases and is not persisted.

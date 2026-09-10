# API versioning

API compatibility is an HTTP concern and is independent from Docker tags or
frontend/backend source revisions.

The browser sends the requested contract on every API call:

```http
X-Overtone-API-Version: 1
```

The backend echoes the selected version and advertises all versions it can
serve:

```http
X-Overtone-API-Version: 1
X-Overtone-Supported-API-Versions: 1
```

An unsupported version receives `412 API_VERSION_UNSUPPORTED`. Requests without
the version header use the current default version so health checks and manual
diagnostics remain convenient.

Additive response fields and new endpoints do not require a version bump.
Removing or changing an existing field, status meaning, or request shape does.
For a breaking change, the backend must support both the old and new versions
during migration. The new frontend can then be deployed independently; the old
contract is removed only after old clients are no longer in use.

Git SHA remains an immutable identifier for each individual image. Backend and
frontend images are not required to share the same SHA.

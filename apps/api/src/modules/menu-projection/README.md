# QR menu projection sync boundaries

The local worker is outbound-only and production endpoints must be HTTPS. Menu,
CMS and public settings mutations create a versioned full snapshot in the same
PostgreSQL transaction. Cloud derives tenant identity from the active license
and hardware binding; payload `tenantId`, slug, domain and public ID are never
trusted as authority.

Open blockers intentionally left outside this increment:

- Media upload/object storage is not implemented. Only already-public,
  credentials-free HTTPS asset URLs are projected. Relative paths, local LAN
  URLs, localhost/private addresses and URL fragments/query strings are omitted.
- Raw license key plus hardware ID is replayable if both are copied from a
  compromised machine. The next protocol version must replace these long-lived
  headers with a short-lived heartbeat-issued sync token and TPM/CNG-backed
  challenge signing.
- `Tenant.customDomain` is cloud-owned and cannot be selected by a local
  publisher, but there is no DNS/domain-ownership verification state in the
  current schema. A verified-domain workflow is required before arbitrary
  custom domains should be routed in production.
- Restore/reinstall epoch reset authorization from design document 07 is not
  implemented. A restored database whose sequence is behind cloud is rejected
  as stale instead of silently rolling the publication backward.

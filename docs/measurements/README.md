# Historical measurement evidence

These JSON files, logs and screenshots support the [dated audit and release reports](../history/README.md). They are observations of particular source versions, fixtures, services and times. They are not live health, billing or deployment status.

Keep retained manifests and their evidence together. The cleanup audited the logs and found filename references in the reports/manifests; none was removed merely for being generated. Machine-readable evidence has not been rewritten or sanitized, preserving its checksums and operational meaning. Public narrative examples use placeholders; operational resource identities in original evidence are historical provenance.

New profiles and synthetic cost reports write to ignored `.local/measurements/` (or the tool's existing `.local/audit*/` directory). Promote only deliberate, reviewed evidence into this folder and link it from a dated report. See [development](../development.md#generated-output-and-assets).

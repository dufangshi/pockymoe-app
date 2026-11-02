# Relay ActivityKit golden payloads

These JSON files are byte-for-byte copies from the Pockymoe control-plane
repository's `crates/relay/test-fixtures/` at commit
`91f5d593458aa892e9ad4ff9d568436f9081d54a`.

- `live-activity-update.json`: SHA-256 `77c6d5f44980c89490c70b4d06af17de2aa6f363345e152104d6abd627edd114`
- `live-activity-end.json`: SHA-256 `2fb19032cc06f0a8c690035a16ca9077d60625b78d7bae9b2f55de9e92f91a29`

Update from the Relay fixtures without reformatting. The Swift decoder regression
uses these exact bytes. Content-state Dates use Foundation's reference epoch
(2001-01-01); APNs timestamp/dismissal-date use Unix seconds. None contains titles,
device/workspace names, request text or results.

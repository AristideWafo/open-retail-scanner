# ADR 0002 — latest-frame worker pipeline

**Status:** proposed

## Context

Camera streams can produce frames faster than a decoder can consume them. Queuing frames increases latency and can block the UI. JPEG/base64 conversion also adds copies and encode/decode work.

## Decision

Process at most one current frame in a worker and replace any pending stale frame with the newest available frame. Prefer luminance buffers, `VideoFrame`, or `ImageBitmap`; do not use JPEG/base64 in the real-time loop.

## Consequences

- Bounded latency and memory.
- More platform-specific capability handling.
- Requires deterministic scheduler tests and explicit resource teardown.

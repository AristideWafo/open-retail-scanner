import { canonicalValue, isValidCode } from "./checksum.ts";
import type { BarcodeFormat, Point, ScanResult } from "./index.ts";

export interface ConsensusOptions {
  readonly requiredConfirmingFrames?: number;
  readonly windowMs?: number;
  readonly duplicateCooldownMs?: number;
}

export interface FrameObservation {
  readonly rawValue: string;
  readonly format: BarcodeFormat;
  readonly timestampMs: number;
  readonly engineVersion: string;
  readonly bounds?: readonly Point[];
}

const DEFAULT_REQUIRED_CONFIRMING_FRAMES = 2;
const DEFAULT_WINDOW_MS = 1500;
const DEFAULT_DUPLICATE_COOLDOWN_MS = 2000;

/**
 * Stateful time-windowed consensus tracker that emits a ScanResult only after
 * observing N checksum-valid confirming frames for the same canonical code
 * within the configured window and outside the duplicate cooldown.
 */
export class ConsensusTracker {
  private readonly requiredConfirmingFrames: number;
  private readonly windowMs: number;
  private readonly duplicateCooldownMs: number;

  private candidateCanonical: string | null = null;
  private candidateTimestamps: number[] = [];
  private lastEmittedCanonical: string | null = null;
  private lastEmittedAtMs: number | null = null;

  constructor(options: ConsensusOptions = {}) {
    const requiredConfirmingFrames =
      options.requiredConfirmingFrames ?? DEFAULT_REQUIRED_CONFIRMING_FRAMES;
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    const duplicateCooldownMs =
      options.duplicateCooldownMs ?? DEFAULT_DUPLICATE_COOLDOWN_MS;

    if (
      !Number.isInteger(requiredConfirmingFrames) ||
      requiredConfirmingFrames < 1
    ) {
      throw new RangeError(
        "requiredConfirmingFrames must be a positive integer",
      );
    }
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new RangeError("windowMs must be a non-negative finite number");
    }
    if (!Number.isFinite(duplicateCooldownMs) || duplicateCooldownMs < 0) {
      throw new RangeError(
        "duplicateCooldownMs must be a non-negative finite number",
      );
    }

    this.requiredConfirmingFrames = requiredConfirmingFrames;
    this.windowMs = windowMs;
    this.duplicateCooldownMs = duplicateCooldownMs;
  }

  observe(obs: FrameObservation): ScanResult | null {
    if (!Number.isFinite(obs.timestampMs)) {
      this.resetCandidate();
      return null;
    }

    if (!isValidCode(obs.rawValue, obs.format)) {
      this.resetCandidate();
      return null;
    }

    const canonical = canonicalValue(obs.rawValue, obs.format);

    if (this.candidateCanonical !== canonical) {
      this.candidateCanonical = canonical;
      this.candidateTimestamps = [obs.timestampMs];
    } else {
      const cutoff = obs.timestampMs - this.windowMs;
      let keepFrom = 0;
      while (keepFrom < this.candidateTimestamps.length) {
        const ts = this.candidateTimestamps[keepFrom];
        if (ts !== undefined && ts >= cutoff && ts <= obs.timestampMs) {
          break;
        }
        keepFrom++;
      }
      if (keepFrom > 0) {
        this.candidateTimestamps = this.candidateTimestamps.slice(keepFrom);
      }
      this.candidateTimestamps.push(obs.timestampMs);
    }

    const confirmingFrames = this.candidateTimestamps.length;
    if (confirmingFrames < this.requiredConfirmingFrames) {
      return null;
    }

    if (
      this.lastEmittedCanonical === canonical &&
      this.lastEmittedAtMs !== null &&
      obs.timestampMs - this.lastEmittedAtMs < this.duplicateCooldownMs
    ) {
      return null;
    }

    this.lastEmittedCanonical = canonical;
    this.lastEmittedAtMs = obs.timestampMs;
    this.resetCandidate();

    const evidence = {
      checksumValid: true as const,
      confirmingFrames,
    };

    if (obs.bounds !== undefined) {
      return {
        rawValue: obs.rawValue,
        canonicalValue: canonical,
        format: obs.format,
        bounds: obs.bounds,
        timestampMs: obs.timestampMs,
        engineVersion: obs.engineVersion,
        evidence,
      };
    }

    return {
      rawValue: obs.rawValue,
      canonicalValue: canonical,
      format: obs.format,
      timestampMs: obs.timestampMs,
      engineVersion: obs.engineVersion,
      evidence,
    };
  }

  reset(): void {
    this.resetCandidate();
    this.lastEmittedCanonical = null;
    this.lastEmittedAtMs = null;
  }

  private resetCandidate(): void {
    this.candidateCanonical = null;
    this.candidateTimestamps = [];
  }
}

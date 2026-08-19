// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10.5 — `ProposalSignalChannel` (ruling #R4).
 *
 * Concrete composition-root implementation of both `ProposalSignalSink`
 * and `ProposalSignalSource`. Owns an in-memory buffer of signals
 * published by A5 and read by P5.5/P5.6 via A7.
 *
 * Buffer is private; consumers see only the two contracts. Reads are
 * non-destructive (idempotent snapshot) per ruling #R4.
 *
 * The channel is a **delivery mechanism**, not a source of truth. The
 * durable `measured` event in the EventLog is authoritative; loss of
 * in-memory state is recoverable by replay (CAP-12+).
 *
 * @module capability/evolution/proposal-signal-channel
 */

import type {
  CapabilityEvolutionSignal,
  ProposalSignalSink,
  ProposalSignalSource,
} from "./proposals.js";

export class ProposalSignalChannel
  implements ProposalSignalSink, ProposalSignalSource
{
  private readonly signalsBuffer: CapabilityEvolutionSignal[] = [];

  async publish(signal: CapabilityEvolutionSignal): Promise<void> {
    this.signalsBuffer.push(signal);
  }

  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [...this.signalsBuffer];
  }
}
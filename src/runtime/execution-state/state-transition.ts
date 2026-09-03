// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
// Re-export: canonical harness lives at src/runtime/state/state-transition.ts
// (issue #627 scope says src/runtime/state/state-transition.ts). This file
// provides a compatibility alias so both import paths work.
export * from "../state/state-transition.js";

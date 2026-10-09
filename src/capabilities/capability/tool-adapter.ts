// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { ToolProviderExecutor } from "./provider-executor.js";
import type { ToolExecutorLike } from "./provider-executor.js";

/** Adapts the existing ToolExecutor.execute() seam to the tool provider. */
export function createToolProviderExecutor(executor: ToolExecutorLike): ToolProviderExecutor {
  return new ToolProviderExecutor(executor);
}

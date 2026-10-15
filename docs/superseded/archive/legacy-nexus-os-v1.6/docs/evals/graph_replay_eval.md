# Graph Replay Evaluation

Graph replay must validate that non-side-effecting nodes can replay from checkpoint, failed nodes can be replayed in isolation, and interrupted side-effecting nodes require manual approval before retry.

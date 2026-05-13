import { add } from "./add";

if (add(1, 2) !== 3) {
  throw new Error("add failed");
}

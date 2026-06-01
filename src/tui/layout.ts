export const LAYOUT = {
  /** Standard indentation for nested items */
  indent: 2,
  /** Characters per indentation level */
  indentChar: " ",
  /** Box drawing characters */
  box: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    teeDown: "┬",
    teeUp: "┴",
    teeRight: "├",
    teeLeft: "┤",
    cross: "┼",
  },
  /** Spacing between sections */
  sectionGap: 1,
  /** Color codes for budget usage thresholds */
  budgetColor: {
    safe: "32",    // green
    warn: "33",    // yellow
    danger: "31",  // red
  },
  /** Budget thresholds (0-1) */
  budgetThreshold: {
    warn: 0.7,
    danger: 0.9,
  },
};

import type { WorkbenchUiAction } from '../model/ui-action.js';
import { createInitialWorkbenchUiState, type WorkbenchUiState } from '../model/ui-state.js';
import { graphemes } from '../render/terminal-text.js';

export function reduceWorkbenchUiState(
  state: WorkbenchUiState,
  action: WorkbenchUiAction,
): WorkbenchUiState {
  switch (action.type) {
    case 'composer.insert': {
      const before = state.composer.text.slice(0, state.composer.cursor);
      const after = state.composer.text.slice(state.composer.cursor);
      return {
        ...state,
        composer: {
          text: before + action.text + after,
          cursor: state.composer.cursor + action.text.length,
        },
      };
    }
    case 'composer.backspace': {
      if (state.composer.cursor === 0) return state;
      const beforeCursor = state.composer.text.slice(0, state.composer.cursor);
      const previous = graphemes(beforeCursor).at(-1);
      if (!previous) return state;
      const nextCursor = state.composer.cursor - previous.length;
      const before = state.composer.text.slice(0, nextCursor);
      const after = state.composer.text.slice(state.composer.cursor);
      return {
        ...state,
        composer: { text: before + after, cursor: nextCursor },
      };
    }
    case 'composer.move': {
      const { text, cursor } = state.composer;
      let nextCursor = cursor;
      if (action.direction === 'start') nextCursor = 0;
      else if (action.direction === 'end') nextCursor = text.length;
      else if (action.direction === 'left') {
        const previous = graphemes(text.slice(0, cursor)).at(-1);
        if (previous) nextCursor -= previous.length;
      } else {
        const next = graphemes(text.slice(cursor))[0];
        if (next) nextCursor += next.length;
      }
      return nextCursor === cursor
        ? state
        : { ...state, composer: { text, cursor: nextCursor } };
    }
    case 'composer.clear':
      return { ...state, composer: { text: '', cursor: 0 } };
    case 'composer.replace':
      return { ...state, composer: { text: action.text, cursor: action.text.length } };
    case 'queue.add':
      return { ...state, queuedMessages: [...state.queuedMessages, action.message] };
    case 'queue.shift':
      return state.queuedMessages.length === 0
        ? state
        : { ...state, queuedMessages: state.queuedMessages.slice(1) };
    case 'focus.set':
      return { ...state, focus: action.focus };
    case 'drawer.toggle':
      return { ...state, drawer: state.drawer === action.drawer ? 'closed' : action.drawer };
    case 'overlay.toggle': {
      const current = state.overlayStack[state.overlayStack.length - 1];
      return { ...state, focus: current === action.overlay ? 'composer' : 'modal', overlayStack: current === action.overlay ? [] : [action.overlay] };
    }
    case 'overlay.close':
      return state.overlayStack.length === 0 ? state : { ...state, focus: 'composer', overlayStack: [] };
    case 'transcript.mode':
      return { ...state, transcriptMode: action.mode };
    case 'dimensions.set':
      return { ...state, dimensions: { columns: action.columns, rows: action.rows } };
  }
}

export class WorkbenchStore {
  private state: WorkbenchUiState;

  constructor(initialState: WorkbenchUiState = createInitialWorkbenchUiState()) {
    this.state = initialState;
  }

  snapshot(): WorkbenchUiState {
    return this.state;
  }

  dispatch(action: WorkbenchUiAction): WorkbenchUiState {
    this.state = reduceWorkbenchUiState(this.state, action);
    return this.state;
  }
}

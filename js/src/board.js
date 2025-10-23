import { INPUT_EVENT_TYPE, FEN, COLOR, Chessboard, BORDER_TYPE } from "cm-chessboard";
import { MARKER_TYPE, Markers } from "cm-chessboard/src/extensions/markers/Markers.js";
import { PROMOTION_DIALOG_RESULT_TYPE, PromotionDialog }
  from "cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js";
import { Accessibility } from "cm-chessboard/src/extensions/accessibility/Accessibility.js";
import { RightClickAnnotator }
  from "cm-chessboard/src/extensions/right-click-annotator/RightClickAnnotator.js";

import { Chess, validateFen } from "Chess.js"
import { dbg, dbobj } from "./utils.js";

export const chess = new Chess();

class PositionChangedEmitter extends EventTarget {
  constructor(name) {
    super(); // Call the constructor of the parent EventTarget class
    this.name = name;
  }

  raisePositionChanged(event) {
    const positionChangedEvent = new CustomEvent('positionChanged');
    positionChangedEvent.wrappedEvent = event;
    this.dispatchEvent(positionChangedEvent);
  }
}

const emitter = new PositionChangedEmitter();

export function addEventListener(handler) {
    emitter.addEventListener('positionChanged', handler);
}

function inputHandler(event) {
  if (event.type === INPUT_EVENT_TYPE.movingOverSquare) {
    return true; // ignore, but don't cancel move
  }
  if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
    event.chessboard.removeLegalMovesMarkers()
    if (event.legalMove) {
      emitter.raisePositionChanged(event);
    }
    return event.legalMove;
  }
  if (event.type === INPUT_EVENT_TYPE.moveInputCanceled) {
    return false;
  }
  if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
    // mark legal moves
    const moves = chess.moves({
      square: event.squareFrom,
      verbose: true
    })
    event.chessboard.addLegalMovesMarkers(moves)
    return moves.length > 0; // cancel if no moves
  }
  if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
    const move = {
      from: event.squareFrom,
      to: event.squareTo,
      promotion: event.promotion
    }
    let result = null;
    try {
      result = chess.move(move);
    } catch (err) {
      result = null;
    }
    if (result) {
      event.chessboard.state.moveInputProcess.then(() => { // wait for move input process to finish
        event.chessboard.setPosition(chess.fen(), true);
      })
    } else {
      // promotion?
      let possibleMoves = chess.moves({
        square: event.squareFrom,
        verbose: true
      })
      result = false;
      for (const possibleMove of possibleMoves) {
        if (possibleMove.promotion && possibleMove.to === event.squareTo) {
          event.chessboard.showPromotionDialog(event.squareTo, chess.turn(), (result) => {
            if (result.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected) {
              chess.move({
                from: event.squareFrom,
                to: event.squareTo,
                promotion: result.piece.charAt(1)
              })
              result = true;
            }
            event.chessboard.setPosition(chess.fen(), true);
          })
        }
      }
    }
    return result
  }
  console.warn(`unknown move event type: ${event.type}`);
  return true;
}

export const board = new Chessboard(document.getElementById("board"), {
  position: chess.fen(),
  assetsUrl: "/assets/",
  style: {
    borderType: BORDER_TYPE.none,
    pieces: {
      file: "pieces/staunty.svg"
    },
    animationDuration: 300
  },
  orientation: COLOR.white,
  extensions: [{
      class: Markers,
      props: {
        autoMarkers: MARKER_TYPE.square
      }
    },
    {
      class: RightClickAnnotator
    },
    {
      class: PromotionDialog
    },
    {
      class: Accessibility,
      props: {
        visuallyHidden: true
      }
    }
  ]
})

export function validate(fen) {
  return validateFen(fen);
}

export function start() {
  board.enableMoveInput(inputHandler);
}

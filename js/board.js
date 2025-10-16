import { INPUT_EVENT_TYPE, FEN, COLOR, Chessboard, BORDER_TYPE } from "cm-chessboard";
import { MARKER_TYPE, Markers } from "cm-chessboard/src/extensions/markers/Markers.js";
import { PROMOTION_DIALOG_RESULT_TYPE, PromotionDialog }
  from "cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js";
import { Accessibility } from "cm-chessboard/src/extensions/accessibility/Accessibility.js";
import { RightClickAnnotator }
  from "cm-chessboard/src/extensions/right-click-annotator/RightClickAnnotator.js";

import { Chess } from "Chess.js"
import { dbg, dbobj } from "./utils.js";

const chess = new Chess()

function inputHandler(event) {
  dbg(`inputHandler ${event}`);
  if (event.type === INPUT_EVENT_TYPE.movingOverSquare) {
    return true; // ignore, but don't cancel move
  }
  if (event.type !== INPUT_EVENT_TYPE.moveInputFinished) {
    event.chessboard.removeLegalMovesMarkers()
    return true;
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
      for (const possibleMove of possibleMoves) {
        if (possibleMove.promotion && possibleMove.to === event.squareTo) {
          event.chessboard.showPromotionDialog(event.squareTo, COLOR.white, (result) => {
            dbg(`promotion result ${result}`)
            if (result.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected) {
              chess.move({
                from: event.squareFrom,
                to: event.squareTo,
                promotion: result.piece.charAt(1)
              })
              event.chessboard.setPosition(chess.fen(), true)
            } else {
              // promotion canceled
              event.chessboard.enableMoveInput(inputHandler, COLOR.white)
              event.chessboard.setPosition(chess.fen(), true)
            }
          })
          result = true;
        }
      }
    }
    return result
  }
  if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
    if (event.legalMove) {
      return true;
    }
  }
  dbobj(`unknown move even type ${event}`);
  return true; // ???
}

const board = new Chessboard(document.getElementById("board"), {
  position: chess.fen(),
  assetsUrl: "../assets/",
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

export function setPosition(fen) {
  board.setPosition(fen);
}

export function start(nextPlayer) {
  board.enableMoveInput(inputHandler, COLOR.white);
}

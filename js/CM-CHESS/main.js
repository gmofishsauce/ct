import {INPUT_EVENT_TYPE, FEN, COLOR, Chessboard, BORDER_TYPE} from "cm-chessboard";
import {MARKER_TYPE, Markers} from "cm-chessboard/src/extensions/markers/Markers.js";
import {
  PROMOTION_DIALOG_RESULT_TYPE,
  PromotionDialog
} from "cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js";
import {Accessibility} from "cm-chessboard/src/extensions/accessibility/Accessibility.js";
import {RightClickAnnotator} from "cm-chessboard/src/extensions/right-click-annotator/RightClickAnnotator.js";

import {Chess} from "Chess.js"

const chess = new Chess()

let seed = 71;
function random() {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

function makeEngineMove(chessboard) {
    const possibleMoves = chess.moves({verbose: true})
    if (possibleMoves.length > 0) {
        const randomIndex = Math.floor(random() * possibleMoves.length)
        const randomMove = possibleMoves[randomIndex]
        setTimeout(() => { // smoother with 500ms delay
            chess.move({from: randomMove.from, to: randomMove.to})
            chessboard.setPosition(chess.fen(), true)
            chessboard.enableMoveInput(inputHandler, COLOR.white)
        }, 500)
    }
}

function inputHandler(event) {
    log("inputHandler", event)
    if(event.type === INPUT_EVENT_TYPE.movingOverSquare) {
        return // ignore this event
    }
    if(event.type !== INPUT_EVENT_TYPE.moveInputFinished) {
        event.chessboard.removeLegalMovesMarkers()
    }
    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
        // mark legal moves
        const moves = chess.moves({square: event.squareFrom, verbose: true})
        event.chessboard.addLegalMovesMarkers(moves)
        return moves.length > 0
    } else if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
        // XXX FIXME TODO needs exception handling for cases where
        // the board library allows the move but the chess library
        // does not, e.g. checks, ep captures, etc.
        const move = {from: event.squareFrom, to: event.squareTo, promotion: event.promotion}
        const result = chess.move(move)
        if (result) {
            event.chessboard.state.moveInputProcess.then(() => { // wait for the move input process has finished
                event.chessboard.setPosition(chess.fen(), true).then(() => { // update position, maybe castled and wait for animation has finished
                    makeEngineMove(event.chessboard)
                })
            })
        } else {
            // promotion?
            let possibleMoves = chess.moves({square: event.squareFrom, verbose: true})
            for (const possibleMove of possibleMoves) {
                if (possibleMove.promotion && possibleMove.to === event.squareTo) {
                    event.chessboard.showPromotionDialog(event.squareTo, COLOR.white, (result) => {
                        log("promotion result", result)
                        if (result.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected) {
                            chess.move({from: event.squareFrom, to: event.squareTo, promotion: result.piece.charAt(1)})
                            event.chessboard.setPosition(chess.fen(), true)
                            makeEngineMove(event.chessboard)
                        } else {
                            // promotion canceled
                            event.chessboard.enableMoveInput(inputHandler, COLOR.white)
                            event.chessboard.setPosition(chess.fen(), true)
                        }
                    })
                    return true
                }
            }
        }
        return result
    } else if (event.type === INPUT_EVENT_TYPE.moveInputFinished) {
        if(event.legalMove) {
            event.chessboard.disableMoveInput()
        }
    }
}

const board = new Chessboard(document.getElementById("board"), {
    position: chess.fen(),
    assetsUrl: "../assets/",
    style: {borderType: BORDER_TYPE.none, pieces: {file: "pieces/staunty.svg"}, animationDuration: 300},
    orientation: COLOR.white,
    extensions: [
        {class: Markers, props: {autoMarkers: MARKER_TYPE.square}},
        {class: RightClickAnnotator},
        {class: PromotionDialog},
        {class: Accessibility, props: {visuallyHidden: true}}
    ]
})
board.enableMoveInput(inputHandler, COLOR.white)

// ===================== OLD ========================

// window.board = new Chessboard(document.getElementById("board"), {
//     position: FEN.start,
//     assetsUrl: "../assets/",
//     style: {pieces: {file: "pieces/staunty.svg"}},
//     extensions: [{class: Markers}]
// })
// 
// window.board.enableMoveInput(inputHandler)
// 
// function inputHandler(event) {
//     console.log(event)
//     switch (event.type) {
//         case INPUT_EVENT_TYPE.moveInputStarted:
//             log(`moveInputStarted: ${event.squareFrom}`)
//             return true // false cancels move
//         case INPUT_EVENT_TYPE.validateMoveInput:
//             log(`validateMoveInput: ${event.squareFrom}-${event.squareTo}`)
//             return true // false cancels move
//         case INPUT_EVENT_TYPE.moveInputCanceled:
//             log(`moveInputCanceled`)
//             break
//         case INPUT_EVENT_TYPE.moveInputFinished:
//             log(`moveInputFinished`)
//             break
//         case INPUT_EVENT_TYPE.movingOverSquare:
//             log(`movingOverSquare: ${event.squareTo}`)
//             break
//     }
// }
// 
const output = document.getElementById("output")

function log(text) {
    const log = document.createElement("div")
    log.innerText = text
    output.appendChild(log)
}

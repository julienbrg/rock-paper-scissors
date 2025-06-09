// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

/**
 * @title Game
 * @author Your Name
 * @notice A Rock-Paper-Scissors game contract
 * @dev Best of 3 rounds game where first player to win 2 rounds wins the game
 * Move encoding: 1 = Rock, 2 = Paper, 3 = Scissors
 */
contract Game {
    /// @notice Address of player 1
    address public player1;

    /// @notice Address of player 2
    address public player2;

    /// @notice Number of rounds won by player 1
    uint8 public player1Wins;

    /// @notice Number of rounds won by player 2
    uint8 public player2Wins;

    /// @notice Current round number (starts at 1)
    uint8 public currentRound;

    /// @notice Mapping of round number to player 1's move
    mapping(uint8 => uint8) public player1Moves;

    /// @notice Mapping of round number to player 2's move
    mapping(uint8 => uint8) public player2Moves;

    /// @notice Whether the game has ended
    bool public gameOver;

    /// @notice Address of the winner (only set when game is over)
    address public winner;

    // Custom Errors
    error GameAlreadyOver();
    error InvalidMove(uint8 move);
    error NotAPlayer(address caller);
    error AlreadyMoved(address player, uint8 round);

    // Events
    /**
     * @notice Emitted when a player makes a move
     * @param player The address of the player
     * @param round The round number
     * @param move The move made (1=Rock, 2=Paper, 3=Scissors)
     */
    event MoveMade(address indexed player, uint8 indexed round, uint8 move);

    /**
     * @notice Emitted when a round is completed
     * @param round The completed round number
     * @param player1Move Player 1's move
     * @param player2Move Player 2's move
     * @param roundWinner Address of round winner (address(0) for tie)
     */
    event RoundCompleted(uint8 indexed round, uint8 player1Move, uint8 player2Move, address indexed roundWinner);

    /**
     * @notice Emitted when the game ends
     * @param winner Address of the game winner
     * @param player1Wins Final wins for player 1
     * @param player2Wins Final wins for player 2
     */
    event GameEnded(address indexed winner, uint8 player1Wins, uint8 player2Wins);

    /**
     * @notice Initialize the game with two players
     * @param _player1 Address of the first player
     * @param _player2 Address of the second player
     */
    constructor(address _player1, address _player2) {
        player1 = _player1;
        player2 = _player2;
        currentRound = 1;
    }

    /**
     * @notice Make a move in the current round
     * @param _move The move to make (1=Rock, 2=Paper, 3=Scissors)
     * @dev Both players must make a move before the round is processed
     */
    function move(uint8 _move) public {
        if (gameOver) revert GameAlreadyOver();
        if (_move < 1 || _move > 3) revert InvalidMove(_move);
        if (msg.sender != player1 && msg.sender != player2) revert NotAPlayer(msg.sender);

        if (msg.sender == player1) {
            if (player1Moves[currentRound] != 0) revert AlreadyMoved(msg.sender, currentRound);
            player1Moves[currentRound] = _move;
        } else {
            if (player2Moves[currentRound] != 0) revert AlreadyMoved(msg.sender, currentRound);
            player2Moves[currentRound] = _move;
        }

        emit MoveMade(msg.sender, currentRound, _move);

        if (player1Moves[currentRound] != 0 && player2Moves[currentRound] != 0) {
            processRound();
        }
    }

    /**
     * @notice Process the current round and determine the winner
     * @dev Internal function called when both players have made their moves
     * Rock beats Scissors, Paper beats Rock, Scissors beats Paper
     */
    function processRound() internal {
        uint8 p1Move = player1Moves[currentRound];
        uint8 p2Move = player2Moves[currentRound];
        address roundWinner = address(0);

        if (p1Move == p2Move) {
            // Tie - no winner
        } else if (
            (p1Move == 1 && p2Move == 3) || // Rock beats Scissors
            (p1Move == 2 && p2Move == 1) || // Paper beats Rock
            (p1Move == 3 && p2Move == 2) // Scissors beats Paper
        ) {
            player1Wins++;
            roundWinner = player1;
        } else {
            player2Wins++;
            roundWinner = player2;
        }

        emit RoundCompleted(currentRound, p1Move, p2Move, roundWinner);

        if (player1Wins == 2) {
            gameOver = true;
            winner = player1;
            emit GameEnded(player1, player1Wins, player2Wins);
        } else if (player2Wins == 2) {
            gameOver = true;
            winner = player2;
            emit GameEnded(player2, player1Wins, player2Wins);
        } else {
            currentRound++;
        }
    }

    /**
     * @notice Get the current state of the game
     * @return player1Wins_ Number of rounds won by player 1
     * @return player2Wins_ Number of rounds won by player 2
     * @return currentRound_ Current round number
     * @return gameOver_ Whether the game has ended
     * @return winner_ Address of the winner (address(0) if game not over)
     */
    function getGameState()
        public
        view
        returns (uint8 player1Wins_, uint8 player2Wins_, uint8 currentRound_, bool gameOver_, address winner_)
    {
        return (player1Wins, player2Wins, currentRound, gameOver, winner);
    }

    /**
     * @notice Get moves for a specific round
     * @param round The round number to query
     * @return player1Move Player 1's move for the round (0 if not made)
     * @return player2Move Player 2's move for the round (0 if not made)
     */
    function getRoundMoves(uint8 round) public view returns (uint8 player1Move, uint8 player2Move) {
        return (player1Moves[round], player2Moves[round]);
    }
}

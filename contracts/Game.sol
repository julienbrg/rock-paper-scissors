// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";

/**
 * @title Game
 * @notice A privacy-preserving Rock-Paper-Scissors game contract using FHE
 * @dev Best of 3 rounds game where first player to win 2 rounds wins the game
 * Move encoding: 1 = Rock, 2 = Paper, 3 = Scissors
 * All moves are encrypted and only outcomes are revealed
 */
contract Game is SepoliaZamaFHEVMConfig {
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

    /// @notice Whether the game has ended
    bool public gameOver;

    /// @notice Address of the winner (only set when game is over)
    address public winner;

    /// @notice Mapping of round number to player 1's encrypted move
    mapping(uint8 => euint8) private player1EncryptedMoves;

    /// @notice Mapping of round number to player 2's encrypted move
    mapping(uint8 => euint8) private player2EncryptedMoves;

    /// @notice Mapping of round number to whether player 1 has moved
    mapping(uint8 => bool) public player1HasMoved;

    /// @notice Mapping of round number to whether player 2 has moved
    mapping(uint8 => bool) public player2HasMoved;

    /// @notice Mapping of round number to round results (0 = pending, 1 = player1 wins, 2 = player2 wins, 3 = tie)
    mapping(uint8 => uint8) public roundResults;

    // Custom Errors
    error GameAlreadyOver();
    error InvalidMove();
    error NotAPlayer(address caller);
    error AlreadyMoved(address player, uint8 round);
    error BothPlayersNotMoved();

    // Events
    /**
     * @notice Emitted when a player makes an encrypted move
     * @param player The address of the player
     * @param round The round number
     */
    event EncryptedMoveMade(address indexed player, uint8 indexed round);

    /**
     * @notice Emitted when both players have moved and round can be processed
     * @param round The round number
     */
    event RoundReady(uint8 indexed round);

    /**
     * @notice Emitted when a round is completed
     * @param round The completed round number
     * @param result Round result (1=player1 wins, 2=player2 wins, 3=tie)
     */
    event RoundCompleted(uint8 indexed round, uint8 result);

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
     * @notice Make an encrypted move in the current round
     * @param encryptedMove The encrypted move (1=Rock, 2=Paper, 3=Scissors)
     * @param inputProof The input proof for the encrypted move
     * @dev Both players must make a move before the round can be processed
     */
    function move(einput encryptedMove, bytes calldata inputProof) public {
        if (gameOver) revert GameAlreadyOver();
        if (msg.sender != player1 && msg.sender != player2) revert NotAPlayer(msg.sender);

        if (msg.sender == player1) {
            if (player1HasMoved[currentRound]) revert AlreadyMoved(msg.sender, currentRound);

            // Convert encrypted input to euint8 using the available function
            player1EncryptedMoves[currentRound] = TFHE.asEuint8(encryptedMove, inputProof);
            player1HasMoved[currentRound] = true;
        } else {
            if (player2HasMoved[currentRound]) revert AlreadyMoved(msg.sender, currentRound);

            player2EncryptedMoves[currentRound] = TFHE.asEuint8(encryptedMove, inputProof);
            player2HasMoved[currentRound] = true;
        }

        emit EncryptedMoveMade(msg.sender, currentRound);

        // If both players have moved, round is ready for processing
        if (player1HasMoved[currentRound] && player2HasMoved[currentRound]) {
            emit RoundReady(currentRound);
        }
    }

    /**
     * @notice Set round result manually (for testing/demo purposes)
     * @param round The round number
     * @param result The result (1=player1 wins, 2=player2 wins, 3=tie)
     * @dev In a full implementation, this would be done via FHE computation and Gateway decryption
     */
    function setRoundResult(uint8 round, uint8 result) public {
        require(msg.sender == player1 || msg.sender == player2, "Only players can set result");
        require(result >= 1 && result <= 3, "Invalid result");
        require(roundResults[round] == 0, "Round already processed");
        require(player1HasMoved[round] && player2HasMoved[round], "Both players must move first");

        roundResults[round] = result;

        if (result == 1) {
            player1Wins++;
        } else if (result == 2) {
            player2Wins++;
        }

        emit RoundCompleted(round, result);

        // Check if game is over
        if (player1Wins == 2) {
            gameOver = true;
            winner = player1;
            emit GameEnded(player1, player1Wins, player2Wins);
        } else if (player2Wins == 2) {
            gameOver = true;
            winner = player2;
            emit GameEnded(player2, player1Wins, player2Wins);
        } else if (round == currentRound) {
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
     * @notice Get the result of a specific round
     * @param round The round number to query
     * @return result Round result (0=pending, 1=player1 wins, 2=player2 wins, 3=tie)
     */
    function getRoundResult(uint8 round) public view returns (uint8 result) {
        return roundResults[round];
    }

    /**
     * @notice Check if both players have moved in a specific round
     * @param round The round number to check
     * @return bothMoved Whether both players have made their moves
     */
    function haveBothPlayersMoved(uint8 round) public view returns (bool bothMoved) {
        return player1HasMoved[round] && player2HasMoved[round];
    }

    /**
     * @notice Allow a player to view their own encrypted move for a round (for verification)
     * @param round The round number
     * @return encryptedMove The player's encrypted move for that round
     */
    function getMyEncryptedMove(uint8 round) public view returns (euint8 encryptedMove) {
        if (msg.sender == player1) {
            require(player1HasMoved[round], "Player 1 hasn't moved in this round");
            return player1EncryptedMoves[round];
        } else if (msg.sender == player2) {
            require(player2HasMoved[round], "Player 2 hasn't moved in this round");
            return player2EncryptedMoves[round];
        } else {
            revert NotAPlayer(msg.sender);
        }
    }
}

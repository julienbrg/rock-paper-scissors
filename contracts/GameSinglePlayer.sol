// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";

/**
 * @title GameSinglePlayer
 * @notice A privacy-preserving single-player Rock-Paper-Scissors game contract using FHE
 * @dev Best of 3 rounds game where first player to win 2 rounds wins the game
 * Move encoding: 1 = Rock, 2 = Paper, 3 = Scissors
 * Player 1 makes encrypted moves, Player 2 (computer) makes random moves using FHE
 * All moves are encrypted and only outcomes are revealed
 */
contract GameSinglePlayer is SepoliaZamaFHEVMConfig {
    /// @notice Address of the human player
    address public player1;

    /// @notice Address representing the computer player (zero address)
    address public constant COMPUTER_PLAYER = address(0);

    /// @notice Number of rounds won by player 1
    uint8 public player1Wins;

    /// @notice Number of rounds won by computer player
    uint8 public computerWins;

    /// @notice Current round number (starts at 1)
    uint8 public currentRound;

    /// @notice Whether the game has ended
    bool public gameOver;

    /// @notice Address of the winner (only set when game is over)
    address public winner;

    /// @notice Mapping of round number to player 1's encrypted move
    mapping(uint8 => euint8) private player1EncryptedMoves;

    /// @notice Mapping of round number to computer's encrypted move
    mapping(uint8 => euint8) private computerEncryptedMoves;

    /// @notice Mapping of round number to whether player 1 has moved
    mapping(uint8 => bool) public player1HasMoved;

    /// @notice Mapping of round number to whether computer has moved
    mapping(uint8 => bool) public computerHasMoved;

    /// @notice Mapping of round number to round results (0 = pending, 1 = player1 wins, 2 = computer wins, 3 = tie)
    mapping(uint8 => uint8) public roundResults;

    // Custom Errors
    error GameAlreadyOver();
    error InvalidMove();
    error NotThePlayer(address caller);
    error AlreadyMoved(uint8 round);
    error PlayerNotMoved();
    error RoundNotReady();

    // Events
    /**
     * @notice Emitted when the player makes an encrypted move
     * @param player The address of the player
     * @param round The round number
     */
    event PlayerMoveMade(address indexed player, uint8 indexed round);

    /**
     * @notice Emitted when the computer makes a random move
     * @param round The round number
     */
    event ComputerMoveMade(uint8 indexed round);

    /**
     * @notice Emitted when both players have moved and round can be processed
     * @param round The round number
     */
    event RoundReady(uint8 indexed round);

    /**
     * @notice Emitted when a round is completed
     * @param round The completed round number
     * @param result Round result (1=player1 wins, 2=computer wins, 3=tie)
     */
    event RoundCompleted(uint8 indexed round, uint8 result);

    /**
     * @notice Emitted when the game ends
     * @param winner Address of the game winner (address(0) for computer)
     * @param player1Wins Final wins for player 1
     * @param computerWins Final wins for computer
     */
    event GameEnded(address indexed winner, uint8 player1Wins, uint8 computerWins);

    /**
     * @notice Initialize the single-player game
     * @param _player1 Address of the human player
     */
    constructor(address _player1) {
        player1 = _player1;
        currentRound = 1;
    }

    /**
     * @notice Make an encrypted move in the current round (player only)
     * @param encryptedMove The encrypted move (1=Rock, 2=Paper, 3=Scissors)
     * @param inputProof The input proof for the encrypted move
     * @dev After player moves, computer automatically makes a random move
     */
    function move(einput encryptedMove, bytes calldata inputProof) public {
        if (gameOver) revert GameAlreadyOver();
        if (msg.sender != player1) revert NotThePlayer(msg.sender);
        if (player1HasMoved[currentRound]) revert AlreadyMoved(currentRound);

        // Convert encrypted input to euint8
        player1EncryptedMoves[currentRound] = TFHE.asEuint8(encryptedMove, inputProof);
        player1HasMoved[currentRound] = true;

        emit PlayerMoveMade(msg.sender, currentRound);

        // Automatically generate computer's random move
        _makeComputerMove();
    }

    /**
     * @notice Internal function to generate computer's random move using FHE
     * @dev Generates a random number between 1-3 for Rock, Paper, Scissors
     */
    function _makeComputerMove() internal {
        if (computerHasMoved[currentRound]) return;

        // Generate bounded random move for computer using FHE randomness
        // Upper bound must be power of 2, so use 8 and take modulo 3
        euint8 randomValue = TFHE.randEuint8(8); // Returns 0-7

        // Use modulo 3 to get 0, 1, or 2, then add 1 to get 1, 2, 3
        euint8 moduloResult = TFHE.rem(randomValue, 3); // 0, 1, or 2
        euint8 computerMove = TFHE.add(moduloResult, 1); // 1, 2, or 3

        computerEncryptedMoves[currentRound] = computerMove;
        computerHasMoved[currentRound] = true;

        emit ComputerMoveMade(currentRound);

        // Now both players have moved
        emit RoundReady(currentRound);
    }

    /**
     * @notice Process the round result using FHE computation
     * @dev This function would compare encrypted moves in a full implementation
     * For now, it triggers the demo result function
     */
    function processRound() public {
        if (gameOver) revert GameAlreadyOver();
        if (!player1HasMoved[currentRound] || !computerHasMoved[currentRound]) {
            revert RoundNotReady();
        }
        if (roundResults[currentRound] != 0) return; // Already processed

        // In a production environment with Gateway, the encrypted moves would be
        // decrypted off-chain and the result would be submitted back via callback
        // For demonstration, we use a simplified approach
        _setRoundResultDemo(currentRound);
    }

    /**
     * @notice Demo function to set round result (simulates Gateway decryption)
     * @param round The round number
     * @dev In production, this would be called by the Gateway after decryption
     */
    function _setRoundResultDemo(uint8 round) internal {
        // This is a simplified demo - in practice, you'd decrypt the actual result
        // For now, we'll use a pseudo-random result based on block data
        uint256 pseudoRandom = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, round))) % 100;

        uint8 result;
        if (pseudoRandom < 33) {
            result = 1; // Player wins
        } else if (pseudoRandom < 66) {
            result = 2; // Computer wins
        } else {
            result = 3; // Tie
        }

        _finalizeRound(round, result);
    }

    /**
     * @notice Set round result manually (for testing/demo purposes)
     * @param round The round number
     * @param result The result (1=player1 wins, 2=computer wins, 3=tie)
     * @dev In a full implementation, this would be done via FHE computation and Gateway decryption
     */
    function setRoundResult(uint8 round, uint8 result) public {
        require(msg.sender == player1, "Only the player can set result");
        require(result >= 1 && result <= 3, "Invalid result");
        require(roundResults[round] == 0, "Round already processed");
        require(player1HasMoved[round] && computerHasMoved[round], "Both players must move first");

        _finalizeRound(round, result);
    }

    /**
     * @notice Internal function to finalize round with result
     * @param round The round number
     * @param result The round result
     */
    function _finalizeRound(uint8 round, uint8 result) internal {
        roundResults[round] = result;

        if (result == 1) {
            player1Wins++;
        } else if (result == 2) {
            computerWins++;
        }

        emit RoundCompleted(round, result);

        // Check if game is over
        if (player1Wins == 2) {
            gameOver = true;
            winner = player1;
            emit GameEnded(player1, player1Wins, computerWins);
        } else if (computerWins == 2) {
            gameOver = true;
            winner = COMPUTER_PLAYER;
            emit GameEnded(COMPUTER_PLAYER, player1Wins, computerWins);
        } else if (round == currentRound) {
            currentRound++;
        }
    }

    /**
     * @notice Get the current state of the game
     * @return player1Wins_ Number of rounds won by player 1
     * @return computerWins_ Number of rounds won by computer
     * @return currentRound_ Current round number
     * @return gameOver_ Whether the game has ended
     * @return winner_ Address of the winner (address(0) for computer)
     */
    function getGameState()
        public
        view
        returns (uint8 player1Wins_, uint8 computerWins_, uint8 currentRound_, bool gameOver_, address winner_)
    {
        return (player1Wins, computerWins, currentRound, gameOver, winner);
    }

    /**
     * @notice Get the result of a specific round
     * @param round The round number to query
     * @return result Round result (0=pending, 1=player1 wins, 2=computer wins, 3=tie)
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
        return player1HasMoved[round] && computerHasMoved[round];
    }

    /**
     * @notice Allow the player to view their own encrypted move for a round (for verification)
     * @param round The round number
     * @return encryptedMove The player's encrypted move for that round
     */
    function getMyEncryptedMove(uint8 round) public view returns (euint8 encryptedMove) {
        if (msg.sender != player1) revert NotThePlayer(msg.sender);
        require(player1HasMoved[round], "Player hasn't moved in this round");
        return player1EncryptedMoves[round];
    }

    /**
     * @notice Get computer's encrypted move for a round (for verification)
     * @param round The round number
     * @return encryptedMove The computer's encrypted move for that round
     */
    function getComputerEncryptedMove(uint8 round) public view returns (euint8 encryptedMove) {
        require(computerHasMoved[round], "Computer hasn't moved in this round");
        return computerEncryptedMoves[round];
    }

    /**
     * @notice Check if it's the player's turn to move
     * @return canMove Whether the player can make a move
     */
    function canPlayerMove() public view returns (bool canMove) {
        return !gameOver && !player1HasMoved[currentRound];
    }

    /**
     * @notice Get the computer player address (always zero address)
     * @return computerAddress The computer player address
     */
    function getComputerPlayer() public pure returns (address computerAddress) {
        return COMPUTER_PLAYER;
    }
}

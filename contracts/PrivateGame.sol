// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";

/**
 * @title PrivateGame
 * @notice A fully privacy-preserving Rock-Paper-Scissors game contract using FHE
 * @dev Operator manages games, players remain anonymous with encrypted addresses and moves
 * Move encoding: 1 = Rock, 2 = Paper, 3 = Scissors
 * Game modes: 0 = Two Player, 1 = Single Player (vs Computer)
 * All player data is encrypted including addresses
 */
contract PrivateGame is SepoliaZamaFHEVMConfig {
    /// @notice Address of the operator who manages games
    address public operator;

    /// @notice Game counter for unique game IDs
    uint256 public gameCounter;

    /// @notice Maximum number of games that can be active simultaneously
    uint256 public constant MAX_ACTIVE_GAMES = 100;

    /// @notice Number of currently active games
    uint256 public activeGamesCount;

    /// @notice Game modes
    enum GameMode {
        TwoPlayer,
        SinglePlayer
    }

    /// @notice Game states
    enum GameState {
        WaitingForPlayers,
        Active,
        Finished
    }

    /// @notice Game information structure
    struct GameInfo {
        uint256 gameId;
        GameMode mode;
        GameState state;
        uint8 maxRounds; // Best of N rounds
        uint8 currentRound;
        uint8 player1Wins;
        uint8 player2Wins; // For single player mode, this is computer wins
        address winner; // Winner address (zero for computer in single player)
        uint256 createdAt;
        uint256 finishedAt;
    }

    /// @notice Round information structure
    struct RoundInfo {
        bool player1HasMoved;
        bool player2HasMoved; // For single player, this is always true after player1 moves
        uint8 result; // 0 = pending, 1 = player1 wins, 2 = player2/computer wins, 3 = tie
        uint256 timestamp;
    }

    /// @notice Mapping of game ID to game information
    mapping(uint256 => GameInfo) public games;

    /// @notice Mapping of game ID to encrypted player 1 address
    mapping(uint256 => eaddress) private player1EncryptedAddresses;

    /// @notice Mapping of game ID to encrypted player 2 address (zero for single player)
    mapping(uint256 => eaddress) private player2EncryptedAddresses;

    /// @notice Mapping of game ID to player 1 address (for access control)
    mapping(uint256 => address) private player1Addresses;

    /// @notice Mapping of game ID to player 2 address (for access control)
    mapping(uint256 => address) private player2Addresses;

    /// @notice Mapping of game ID to round number to player 1's encrypted move
    mapping(uint256 => mapping(uint8 => euint8)) private player1Moves;

    /// @notice Mapping of game ID to round number to player 2's encrypted move
    mapping(uint256 => mapping(uint8 => euint8)) private player2Moves;

    /// @notice Mapping of game ID to round number to round information
    mapping(uint256 => mapping(uint8 => RoundInfo)) public roundInfo;

    /// @notice Mapping to track if an address is in a game
    mapping(uint256 => mapping(address => bool)) private playerInGame;

    // Custom Errors
    error OnlyOperator();
    error GameNotFound();
    error GameNotActive();
    error GameFull();
    error PlayerAlreadyInGame();
    error PlayerNotInGame();
    error AlreadyMoved();
    error BothPlayersNotMoved();
    error RoundNotReady();
    error InvalidResult();
    error InvalidGameMode();
    error InvalidMaxRounds();
    error MaxActiveGamesReached();
    error GameNotFinished();

    // Events
    /**
     * @notice Emitted when a new game is created
     * @param gameId The unique game identifier
     * @param mode The game mode (0=TwoPlayer, 1=SinglePlayer)
     * @param maxRounds Maximum rounds to win
     */
    event GameCreated(uint256 indexed gameId, GameMode mode, uint8 maxRounds);

    /**
     * @notice Emitted when a player joins a game
     * @param gameId The game identifier
     * @param playerNumber Player number (1 or 2)
     */
    event PlayerJoined(uint256 indexed gameId, uint8 playerNumber);

    /**
     * @notice Emitted when a game starts
     * @param gameId The game identifier
     */
    event GameStarted(uint256 indexed gameId);

    /**
     * @notice Emitted when an encrypted move is made
     * @param gameId The game identifier
     * @param round The round number
     * @param playerNumber Player number (1 or 2)
     */
    event EncryptedMoveMade(uint256 indexed gameId, uint8 indexed round, uint8 playerNumber);

    /**
     * @notice Emitted when both players have moved in a round
     * @param gameId The game identifier
     * @param round The round number
     */
    event RoundReady(uint256 indexed gameId, uint8 indexed round);

    /**
     * @notice Emitted when a round is completed
     * @param gameId The game identifier
     * @param round The round number
     * @param result Round result (1=player1 wins, 2=player2/computer wins, 3=tie)
     */
    event RoundCompleted(uint256 indexed gameId, uint8 indexed round, uint8 result);

    /**
     * @notice Emitted when a game ends
     * @param gameId The game identifier
     * @param player1Wins Final wins for player 1
     * @param player2Wins Final wins for player 2/computer
     */
    event GameEnded(uint256 indexed gameId, uint8 player1Wins, uint8 player2Wins);

    /// @notice Modifier to restrict access to operator only
    modifier onlyOperator() {
        if (msg.sender != operator) revert OnlyOperator();
        _;
    }

    /// @notice Modifier to check if game exists and is active
    modifier gameExists(uint256 gameId) {
        if (games[gameId].gameId == 0) revert GameNotFound();
        _;
    }

    /// @notice Modifier to check if game is active
    modifier gameActive(uint256 gameId) {
        if (games[gameId].state != GameState.Active) revert GameNotActive();
        _;
    }

    /**
     * @notice Initialize the contract with operator
     * @param _operator Address of the operator who will manage games
     */
    constructor(address _operator) {
        operator = _operator;
        gameCounter = 0;
        activeGamesCount = 0;
    }

    /**
     * @notice Create a new game (operator only)
     * @param mode Game mode (0=TwoPlayer, 1=SinglePlayer)
     * @param maxRounds Maximum rounds to win (must be odd number, minimum 3)
     * @return gameId The unique identifier for the created game
     */
    function createGame(GameMode mode, uint8 maxRounds) external onlyOperator returns (uint256 gameId) {
        if (activeGamesCount >= MAX_ACTIVE_GAMES) revert MaxActiveGamesReached();
        if (maxRounds < 3 || maxRounds % 2 == 0) revert InvalidMaxRounds();

        gameCounter++;
        gameId = gameCounter;

        games[gameId] = GameInfo({
            gameId: gameId,
            mode: mode,
            state: GameState.WaitingForPlayers,
            maxRounds: maxRounds,
            currentRound: 1,
            player1Wins: 0,
            player2Wins: 0,
            winner: address(0),
            createdAt: block.timestamp,
            finishedAt: 0
        });

        activeGamesCount++;
        emit GameCreated(gameId, mode, maxRounds);
    }

    /**
     * @notice Join a game as player 1 or 2
     * @param gameId The game to join
     * @param encryptedPlayerAddress Encrypted address of the player
     * @param inputProof Proof for the encrypted address
     */
    function joinGame(
        uint256 gameId,
        einput encryptedPlayerAddress,
        bytes calldata inputProof
    ) external gameExists(gameId) {
        GameInfo storage game = games[gameId];

        if (game.state != GameState.WaitingForPlayers) revert GameNotActive();
        if (playerInGame[gameId][msg.sender]) revert PlayerAlreadyInGame();

        eaddress encryptedAddr = TFHE.asEaddress(encryptedPlayerAddress, inputProof);

        if (player1Addresses[gameId] == address(0)) {
            // First player joining
            player1Addresses[gameId] = msg.sender;
            player1EncryptedAddresses[gameId] = encryptedAddr;
            playerInGame[gameId][msg.sender] = true;
            emit PlayerJoined(gameId, 1);

            // For single player mode, automatically start the game
            if (game.mode == GameMode.SinglePlayer) {
                game.state = GameState.Active;
                emit GameStarted(gameId);
            }
        } else if (game.mode == GameMode.TwoPlayer && player2Addresses[gameId] == address(0)) {
            // Second player joining in two-player mode
            player2Addresses[gameId] = msg.sender;
            player2EncryptedAddresses[gameId] = encryptedAddr;
            playerInGame[gameId][msg.sender] = true;
            game.state = GameState.Active;
            emit PlayerJoined(gameId, 2);
            emit GameStarted(gameId);
        } else {
            revert GameFull();
        }
    }

    /**
     * @notice Make an encrypted move in the current round
     * @param gameId The game identifier
     * @param encryptedMove The encrypted move (1=Rock, 2=Paper, 3=Scissors)
     * @param inputProof The input proof for the encrypted move
     */
    function makeMove(
        uint256 gameId,
        einput encryptedMove,
        bytes calldata inputProof
    ) external gameExists(gameId) gameActive(gameId) {
        GameInfo storage game = games[gameId];

        if (!playerInGame[gameId][msg.sender]) revert PlayerNotInGame();

        euint8 move = TFHE.asEuint8(encryptedMove, inputProof);
        uint8 currentRound = game.currentRound;

        // Process the player's move
        _processPlayerMove(gameId, currentRound, move);

        // Handle computer move for single player mode
        _handleComputerMoveIfNeeded(gameId, currentRound);

        // Check if round is ready for processing
        _checkRoundReady(gameId, currentRound);
    }

    /**
     * @notice Internal function to process a player's move
     * @param gameId The game identifier
     * @param currentRound The current round
     * @param move The encrypted move
     */
    function _processPlayerMove(uint256 gameId, uint8 currentRound, euint8 move) internal {
        GameInfo storage game = games[gameId];

        if (msg.sender == player1Addresses[gameId]) {
            if (roundInfo[gameId][currentRound].player1HasMoved) revert AlreadyMoved();
            player1Moves[gameId][currentRound] = move;
            roundInfo[gameId][currentRound].player1HasMoved = true;
            emit EncryptedMoveMade(gameId, currentRound, 1);
        } else if (game.mode == GameMode.TwoPlayer && msg.sender == player2Addresses[gameId]) {
            if (roundInfo[gameId][currentRound].player2HasMoved) revert AlreadyMoved();
            player2Moves[gameId][currentRound] = move;
            roundInfo[gameId][currentRound].player2HasMoved = true;
            emit EncryptedMoveMade(gameId, currentRound, 2);
        } else {
            revert PlayerNotInGame();
        }
    }

    /**
     * @notice Internal function to handle computer move generation if needed
     * @param gameId The game identifier
     * @param currentRound The current round
     */
    function _handleComputerMoveIfNeeded(uint256 gameId, uint8 currentRound) internal {
        GameInfo storage game = games[gameId];

        if (
            game.mode == GameMode.SinglePlayer &&
            roundInfo[gameId][currentRound].player1HasMoved &&
            !roundInfo[gameId][currentRound].player2HasMoved
        ) {
            _makeComputerMove(gameId, currentRound);
        }
    }

    /**
     * @notice Internal function to check if round is ready
     * @param gameId The game identifier
     * @param currentRound The current round
     */
    function _checkRoundReady(uint256 gameId, uint8 currentRound) internal {
        if (roundInfo[gameId][currentRound].player1HasMoved && roundInfo[gameId][currentRound].player2HasMoved) {
            emit RoundReady(gameId, currentRound);
        }
    }

    /**
     * @notice Internal function to generate computer's random move
     * @param gameId The game identifier
     * @param round The round number
     */
    function _makeComputerMove(uint256 gameId, uint8 round) internal {
        // Generate bounded random move for computer using FHE randomness
        euint8 randomValue = TFHE.randEuint8(); // Returns 0-255
        euint8 moduloResult = TFHE.rem(randomValue, 3); // 0, 1, or 2
        euint8 computerMove = TFHE.add(moduloResult, 1); // 1, 2, or 3

        player2Moves[gameId][round] = computerMove;
        roundInfo[gameId][round].player2HasMoved = true;
        emit EncryptedMoveMade(gameId, round, 2);
    }

    /**
     * @notice Set round result (operator only, in production this would be via Gateway)
     * @param gameId The game identifier
     * @param round The round number
     * @param result The result (1=player1 wins, 2=player2/computer wins, 3=tie)
     */
    function setRoundResult(uint256 gameId, uint8 round, uint8 result) external onlyOperator gameExists(gameId) {
        if (result < 1 || result > 3) revert InvalidResult();
        if (roundInfo[gameId][round].result != 0) return; // Already processed
        if (!roundInfo[gameId][round].player1HasMoved || !roundInfo[gameId][round].player2HasMoved) {
            revert BothPlayersNotMoved();
        }

        _updateRoundResult(gameId, round, result);
        _checkGameCompletion(gameId, round);
    }

    /**
     * @notice Internal function to update round result and scores
     * @param gameId The game identifier
     * @param round The round number
     * @param result The round result
     */
    function _updateRoundResult(uint256 gameId, uint8 round, uint8 result) internal {
        GameInfo storage game = games[gameId];

        roundInfo[gameId][round].result = result;
        roundInfo[gameId][round].timestamp = block.timestamp;

        if (result == 1) {
            game.player1Wins++;
        } else if (result == 2) {
            game.player2Wins++;
        }

        emit RoundCompleted(gameId, round, result);
    }

    /**
     * @notice Internal function to check if game is complete and handle end game
     * @param gameId The game identifier
     * @param round The current round number
     */
    function _checkGameCompletion(uint256 gameId, uint8 round) internal {
        GameInfo storage game = games[gameId];
        uint8 roundsToWin = (game.maxRounds + 1) / 2;

        if (game.player1Wins == roundsToWin) {
            _endGame(gameId, player1Addresses[gameId]);
        } else if (game.player2Wins == roundsToWin) {
            address winner = game.mode == GameMode.TwoPlayer ? player2Addresses[gameId] : address(0);
            _endGame(gameId, winner);
        } else if (round == game.currentRound) {
            game.currentRound++;
        }
    }

    /**
     * @notice Internal function to end a game
     * @param gameId The game identifier
     * @param winner The winner address (address(0) for computer)
     */
    function _endGame(uint256 gameId, address winner) internal {
        GameInfo storage game = games[gameId];

        game.state = GameState.Finished;
        game.winner = winner;
        game.finishedAt = block.timestamp;
        activeGamesCount--;

        emit GameEnded(gameId, game.player1Wins, game.player2Wins);
    }

    /**
     * @notice Get game information
     * @param gameId The game identifier
     * @return game The game information structure
     */
    function getGameInfo(uint256 gameId) external view gameExists(gameId) returns (GameInfo memory game) {
        return games[gameId];
    }

    /**
     * @notice Get round information
     * @param gameId The game identifier
     * @param round The round number
     * @return roundData The round information structure
     */
    function getRoundInfo(
        uint256 gameId,
        uint8 round
    ) external view gameExists(gameId) returns (RoundInfo memory roundData) {
        return roundInfo[gameId][round];
    }

    /**
     * @notice Check if a player can make a move in the current round
     * @param gameId The game identifier
     * @return canMove Whether the player can make a move
     */
    function canPlayerMove(uint256 gameId) external view gameExists(gameId) returns (bool canMove) {
        if (games[gameId].state != GameState.Active) return false;
        if (!playerInGame[gameId][msg.sender]) return false;

        uint8 currentRound = games[gameId].currentRound;

        if (msg.sender == player1Addresses[gameId]) {
            return !roundInfo[gameId][currentRound].player1HasMoved;
        } else if (games[gameId].mode == GameMode.TwoPlayer && msg.sender == player2Addresses[gameId]) {
            return !roundInfo[gameId][currentRound].player2HasMoved;
        }

        return false;
    }

    /**
     * @notice Allow a player to view their own encrypted move for a round
     * @param gameId The game identifier
     * @param round The round number
     * @return encryptedMove The player's encrypted move for that round
     */
    function getMyEncryptedMove(
        uint256 gameId,
        uint8 round
    ) external view gameExists(gameId) returns (euint8 encryptedMove) {
        if (!playerInGame[gameId][msg.sender]) revert PlayerNotInGame();

        if (msg.sender == player1Addresses[gameId]) {
            require(roundInfo[gameId][round].player1HasMoved, "Player 1 hasn't moved in this round");
            return player1Moves[gameId][round];
        } else if (games[gameId].mode == GameMode.TwoPlayer && msg.sender == player2Addresses[gameId]) {
            require(roundInfo[gameId][round].player2HasMoved, "Player 2 hasn't moved in this round");
            return player2Moves[gameId][round];
        } else {
            revert PlayerNotInGame();
        }
    }

    /**
     * @notice Get computer's encrypted move for a round (single player mode only)
     * @param gameId The game identifier
     * @param round The round number
     * @return encryptedMove The computer's encrypted move for that round
     */
    function getComputerEncryptedMove(
        uint256 gameId,
        uint8 round
    ) external view gameExists(gameId) returns (euint8 encryptedMove) {
        require(games[gameId].mode == GameMode.SinglePlayer, "Only available in single player mode");
        require(roundInfo[gameId][round].player2HasMoved, "Computer hasn't moved in this round");
        return player2Moves[gameId][round];
    }

    /**
     * @notice Check if both players have moved in a specific round
     * @param gameId The game identifier
     * @param round The round number to check
     * @return bothMoved Whether both players have made their moves
     */
    function haveBothPlayersMoved(
        uint256 gameId,
        uint8 round
    ) external view gameExists(gameId) returns (bool bothMoved) {
        return roundInfo[gameId][round].player1HasMoved && roundInfo[gameId][round].player2HasMoved;
    }

    /**
     * @notice Get active games count
     * @return count Number of currently active games
     */
    function getActiveGamesCount() external view returns (uint256 count) {
        return activeGamesCount;
    }

    /**
     * @notice Change operator (current operator only)
     * @param newOperator New operator address
     */
    function changeOperator(address newOperator) external onlyOperator {
        require(newOperator != address(0), "Invalid operator address");
        operator = newOperator;
    }

    /**
     * @notice Emergency function to end a game (operator only)
     * @param gameId The game identifier
     */
    function emergencyEndGame(uint256 gameId) external onlyOperator gameExists(gameId) {
        GameInfo storage game = games[gameId];
        if (game.state == GameState.Finished) revert GameNotFinished();

        game.state = GameState.Finished;
        game.finishedAt = block.timestamp;
        if (game.state != GameState.WaitingForPlayers) {
            activeGamesCount--;
        }
        emit GameEnded(gameId, game.player1Wins, game.player2Wins);
    }

    /**
     * @notice Get player's encrypted address (for the player themselves)
     * @param gameId The game identifier
     * @return encryptedAddress The player's encrypted address
     */
    function getMyEncryptedAddress(
        uint256 gameId
    ) external view gameExists(gameId) returns (eaddress encryptedAddress) {
        if (msg.sender == player1Addresses[gameId]) {
            return player1EncryptedAddresses[gameId];
        } else if (games[gameId].mode == GameMode.TwoPlayer && msg.sender == player2Addresses[gameId]) {
            return player2EncryptedAddresses[gameId];
        } else {
            revert PlayerNotInGame();
        }
    }
}

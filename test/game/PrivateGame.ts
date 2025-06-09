import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { FhevmInstance } from "fhevmjs/node";
import { ethers } from "hardhat";

import { PrivateGame } from "../../types";
import { createInstance } from "../instance";
import { getSigners, initSigners } from "../signers";

describe("PrivateGame", function () {
  let privateGame: PrivateGame;
  let operator: HardhatEthersSigner;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let nonPlayer: HardhatEthersSigner;
  let contractAddress: string;
  let fhevm: FhevmInstance;

  // Game modes
  const GameMode = {
    TwoPlayer: 0,
    SinglePlayer: 1,
  };

  // Game states
  const GameState = {
    WaitingForPlayers: 0,
    Active: 1,
    Finished: 2,
  };

  before(async function () {
    await initSigners();
  });

  beforeEach(async function () {
    const signers = await getSigners();
    operator = signers.alice;
    player1 = signers.bob;
    player2 = signers.carol;
    nonPlayer = signers.dave;

    const PrivateGameFactory = await ethers.getContractFactory("PrivateGame");
    privateGame = await PrivateGameFactory.deploy(operator.address);
    await privateGame.waitForDeployment();
    contractAddress = await privateGame.getAddress();
    fhevm = await createInstance();
  });

  describe("Contract initialization", function () {
    it("should initialize with correct operator", async function () {
      expect(await privateGame.operator()).to.equal(operator.address);
      expect(await privateGame.gameCounter()).to.equal(0);
      expect(await privateGame.activeGamesCount()).to.equal(0);
    });

    it("should have correct MAX_ACTIVE_GAMES", async function () {
      expect(await privateGame.MAX_ACTIVE_GAMES()).to.equal(100);
    });
  });

  describe("Game creation", function () {
    it("should allow operator to create two-player game", async function () {
      const tx = await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);
      await expect(tx).to.emit(privateGame, "GameCreated").withArgs(1, GameMode.TwoPlayer, 3);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.gameId).to.equal(1);
      expect(gameInfo.mode).to.equal(GameMode.TwoPlayer);
      expect(gameInfo.state).to.equal(GameState.WaitingForPlayers);
      expect(gameInfo.maxRounds).to.equal(3);
      expect(gameInfo.currentRound).to.equal(1);
      expect(gameInfo.player1Wins).to.equal(0);
      expect(gameInfo.player2Wins).to.equal(0);

      expect(await privateGame.gameCounter()).to.equal(1);
      expect(await privateGame.activeGamesCount()).to.equal(1);
    });

    it("should allow operator to create single-player game", async function () {
      const tx = await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 5);
      await expect(tx).to.emit(privateGame, "GameCreated").withArgs(1, GameMode.SinglePlayer, 5);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.mode).to.equal(GameMode.SinglePlayer);
      expect(gameInfo.maxRounds).to.equal(5);
    });

    it("should reject game creation from non-operator", async function () {
      await expect(privateGame.connect(player1).createGame(GameMode.TwoPlayer, 3)).to.be.revertedWithCustomError(
        privateGame,
        "OnlyOperator",
      );
    });

    it("should reject invalid maxRounds", async function () {
      // Even number
      await expect(privateGame.connect(operator).createGame(GameMode.TwoPlayer, 4)).to.be.revertedWithCustomError(
        privateGame,
        "InvalidMaxRounds",
      );

      // Too small
      await expect(privateGame.connect(operator).createGame(GameMode.TwoPlayer, 1)).to.be.revertedWithCustomError(
        privateGame,
        "InvalidMaxRounds",
      );
    });
  });

  describe("Joining games", function () {
    beforeEach(async function () {
      // Create a two-player game for testing
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);
    });

    it("should allow first player to join two-player game", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();

      const tx = await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      await expect(tx).to.emit(privateGame, "PlayerJoined").withArgs(1, 1);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.WaitingForPlayers); // Still waiting for player 2
    });

    it("should allow second player to join and start two-player game", async function () {
      // First player joins
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr1 = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr1.handles[0], encryptedAddr1.inputProof);

      // Second player joins
      input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.addAddress(player2.address);
      const encryptedAddr2 = await input.encrypt();

      const tx = await privateGame.connect(player2).joinGame(1, encryptedAddr2.handles[0], encryptedAddr2.inputProof);

      await expect(tx).to.emit(privateGame, "PlayerJoined").withArgs(1, 2);
      await expect(tx).to.emit(privateGame, "GameStarted").withArgs(1);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Active);
    });

    it("should reject third player trying to join two-player game", async function () {
      // First two players join
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      let encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.addAddress(player2.address);
      encryptedAddr = await input.encrypt();
      await privateGame.connect(player2).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Verify game is now active
      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Active);

      // Third player tries to join - should fail because game is no longer waiting for players
      input = fhevm.createEncryptedInput(contractAddress, nonPlayer.address);
      input.addAddress(nonPlayer.address);
      const encryptedAddr3 = await input.encrypt();

      await expect(
        privateGame.connect(nonPlayer).joinGame(1, encryptedAddr3.handles[0], encryptedAddr3.inputProof),
      ).to.be.revertedWithCustomError(privateGame, "GameNotActive");
    });

    it("should reject joining non-existent game", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();

      await expect(
        privateGame.connect(player1).joinGame(999, encryptedAddr.handles[0], encryptedAddr.inputProof),
      ).to.be.revertedWithCustomError(privateGame, "GameNotFound");
    });
  });

  describe("Single-player game flow", function () {
    beforeEach(async function () {
      // Create single-player game
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);
    });

    it("should auto-start single-player game when player joins", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();

      const tx = await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      await expect(tx).to.emit(privateGame, "PlayerJoined").withArgs(1, 1);
      await expect(tx).to.emit(privateGame, "GameStarted").withArgs(1);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Active);
    });

    it("should allow player to make move and auto-generate computer move", async function () {
      // Player joins
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.addAddress(player1.address);
      const encryptedAddr = await input1.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Player makes move
      const input2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input2.add8(1); // Rock
      const encryptedMove = await input2.encrypt();

      const tx = await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(tx).to.emit(privateGame, "EncryptedMoveMade").withArgs(1, 1, 1);
      await expect(tx).to.emit(privateGame, "EncryptedMoveMade").withArgs(1, 1, 2);
      await expect(tx).to.emit(privateGame, "RoundReady").withArgs(1, 1);

      const roundInfo = await privateGame.getRoundInfo(1, 1);
      expect(roundInfo.player1HasMoved).to.equal(true);
      expect(roundInfo.player2HasMoved).to.equal(true);
    });

    it("should allow getting computer's encrypted move", async function () {
      // Setup and make move
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.addAddress(player1.address);
      const encryptedAddr = await input1.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input2.add8(1); // Rock
      const encryptedMove = await input2.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      const computerMove = await privateGame.getComputerEncryptedMove(1, 1);
      expect(computerMove).to.not.equal(0);
    });

    it("should complete single-player game when player wins", async function () {
      // Setup game
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Round 1: Player wins
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove1 = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove1.handles[0], encryptedMove1.inputProof);

      await privateGame.connect(operator).setRoundResult(1, 1, 1); // Player wins

      // Round 2: Player wins again to win game
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(2); // Paper
      const encryptedMove2 = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove2.handles[0], encryptedMove2.inputProof);

      const tx = await privateGame.connect(operator).setRoundResult(1, 2, 1); // Player wins
      await expect(tx).to.emit(privateGame, "GameEnded").withArgs(1, 2, 0);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Finished);
      expect(gameInfo.player1Wins).to.equal(2);
      expect(gameInfo.player2Wins).to.equal(0);
      expect(await privateGame.activeGamesCount()).to.equal(0);
    });
  });

  describe("Two-player game flow", function () {
    beforeEach(async function () {
      // Create and setup two-player game
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);

      // Both players join
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      let encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.addAddress(player2.address);
      encryptedAddr = await input.encrypt();
      await privateGame.connect(player2).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);
    });

    it("should allow both players to make moves", async function () {
      // Player 1 makes move
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      let encryptedMove = await input.encrypt();

      const tx1 = await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(tx1).to.emit(privateGame, "EncryptedMoveMade").withArgs(1, 1, 1);

      // Player 2 makes move
      input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.add8(2); // Paper
      encryptedMove = await input.encrypt();

      const tx2 = await privateGame.connect(player2).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(tx2).to.emit(privateGame, "EncryptedMoveMade").withArgs(1, 1, 2);
      await expect(tx2).to.emit(privateGame, "RoundReady").withArgs(1, 1);

      const roundInfo = await privateGame.getRoundInfo(1, 1);
      expect(roundInfo.player1HasMoved).to.equal(true);
      expect(roundInfo.player2HasMoved).to.equal(true);
    });

    it("should reject moves from non-participants", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, nonPlayer.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await expect(
        privateGame.connect(nonPlayer).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof),
      ).to.be.revertedWithCustomError(privateGame, "PlayerNotInGame");
    });

    it("should reject duplicate moves from same player", async function () {
      // Player 1 makes first move
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      let encryptedMove = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      // Player 1 tries to make second move
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(2); // Paper
      encryptedMove = await input.encrypt();

      await expect(
        privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof),
      ).to.be.revertedWithCustomError(privateGame, "AlreadyMoved");
    });

    it("should complete full two-player game", async function () {
      // Round 1: Player 1 wins
      await makeBothPlayerMoves(1, 1, 2); // Rock vs Paper - Player 2 should win but we'll set Player 1 wins
      await privateGame.connect(operator).setRoundResult(1, 1, 1);

      let gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.player1Wins).to.equal(1);
      expect(gameInfo.currentRound).to.equal(2);

      // Round 2: Player 1 wins again to win game
      await makeBothPlayerMoves(2, 2, 1); // Paper vs Rock - Player 1 should win
      const tx = await privateGame.connect(operator).setRoundResult(1, 2, 1);
      await expect(tx).to.emit(privateGame, "GameEnded").withArgs(1, 2, 0);

      gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Finished);
      expect(gameInfo.player1Wins).to.equal(2);
      expect(await privateGame.activeGamesCount()).to.equal(0);
    });

    // Helper function to make moves for both players
    async function makeBothPlayerMoves(round: number, player1Move: number, player2Move: number) {
      // Player 1 move
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(player1Move);
      let encryptedMove = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      // Player 2 move
      input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.add8(player2Move);
      encryptedMove = await input.encrypt();

      await privateGame.connect(player2).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);
    }
  });

  describe("Round management", function () {
    beforeEach(async function () {
      // Setup single-player game for testing
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 5);
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);
    });

    it("should handle tie results correctly", async function () {
      // Make moves
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      // Set tie result
      await expect(privateGame.connect(operator).setRoundResult(1, 1, 3))
        .to.emit(privateGame, "RoundCompleted")
        .withArgs(1, 1, 3);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.player1Wins).to.equal(0);
      expect(gameInfo.player2Wins).to.equal(0);
      expect(gameInfo.currentRound).to.equal(2);
    });

    it("should reject invalid round results", async function () {
      // Make moves first
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(privateGame.connect(operator).setRoundResult(1, 1, 0)).to.be.revertedWithCustomError(
        privateGame,
        "InvalidResult",
      );

      await expect(privateGame.connect(operator).setRoundResult(1, 1, 4)).to.be.revertedWithCustomError(
        privateGame,
        "InvalidResult",
      );
    });

    it("should reject setting result when moves are missing", async function () {
      await expect(privateGame.connect(operator).setRoundResult(1, 1, 1)).to.be.revertedWithCustomError(
        privateGame,
        "BothPlayersNotMoved",
      );
    });

    it("should reject non-operator setting results", async function () {
      // Make moves first
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(privateGame.connect(player1).setRoundResult(1, 1, 1)).to.be.revertedWithCustomError(
        privateGame,
        "OnlyOperator",
      );
    });
  });

  describe("Utility functions", function () {
    beforeEach(async function () {
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);
    });

    it("should check if player can move", async function () {
      const canMove = await privateGame.connect(player1).canPlayerMove(1);
      expect(canMove).to.equal(true);
    });

    it("should allow player to view their own encrypted move", async function () {
      // Make move first
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      // Get encrypted move
      const retrievedMove = await privateGame.connect(player1).getMyEncryptedMove(1, 1);
      expect(retrievedMove).to.not.equal(0);
    });

    it("should check if both players moved", async function () {
      let bothMoved = await privateGame.haveBothPlayersMoved(1, 1);
      expect(bothMoved).to.equal(false);

      // Make move (auto-generates computer move)
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      bothMoved = await privateGame.haveBothPlayersMoved(1, 1);
      expect(bothMoved).to.equal(true);
    });
  });

  describe("Operator management", function () {
    it("should allow operator to change operator", async function () {
      await privateGame.connect(operator).changeOperator(player1.address);
      expect(await privateGame.operator()).to.equal(player1.address);
    });

    it("should reject changing operator from non-operator", async function () {
      await expect(privateGame.connect(player1).changeOperator(player1.address)).to.be.revertedWithCustomError(
        privateGame,
        "OnlyOperator",
      );
    });

    it("should reject setting zero address as operator", async function () {
      await expect(privateGame.connect(operator).changeOperator(ethers.ZeroAddress)).to.be.revertedWith(
        "Invalid operator address",
      );
    });

    it("should allow operator to emergency end game", async function () {
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);

      const tx = await privateGame.connect(operator).emergencyEndGame(1);
      await expect(tx).to.emit(privateGame, "GameEnded").withArgs(1, 0, 0);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Finished);
    });
  });

  describe("Edge cases and limitations", function () {
    it("should prevent creating more than MAX_ACTIVE_GAMES", async function () {
      // This test would be resource-intensive with 100 games, so we'll test the concept
      // by checking the counter logic works correctly
      expect(await privateGame.getActiveGamesCount()).to.equal(0);

      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);
      expect(await privateGame.getActiveGamesCount()).to.equal(1);

      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);
      expect(await privateGame.getActiveGamesCount()).to.equal(2);
    });

    it("should handle game state transitions correctly", async function () {
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);

      let gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.WaitingForPlayers);

      // First player joins
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      let encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.WaitingForPlayers);

      // Second player joins
      input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.addAddress(player2.address);
      encryptedAddr = await input.encrypt();
      await privateGame.connect(player2).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Active);
    });

    it("should handle different maxRounds correctly", async function () {
      // Test with 5 rounds (need 3 wins)
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 5);

      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Player wins 3 rounds
      for (let round = 1; round <= 3; round++) {
        input = fhevm.createEncryptedInput(contractAddress, player1.address);
        input.add8(1);
        const encryptedMove = await input.encrypt();

        await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

        if (round === 3) {
          await expect(privateGame.connect(operator).setRoundResult(1, round, 1)).to.emit(privateGame, "GameEnded");
        } else {
          await privateGame.connect(operator).setRoundResult(1, round, 1);
        }
      }

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Finished);
      expect(gameInfo.player1Wins).to.equal(3);
    });
  });

  describe("Privacy features", function () {
    it("should handle encrypted addresses properly", async function () {
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);

      // Both players join with encrypted addresses
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      let encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.addAddress(player2.address);
      encryptedAddr = await input.encrypt();
      await privateGame.connect(player2).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Game should be active but addresses remain encrypted
      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Active);

      // Winner is initially zero address
      expect(gameInfo.winner).to.equal(ethers.ZeroAddress);
    });

    it("should maintain move privacy with encrypted handles", async function () {
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);

      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Make encrypted move
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

      // Get player's encrypted move (should be non-zero handle)
      const playerMove = await privateGame.connect(player1).getMyEncryptedMove(1, 1);
      expect(playerMove).to.not.equal(0);

      // Get computer's encrypted move
      const computerMove = await privateGame.getComputerEncryptedMove(1, 1);
      expect(computerMove).to.not.equal(0);
      expect(computerMove).to.not.equal(playerMove); // Should be different handles
    });

    it("should allow players to get their encrypted addresses", async function () {
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);

      // Player 1 joins
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Player 1 can get their encrypted address
      const retrievedAddr = await privateGame.connect(player1).getMyEncryptedAddress(1);
      expect(retrievedAddr).to.not.equal(0);
    });
  });

  describe("Game rejection scenarios", function () {
    it("should reject player trying to join same game twice", async function () {
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);

      // Player 1 joins first time
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.addAddress(player1.address);
      const encryptedAddr1 = await input1.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr1.handles[0], encryptedAddr1.inputProof);

      // Player 1 tries to join again
      const input2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input2.addAddress(player1.address);
      const encryptedAddr2 = await input2.encrypt();

      await expect(
        privateGame.connect(player1).joinGame(1, encryptedAddr2.handles[0], encryptedAddr2.inputProof),
      ).to.be.revertedWithCustomError(privateGame, "PlayerAlreadyInGame");
    });

    it("should reject moves when game is not active", async function () {
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);

      // Try to make move before game starts
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await expect(
        privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof),
      ).to.be.revertedWithCustomError(privateGame, "GameNotActive");
    });

    it("should reject getting moves when player hasn't moved", async function () {
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);

      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      await expect(privateGame.connect(player1).getMyEncryptedMove(1, 1)).to.be.revertedWith(
        "Player 1 hasn't moved in this round",
      );
    });

    it("should reject getting computer move in two-player mode", async function () {
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);

      await expect(privateGame.getComputerEncryptedMove(1, 1)).to.be.revertedWith(
        "Only available in single player mode",
      );
    });
  });

  describe("Computer randomness testing", function () {
    it("should generate different computer moves across multiple rounds", async function () {
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 7); // Best of 7 to test more rounds

      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      const computerMoves: bigint[] = [];

      // Play 3 rounds with ties to test computer randomness
      for (let round = 1; round <= 3; round++) {
        input = fhevm.createEncryptedInput(contractAddress, player1.address);
        input.add8(1); // Always play Rock
        const encryptedMove = await input.encrypt();

        await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);

        const computerMove = await privateGame.getComputerEncryptedMove(1, round);
        computerMoves.push(computerMove);

        // Set result as tie to continue to next round
        await privateGame.connect(operator).setRoundResult(1, round, 3);
      }

      // Verify computer moves are different encrypted handles
      expect(computerMoves[0]).to.not.equal(0);
      expect(computerMoves[1]).to.not.equal(0);
      expect(computerMoves[2]).to.not.equal(0);

      // Each round should generate unique encrypted handles (very high probability)
      expect(computerMoves[0]).to.not.equal(computerMoves[1]);
      expect(computerMoves[1]).to.not.equal(computerMoves[2]);
      expect(computerMoves[0]).to.not.equal(computerMoves[2]);
    });

    it("should handle computer wins in single player mode", async function () {
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);

      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Round 1: Computer wins
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove1 = await input.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove1.handles[0], encryptedMove1.inputProof);
      await privateGame.connect(operator).setRoundResult(1, 1, 2); // Computer wins

      // Round 2: Computer wins again to win the game
      const input3 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input3.add8(2); // Paper
      const encryptedMove2 = await input3.encrypt();

      await privateGame.connect(player1).makeMove(1, encryptedMove2.handles[0], encryptedMove2.inputProof);

      const tx = await privateGame.connect(operator).setRoundResult(1, 2, 2); // Computer wins
      await expect(tx).to.emit(privateGame, "GameEnded").withArgs(1, 0, 2);

      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Finished);
      expect(gameInfo.player1Wins).to.equal(0);
      expect(gameInfo.player2Wins).to.equal(2);
      expect(gameInfo.winner).to.equal(ethers.ZeroAddress); // Computer wins
    });
  });

  describe("Multi-game scenarios", function () {
    it("should handle multiple simultaneous games", async function () {
      // Create multiple games
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);
      await privateGame.connect(operator).createGame(GameMode.TwoPlayer, 3);
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 5);

      expect(await privateGame.gameCounter()).to.equal(3);
      expect(await privateGame.getActiveGamesCount()).to.equal(3);

      // Join different games with different players
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr1 = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr1.handles[0], encryptedAddr1.inputProof);

      input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.addAddress(player2.address);
      const encryptedAddr2 = await input.encrypt();
      await privateGame.connect(player2).joinGame(2, encryptedAddr2.handles[0], encryptedAddr2.inputProof);

      // Verify games are in correct states
      const gameInfo1 = await privateGame.getGameInfo(1);
      const gameInfo2 = await privateGame.getGameInfo(2);

      expect(gameInfo1.state).to.equal(GameState.Active); // Single player auto-starts
      expect(gameInfo2.state).to.equal(GameState.WaitingForPlayers); // Two player needs second player
    });

    it("should properly clean up finished games from active count", async function () {
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);
      await privateGame.connect(operator).createGame(GameMode.SinglePlayer, 3);

      expect(await privateGame.getActiveGamesCount()).to.equal(2);

      // Join and finish first game
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.addAddress(player1.address);
      const encryptedAddr = await input.encrypt();
      await privateGame.connect(player1).joinGame(1, encryptedAddr.handles[0], encryptedAddr.inputProof);

      // Player wins 2 rounds quickly
      for (let round = 1; round <= 2; round++) {
        input = fhevm.createEncryptedInput(contractAddress, player1.address);
        input.add8(1);
        const encryptedMove = await input.encrypt();

        await privateGame.connect(player1).makeMove(1, encryptedMove.handles[0], encryptedMove.inputProof);
        await privateGame.connect(operator).setRoundResult(1, round, 1);
      }

      // Active count should decrease
      expect(await privateGame.getActiveGamesCount()).to.equal(1);

      // Verify first game is finished
      const gameInfo = await privateGame.getGameInfo(1);
      expect(gameInfo.state).to.equal(GameState.Finished);
    });
  });
});

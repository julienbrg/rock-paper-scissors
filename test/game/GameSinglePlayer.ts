import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { FhevmInstance } from "fhevmjs/node";
import { ethers } from "hardhat";

import { GameSinglePlayer } from "../../types";
import { createInstance } from "../instance";
import { getSigners, initSigners } from "../signers";

describe("GameSinglePlayer", function () {
  let game: GameSinglePlayer;
  let player1: HardhatEthersSigner;
  let nonPlayer: HardhatEthersSigner;
  let contractAddress: string;
  let fhevm: FhevmInstance;

  before(async function () {
    await initSigners();
  });

  beforeEach(async function () {
    const signers = await getSigners();
    player1 = signers.alice;
    nonPlayer = signers.bob;

    const GameFactory = await ethers.getContractFactory("GameSinglePlayer");
    game = await GameFactory.deploy(player1.address);
    await game.waitForDeployment();
    contractAddress = await game.getAddress();
    fhevm = await createInstance();
  });

  describe("Game initialization", function () {
    it("should initialize with correct player and computer", async function () {
      expect(await game.player1()).to.equal(player1.address);
      expect(await game.getComputerPlayer()).to.equal(ethers.ZeroAddress);
      expect(await game.currentRound()).to.equal(1);
      expect(await game.gameOver()).to.equal(false);
      expect(await game.player1Wins()).to.equal(0);
      expect(await game.computerWins()).to.equal(0);
    });

    it("should return correct initial game state", async function () {
      const [p1Wins, computerWins, currentRound, gameOver, winner] = await game.getGameState();
      expect(p1Wins).to.equal(0);
      expect(computerWins).to.equal(0);
      expect(currentRound).to.equal(1);
      expect(gameOver).to.equal(false);
      expect(winner).to.equal(ethers.ZeroAddress);
    });

    it("should indicate player can move initially", async function () {
      expect(await game.canPlayerMove()).to.equal(true);
    });
  });

  describe("Making moves", function () {
    it("should allow player to make encrypted move and trigger computer move", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      const tx = await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
      const receipt = await tx.wait();

      // Check that both player and computer moves were made
      expect(await game.player1HasMoved(1)).to.equal(true);
      expect(await game.computerHasMoved(1)).to.equal(true);
      expect(await game.haveBothPlayersMoved(1)).to.equal(true);
      expect(await game.canPlayerMove()).to.equal(false);

      // Check events were emitted
      await expect(tx).to.emit(game, "PlayerMoveMade").withArgs(player1.address, 1);

      await expect(tx).to.emit(game, "ComputerMoveMade").withArgs(1);

      await expect(tx).to.emit(game, "RoundReady").withArgs(1);
    });

    it("should reject moves from non-players", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, nonPlayer.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await expect(game.connect(nonPlayer).move(encryptedMove.handles[0], encryptedMove.inputProof))
        .to.be.revertedWithCustomError(game, "NotThePlayer")
        .withArgs(nonPlayer.address);
    });

    it("should reject duplicate moves from player in same round", async function () {
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1); // Rock
      const encryptedMove1 = await input1.encrypt();

      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input2.add8(2); // Paper
      const encryptedMove2 = await input2.encrypt();

      await expect(game.connect(player1).move(encryptedMove2.handles[0], encryptedMove2.inputProof))
        .to.be.revertedWithCustomError(game, "AlreadyMoved")
        .withArgs(1);
    });

    it("should reject moves when game is over", async function () {
      // Play two rounds where player wins both
      for (let round = 1; round <= 2; round++) {
        const input = fhevm.createEncryptedInput(contractAddress, player1.address);
        input.add8(1); // Rock
        const encryptedMove = await input.encrypt();
        await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
        await game.connect(player1).setRoundResult(round, 1); // Player wins
      }

      // Verify game is over
      expect(await game.gameOver()).to.equal(true);

      // Try to make another move - should fail
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await expect(
        game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof),
      ).to.be.revertedWithCustomError(game, "GameAlreadyOver");
    });
  });

  describe("Getting encrypted moves", function () {
    it("should allow player to view their own encrypted move", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      const retrievedMove = await game.connect(player1).getMyEncryptedMove(1);
      expect(retrievedMove).to.not.equal(0);
    });

    it("should allow anyone to view computer's encrypted move", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      const computerMove = await game.getComputerEncryptedMove(1);
      expect(computerMove).to.not.equal(0);
    });

    it("should reject viewing encrypted moves from non-players", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(game.connect(nonPlayer).getMyEncryptedMove(1))
        .to.be.revertedWithCustomError(game, "NotThePlayer")
        .withArgs(nonPlayer.address);
    });

    it("should reject viewing encrypted moves if player hasn't moved", async function () {
      await expect(game.connect(player1).getMyEncryptedMove(1)).to.be.revertedWith("Player hasn't moved in this round");
    });
  });

  describe("Setting round results", function () {
    beforeEach(async function () {
      // Player makes move, computer automatically moves
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
    });

    it("should set round result and update wins correctly for player", async function () {
      await expect(game.connect(player1).setRoundResult(1, 1)).to.emit(game, "RoundCompleted").withArgs(1, 1);

      expect(await game.getRoundResult(1)).to.equal(1);
      expect(await game.player1Wins()).to.equal(1);
      expect(await game.computerWins()).to.equal(0);
    });

    it("should set round result and update wins correctly for computer", async function () {
      await expect(game.connect(player1).setRoundResult(1, 2)).to.emit(game, "RoundCompleted").withArgs(1, 2);

      expect(await game.getRoundResult(1)).to.equal(2);
      expect(await game.player1Wins()).to.equal(0);
      expect(await game.computerWins()).to.equal(1);
    });

    it("should handle tie results", async function () {
      await game.connect(player1).setRoundResult(1, 3); // Tie

      expect(await game.getRoundResult(1)).to.equal(3);
      expect(await game.player1Wins()).to.equal(0);
      expect(await game.computerWins()).to.equal(0);
    });

    it("should end game when player reaches 2 wins", async function () {
      await game.connect(player1).setRoundResult(1, 1); // Player wins
      expect(await game.gameOver()).to.equal(false);

      // Round 2
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(2); // Paper
      const encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(game.connect(player1).setRoundResult(2, 1))
        .to.emit(game, "GameEnded")
        .withArgs(player1.address, 2, 0);

      expect(await game.gameOver()).to.equal(true);
      expect(await game.winner()).to.equal(player1.address);
      expect(await game.canPlayerMove()).to.equal(false);
    });

    it("should end game when computer reaches 2 wins", async function () {
      await game.connect(player1).setRoundResult(1, 2); // Computer wins
      expect(await game.gameOver()).to.equal(false);

      // Round 2
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(2); // Paper
      const encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(game.connect(player1).setRoundResult(2, 2))
        .to.emit(game, "GameEnded")
        .withArgs(ethers.ZeroAddress, 0, 2);

      expect(await game.gameOver()).to.equal(true);
      expect(await game.winner()).to.equal(ethers.ZeroAddress);
      expect(await game.canPlayerMove()).to.equal(false);
    });

    it("should reject invalid result values", async function () {
      await expect(game.connect(player1).setRoundResult(1, 0)).to.be.revertedWith("Invalid result");
      await expect(game.connect(player1).setRoundResult(1, 4)).to.be.revertedWith("Invalid result");
    });

    it("should reject setting result twice for same round", async function () {
      await game.connect(player1).setRoundResult(1, 1);
      await expect(game.connect(player1).setRoundResult(1, 2)).to.be.revertedWith("Round already processed");
    });

    it("should reject non-players setting results", async function () {
      await expect(game.connect(nonPlayer).setRoundResult(1, 1)).to.be.revertedWith("Only the player can set result");
    });
  });

  describe("Process round functionality", function () {
    it("should process round automatically after both moves", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      // Both moves should be made, round should be ready for processing
      expect(await game.haveBothPlayersMoved(1)).to.equal(true);

      // Process round should work
      await expect(game.processRound()).to.not.be.reverted;
    });

    it("should reject processing round if not ready", async function () {
      await expect(game.processRound()).to.be.revertedWithCustomError(game, "RoundNotReady");
    });
  });

  describe("FHE Random number generation", function () {
    it("should generate different computer moves in multiple rounds", async function () {
      const computerMoves: bigint[] = [];

      // Play multiple rounds and collect computer moves
      for (let round = 1; round <= 3; round++) {
        const input = fhevm.createEncryptedInput(contractAddress, player1.address);
        input.add8(1); // Rock
        const encryptedMove = await input.encrypt();

        await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

        const computerMove = await game.getComputerEncryptedMove(round);
        computerMoves.push(computerMove);

        // Set result as tie to continue to next round
        await game.connect(player1).setRoundResult(round, 3);
      }

      // Computer moves should be different handles (encrypted values)
      expect(computerMoves[0]).to.not.equal(0);
      expect(computerMoves[1]).to.not.equal(0);
      expect(computerMoves[2]).to.not.equal(0);

      // Each round should generate a unique encrypted handle
      expect(computerMoves[0]).to.not.equal(computerMoves[1]);
      expect(computerMoves[1]).to.not.equal(computerMoves[2]);
      expect(computerMoves[0]).to.not.equal(computerMoves[2]);
    });

    it("should automatically trigger computer move after player move", async function () {
      expect(await game.computerHasMoved(1)).to.equal(false);

      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(2); // Paper
      const encryptedMove = await input.encrypt();

      const tx = await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      // Computer should have automatically moved
      expect(await game.computerHasMoved(1)).to.equal(true);

      // Check that ComputerMoveMade event was emitted
      await expect(tx).to.emit(game, "ComputerMoveMade").withArgs(1);
    });
  });

  describe("Full single-player game scenarios", function () {
    it("should play a complete best-of-3 game with player winning", async function () {
      // Round 1: Player wins
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      let encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
      await game.connect(player1).setRoundResult(1, 1);

      let gameState = await game.getGameState();
      expect(gameState[0]).to.equal(1); // player1Wins
      expect(gameState[1]).to.equal(0); // computerWins
      expect(gameState[2]).to.equal(2); // currentRound
      expect(gameState[3]).to.equal(false); // gameOver

      // Round 2: Computer wins
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(2); // Paper
      encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
      await game.connect(player1).setRoundResult(2, 2);

      gameState = await game.getGameState();
      expect(gameState[0]).to.equal(1); // player1Wins
      expect(gameState[1]).to.equal(1); // computerWins
      expect(gameState[2]).to.equal(3); // currentRound
      expect(gameState[3]).to.equal(false); // gameOver

      // Round 3: Player wins and wins the game
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(3); // Scissors
      encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(game.connect(player1).setRoundResult(3, 1))
        .to.emit(game, "GameEnded")
        .withArgs(player1.address, 2, 1);

      const finalGameState = await game.getGameState();
      expect(finalGameState[0]).to.equal(2); // player1Wins
      expect(finalGameState[1]).to.equal(1); // computerWins
      expect(finalGameState[2]).to.equal(3); // currentRound
      expect(finalGameState[3]).to.equal(true); // gameOver
      expect(finalGameState[4]).to.equal(player1.address); // winner
    });

    it("should play a complete game with computer winning", async function () {
      // Round 1: Computer wins
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      let encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
      await game.connect(player1).setRoundResult(1, 2);

      // Round 2: Computer wins again to end the game
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(2); // Paper
      encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(game.connect(player1).setRoundResult(2, 2))
        .to.emit(game, "GameEnded")
        .withArgs(ethers.ZeroAddress, 0, 2);

      const finalGameState = await game.getGameState();
      expect(finalGameState[0]).to.equal(0); // player1Wins
      expect(finalGameState[1]).to.equal(2); // computerWins
      expect(finalGameState[3]).to.equal(true); // gameOver
      expect(finalGameState[4]).to.equal(ethers.ZeroAddress); // winner (computer)
    });

    it("should handle game with multiple ties", async function () {
      // Round 1: Tie
      let input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      let encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
      await game.connect(player1).setRoundResult(1, 3); // Tie

      let gameState = await game.getGameState();
      expect(gameState[0]).to.equal(0); // player1Wins
      expect(gameState[1]).to.equal(0); // computerWins
      expect(gameState[2]).to.equal(2); // currentRound advances
      expect(gameState[3]).to.equal(false); // gameOver

      // Round 2: Tie again
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(2); // Paper
      encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
      await game.connect(player1).setRoundResult(2, 3); // Tie

      gameState = await game.getGameState();
      expect(gameState[0]).to.equal(0); // player1Wins
      expect(gameState[1]).to.equal(0); // computerWins
      expect(gameState[2]).to.equal(3); // currentRound advances
      expect(gameState[3]).to.equal(false); // gameOver

      // Round 3: Player wins
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(3); // Scissors
      encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);
      await game.connect(player1).setRoundResult(3, 1); // Player wins

      gameState = await game.getGameState();
      expect(gameState[0]).to.equal(1); // player1Wins
      expect(gameState[1]).to.equal(0); // computerWins
      expect(gameState[3]).to.equal(false); // gameOver (still false, need 2 wins)

      // Round 4: Player wins again to win the game
      input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      encryptedMove = await input.encrypt();
      await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(game.connect(player1).setRoundResult(4, 1))
        .to.emit(game, "GameEnded")
        .withArgs(player1.address, 2, 0);

      const finalGameState = await game.getGameState();
      expect(finalGameState[3]).to.equal(true); // gameOver
      expect(finalGameState[4]).to.equal(player1.address); // winner
    });
  });

  describe("Edge cases and validation", function () {
    it("should maintain correct game state throughout multiple rounds", async function () {
      // Verify initial state
      expect(await game.canPlayerMove()).to.equal(true);
      expect(await game.currentRound()).to.equal(1);

      // Round 1
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      expect(await game.canPlayerMove()).to.equal(false); // Can't move until round is resolved
      expect(await game.haveBothPlayersMoved(1)).to.equal(true);

      await game.connect(player1).setRoundResult(1, 3); // Tie
      expect(await game.currentRound()).to.equal(2);
      expect(await game.canPlayerMove()).to.equal(true); // Can move in new round

      // Round 2
      const input2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input2.add8(2);
      const encryptedMove2 = await input2.encrypt();
      await game.connect(player1).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      expect(await game.canPlayerMove()).to.equal(false);
      expect(await game.haveBothPlayersMoved(2)).to.equal(true);
    });

    it("should handle computer moves consistently across rounds", async function () {
      for (let round = 1; round <= 3; round++) {
        expect(await game.computerHasMoved(round)).to.equal(false);

        const input = fhevm.createEncryptedInput(contractAddress, player1.address);
        input.add8(1);
        const encryptedMove = await input.encrypt();
        await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

        expect(await game.computerHasMoved(round)).to.equal(true);

        // Verify computer move exists and is non-zero
        const computerMove = await game.getComputerEncryptedMove(round);
        expect(computerMove).to.not.equal(0);

        // Continue to next round
        if (round < 3) {
          await game.connect(player1).setRoundResult(round, 3); // Tie
        }
      }
    });
  });
});

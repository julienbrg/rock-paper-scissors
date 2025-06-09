import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { FhevmInstance } from "fhevmjs/node";
import { ethers } from "hardhat";

import { Game } from "../../types";
import { createInstance } from "../instance";
import { getSigners, initSigners } from "../signers";

describe("Game", function () {
  let game: Game;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let nonPlayer: HardhatEthersSigner;
  let contractAddress: string;
  let fhevm: FhevmInstance;

  before(async function () {
    await initSigners();
  });

  beforeEach(async function () {
    const signers = await getSigners();
    player1 = signers.alice;
    player2 = signers.bob;
    nonPlayer = signers.carol;

    const GameFactory = await ethers.getContractFactory("Game");
    game = await GameFactory.deploy(player1.address, player2.address);
    await game.waitForDeployment();
    contractAddress = await game.getAddress();
    fhevm = await createInstance();
  });

  describe("Deployment", function () {
    it("Should set the right players", async function () {
      expect(await game.player1()).to.equal(player1.address);
      expect(await game.player2()).to.equal(player2.address);
    });

    it("Should initialize game state correctly", async function () {
      const [p1Wins, p2Wins, currentRound, gameOver, winner] = await game.getGameState();

      expect(p1Wins).to.equal(0);
      expect(p2Wins).to.equal(0);
      expect(currentRound).to.equal(1);
      expect(gameOver).to.be.false;
      expect(winner).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Encrypted Moves", function () {
    it("Should allow player1 to make an encrypted move", async function () {
      // Create encrypted input for Rock (1)
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1); // Rock
      const encryptedMove = await input.encrypt();

      // Player1 makes move
      const tx = await game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(tx).to.emit(game, "EncryptedMoveMade").withArgs(player1.address, 1);

      // Check that player1 has moved
      expect(await game.player1HasMoved(1)).to.be.true;
      expect(await game.player2HasMoved(1)).to.be.false;
    });

    it("Should allow player2 to make an encrypted move", async function () {
      // Create encrypted input for Paper (2)
      const input = fhevm.createEncryptedInput(contractAddress, player2.address);
      input.add8(2); // Paper
      const encryptedMove = await input.encrypt();

      // Player2 makes move
      const tx = await game.connect(player2).move(encryptedMove.handles[0], encryptedMove.inputProof);

      await expect(tx).to.emit(game, "EncryptedMoveMade").withArgs(player2.address, 1);

      // Check that player2 has moved
      expect(await game.player1HasMoved(1)).to.be.false;
      expect(await game.player2HasMoved(1)).to.be.true;
    });

    it("Should emit RoundReady when both players move", async function () {
      // Player1 makes move (Rock)
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      // Player2 makes move (Paper) - should emit RoundReady
      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2);
      const encryptedMove2 = await input2.encrypt();

      await expect(game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof))
        .to.emit(game, "RoundReady")
        .withArgs(1);

      // Check both players have moved
      expect(await game.haveBothPlayersMoved(1)).to.be.true;
    });
  });

  describe("Game Logic - Rock Paper Scissors Rules", function () {
    async function makeMovesAndSetResult(
      move1: number,
      move2: number,
      expectedResult: number,
      expectedWinner?: string,
    ) {
      // Both players make moves
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(move1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(move2);
      const encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      // Set result manually (simulating FHE computation result)
      const tx = await game.connect(player1).setRoundResult(1, expectedResult);

      await expect(tx).to.emit(game, "RoundCompleted").withArgs(1, expectedResult);

      return tx;
    }

    it("Rock should beat Scissors", async function () {
      await makeMovesAndSetResult(1, 3, 1); // Rock vs Scissors, Player1 wins

      const [p1Wins, p2Wins] = await game.getGameState();
      expect(p1Wins).to.equal(1);
      expect(p2Wins).to.equal(0);
    });

    it("Paper should beat Rock", async function () {
      await makeMovesAndSetResult(1, 2, 2); // Rock vs Paper, Player2 wins

      const [p1Wins, p2Wins] = await game.getGameState();
      expect(p1Wins).to.equal(0);
      expect(p2Wins).to.equal(1);
    });

    it("Scissors should beat Paper", async function () {
      await makeMovesAndSetResult(3, 2, 1); // Scissors vs Paper, Player1 wins

      const [p1Wins, p2Wins] = await game.getGameState();
      expect(p1Wins).to.equal(1);
      expect(p2Wins).to.equal(0);
    });

    it("Should handle tie rounds correctly", async function () {
      await makeMovesAndSetResult(1, 1, 3); // Rock vs Rock, Tie

      const [p1Wins, p2Wins, currentRound] = await game.getGameState();
      expect(p1Wins).to.equal(0);
      expect(p2Wins).to.equal(0);
      expect(currentRound).to.equal(2); // Should advance to next round
    });
  });

  describe("Invalid Moves", function () {
    it("Should revert when non-player tries to move", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, nonPlayer.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await expect(
        game.connect(nonPlayer).move(encryptedMove.handles[0], encryptedMove.inputProof),
      ).to.be.revertedWithCustomError(game, "NotAPlayer");
    });

    it("Should revert when player tries to move twice in same round", async function () {
      // Player1 makes first move
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      // Player1 tries to move again
      const input2 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input2.add8(2);
      const encryptedMove2 = await input2.encrypt();

      await expect(
        game.connect(player1).move(encryptedMove2.handles[0], encryptedMove2.inputProof),
      ).to.be.revertedWithCustomError(game, "AlreadyMoved");
    });

    it("Should revert when game is already over", async function () {
      // Simulate a completed game by winning 2 rounds for player1
      for (let round = 1; round <= 2; round++) {
        // Both players make moves
        const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
        input1.add8(1);
        const encryptedMove1 = await input1.encrypt();
        await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

        const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
        input2.add8(3);
        const encryptedMove2 = await input2.encrypt();
        await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

        // Player1 wins round
        await game.connect(player1).setRoundResult(round, 1);
      }

      // Try to make a move after game is over
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await expect(
        game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof),
      ).to.be.revertedWithCustomError(game, "GameAlreadyOver");
    });
  });

  describe("Complete Games", function () {
    it("Should end game when player1 wins 2 rounds", async function () {
      // Round 1: Player1 wins
      let input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      let encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      let input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(3);
      let encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(1, 1);

      // Round 2: Player1 wins again
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(2);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(1);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      const tx = await game.connect(player1).setRoundResult(2, 1);

      await expect(tx).to.emit(game, "GameEnded").withArgs(player1.address, 2, 0);

      const [p1Wins, p2Wins, currentRound, gameOver, winner] = await game.getGameState();
      expect(p1Wins).to.equal(2);
      expect(p2Wins).to.equal(0);
      expect(gameOver).to.be.true;
      expect(winner).to.equal(player1.address);
    });

    it("Should end game when player2 wins 2 rounds", async function () {
      // Round 1: Player2 wins
      let input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      let encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      let input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2);
      let encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(1, 2);

      // Round 2: Player2 wins again
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(2);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(3);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      const tx = await game.connect(player1).setRoundResult(2, 2);

      await expect(tx).to.emit(game, "GameEnded").withArgs(player2.address, 0, 2);

      const [p1Wins, p2Wins, currentRound, gameOver, winner] = await game.getGameState();
      expect(p1Wins).to.equal(0);
      expect(p2Wins).to.equal(2);
      expect(gameOver).to.be.true;
      expect(winner).to.equal(player2.address);
    });

    it("Should handle complete game with multiple rounds including ties", async function () {
      // Round 1: Tie
      let input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      let encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      let input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(1);
      let encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(1, 3);

      // Round 2: Player1 wins
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(3);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(2, 1);

      // Round 3: Player2 wins
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(3, 2);

      // Round 4: Player1 wins (game ends)
      input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(2);
      encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(1);
      encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      const tx = await game.connect(player1).setRoundResult(4, 1);

      await expect(tx).to.emit(game, "GameEnded").withArgs(player1.address, 2, 1);

      const [p1Wins, p2Wins, currentRound, gameOver, winner] = await game.getGameState();
      expect(p1Wins).to.equal(2);
      expect(p2Wins).to.equal(1);
      expect(gameOver).to.be.true;
      expect(winner).to.equal(player1.address);
    });
  });

  describe("View Functions", function () {
    it("Should return correct game state", async function () {
      const [p1Wins, p2Wins, currentRound, gameOver, winner] = await game.getGameState();

      expect(p1Wins).to.equal(0);
      expect(p2Wins).to.equal(0);
      expect(currentRound).to.equal(1);
      expect(gameOver).to.be.false;
      expect(winner).to.equal(ethers.ZeroAddress);
    });

    it("Should return correct round results", async function () {
      // Initially, round result should be 0 (pending)
      expect(await game.getRoundResult(1)).to.equal(0);

      // After making moves and setting result
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(3);
      const encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await game.connect(player1).setRoundResult(1, 1);

      expect(await game.getRoundResult(1)).to.equal(1);
    });

    it("Should allow players to view their own encrypted moves", async function () {
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      // Player1 should be able to get their encrypted move
      const encryptedMove = await game.connect(player1).getMyEncryptedMove(1);
      expect(encryptedMove).to.not.equal(0);

      // Player2 shouldn't be able to get player1's move
      await expect(game.connect(player2).getMyEncryptedMove(1)).to.be.revertedWith(
        "Player 2 hasn't moved in this round",
      );
    });
  });

  describe("Events", function () {
    it("Should emit EncryptedMoveMade event correctly", async function () {
      const input = fhevm.createEncryptedInput(contractAddress, player1.address);
      input.add8(1);
      const encryptedMove = await input.encrypt();

      await expect(game.connect(player1).move(encryptedMove.handles[0], encryptedMove.inputProof))
        .to.emit(game, "EncryptedMoveMade")
        .withArgs(player1.address, 1);
    });

    it("Should emit RoundCompleted event with result", async function () {
      // Both players make moves
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(3);
      const encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      await expect(game.connect(player1).setRoundResult(1, 1)).to.emit(game, "RoundCompleted").withArgs(1, 1);
    });

    it("Should emit RoundReady event when both players move", async function () {
      // Player1 moves first
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      // Player2 moves - should emit RoundReady
      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2);
      const encryptedMove2 = await input2.encrypt();

      await expect(game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof))
        .to.emit(game, "RoundReady")
        .withArgs(1);
    });

    it("Should emit GameEnded event when game finishes", async function () {
      // Play two rounds where player1 wins both
      for (let round = 1; round <= 2; round++) {
        const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
        input1.add8(1);
        const encryptedMove1 = await input1.encrypt();
        await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

        const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
        input2.add8(3);
        const encryptedMove2 = await input2.encrypt();
        await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

        if (round === 2) {
          await expect(game.connect(player1).setRoundResult(round, 1))
            .to.emit(game, "GameEnded")
            .withArgs(player1.address, 2, 0);
        } else {
          await game.connect(player1).setRoundResult(round, 1);
        }
      }
    });
  });

  describe("Privacy Properties", function () {
    it("Should keep moves encrypted until round completion", async function () {
      // Make encrypted moves
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2);
      const encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      // Moves should be encrypted (non-zero handles)
      const player1Move = await game.connect(player1).getMyEncryptedMove(1);
      const player2Move = await game.connect(player2).getMyEncryptedMove(1);

      expect(player1Move).to.not.equal(0);
      expect(player2Move).to.not.equal(0);

      // Round result should be pending until manually set
      expect(await game.getRoundResult(1)).to.equal(0);
    });

    it("Should only reveal results after manual result setting", async function () {
      // Make moves
      const input1 = fhevm.createEncryptedInput(contractAddress, player1.address);
      input1.add8(1);
      const encryptedMove1 = await input1.encrypt();
      await game.connect(player1).move(encryptedMove1.handles[0], encryptedMove1.inputProof);

      const input2 = fhevm.createEncryptedInput(contractAddress, player2.address);
      input2.add8(2);
      const encryptedMove2 = await input2.encrypt();
      await game.connect(player2).move(encryptedMove2.handles[0], encryptedMove2.inputProof);

      // Result should be pending
      expect(await game.getRoundResult(1)).to.equal(0);

      // After setting result, it should be revealed
      await game.connect(player1).setRoundResult(1, 2);
      expect(await game.getRoundResult(1)).to.equal(2);
    });
  });
});

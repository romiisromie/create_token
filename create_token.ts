import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { AstanaToken } from "../target/types/astana_token";

describe("create_token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.AstanaToken as Program<AstanaToken>;
  const connection = provider.connection;

  const airdrop = async (pk: anchor.web3.PublicKey, sol = 2) => {
    const sig = await connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    const blockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature: sig,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
    });
  };

  const ata = (mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey) =>
    getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const readBalance = async (mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey) => {
    const acc = await getAccount(connection, ata(mint, owner));
    return acc.amount;
  };

  const createMint = async (authority: Keypair, decimals: number) => {
    const mint = Keypair.generate();
    await program.methods.createToken(decimals)
      .accounts({
        mint: mint.publicKey,
        payer: provider.wallet.publicKey,
        mintAuthority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([mint])
      .rpc();
    return mint;
  };

  it("should create token account, mint tokens, and transfer tokens", async () => {
    const mintAuthority = Keypair.generate();
    await airdrop(provider.wallet.publicKey);
    const mint = await createMint(mintAuthority, 9);

    const alice = Keypair.generate();
    const bob = Keypair.generate();

    // create_token_account
    for (const user of [alice, bob]) {
      await program.methods.createTokenAccount()
        .accounts({
          payer: provider.wallet.publicKey,
          mint: mint.publicKey,
          owner: user.publicKey,
          tokenAccount: ata(mint.publicKey, user.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        }).rpc();
      expect(await readBalance(mint.publicKey, user.publicKey)).to.equal(0n);
    }

    // mint_tokens
    const mintAmount = new BN(1000);
    await program.methods.mintTokens(mintAmount)
      .accounts({
        mint: mint.publicKey,
        to: ata(mint.publicKey, alice.publicKey),
        mintAuthority: mintAuthority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([mintAuthority])
      .rpc();
    expect(await readBalance(mint.publicKey, alice.publicKey)).to.equal(BigInt(mintAmount.toString()));

    // transfer_tokens
    const transferAmount = new BN(300);
    await program.methods.transferTokens(transferAmount)
      .accounts({
        from: ata(mint.publicKey, alice.publicKey),
        to: ata(mint.publicKey, bob.publicKey),
        authority: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();
    expect(await readBalance(mint.publicKey, alice.publicKey)).to.equal(BigInt(mintAmount.sub(transferAmount).toString()));
    expect(await readBalance(mint.publicKey, bob.publicKey)).to.equal(BigInt(transferAmount.toString()));
  });
});

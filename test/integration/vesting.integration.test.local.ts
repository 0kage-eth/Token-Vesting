import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber, Signer } from "ethers"
import { ethers, getNamedAccounts, network, deployments } from "hardhat"
import { developmentChains, networkConfig } from "../../helper-hardhat-config"
import { TokenVesting, ZeroKageMock } from "../../typechain-types"
import { shiftTimeToWithoutMiningBlock } from "../../utils/shiftTime"

/**
 * Full flow integration test done on local network
 * transfer 250k to tken vesting contract
 * beneficiary 1 adds schedule 1 for 100k 0KAGE -> beneficiary 2 adds schedule 2 for 50k 0KAGE ->
 * push time to just under 3 months -> within cliff period  -> calculate vested amounts, both should be 0
 * push time to 3 months later (over 6 months) -> check if vested amount is correct for 1 and 2
 * -> revoke 6 months for beneficiary 1 -> release vested for beneficiary 2
 * -> let 6 more months pass -> recalculate vested amount for beneficiary 2->
 * -> go to the end of the cycle -> release -> entire balance should go to beneficiary 2
 */

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Token vesting tests", () => {
          it("full workflow test", async () => {
              // STEP 0 -> Get all contracts and accounts in order
              await deployments.fixture(["main"])
              const accounts = await ethers.getSigners()

              const beneficiary1 = accounts[1]
              const beneficiary2 = accounts[2]
              const owner = accounts[0]

              const tokenVestingContract: TokenVesting = await ethers.getContract(
                  "TokenVesting",
                  owner.address
              )
              const zKageContract: ZeroKageMock = await ethers.getContract(
                  "ZeroKageMock",
                  owner.address
              )

              const initialBalance1 = await zKageContract.balanceOf(beneficiary1.address)
              const initialBalance2 = await zKageContract.balanceOf(beneficiary2.address)

              // STEP 1 -> Transfer 250k tokens to token vesting contract
              const funding = ethers.utils.parseEther("250000")
              const transferTx = await zKageContract.transfer(tokenVestingContract.address, funding)
              await transferTx.wait(1)

              const currentBlockNum = await ethers.provider.getBlockNumber()
              const currentTime = (await ethers.provider.getBlock(currentBlockNum)).timestamp

              const vestingCycle1 = 30 * 24 * 60 * 60 // 1 month = 30 days
              const duration1 = 36 * vestingCycle1 // 36 vesting cycles
              const cliff1 = 6 * vestingCycle1 // 6 months  cliff
              const vestedAmount1 = ethers.utils.parseEther("100000")

              const vestingCycle2 = 30 * 24 * 60 * 60 // 1 month = 30 days
              const duration2 = 12 * vestingCycle2 // 12 vesting cycles
              const cliff2 = 3 * vestingCycle2 // 3 months  cliff
              const vestedAmount2 = ethers.utils.parseEther("50000")

              // STEP 3 -> Create vesting schedules 1 and 2
              const createTx1 = await tokenVestingContract.createVestingSchedule(
                  beneficiary1.address,
                  currentTime,
                  cliff1,
                  duration1,
                  vestingCycle1,
                  true,
                  vestedAmount1,
                  0
              )

              const createTx2 = await tokenVestingContract.createVestingSchedule(
                  beneficiary2.address,
                  currentTime,
                  cliff2,
                  duration2,
                  vestingCycle2,
                  true,
                  vestedAmount2,
                  0
              )

              // STEP 4 -> Let 3 months pass (cliff 2). Calculate vested amounts in both schedules
              // both vesting amounts should be  0 -> within both cliffs
              // subtracting -1 to be just under 1 second of cliff ending
              await shiftTimeToWithoutMiningBlock(currentTime + cliff2 - 1)

              const id1 = await tokenVestingContract.getId(beneficiary1.address, 0)
              const id2 = await tokenVestingContract.getId(beneficiary2.address, 0)

              const vestableAmt1 = await tokenVestingContract.getReleasableAmount(id1)
              const vestableAmt2 = await tokenVestingContract.getReleasableAmount(id2)

              //   within cliff, vested1 = 0
              expect(vestableAmt1).equals(
                  0,
                  "vestable amount 1 = 0 since we are within cliff period"
              )

              // within cliff, vested2 = 0
              expect(vestableAmt2).equals(
                  0,
                  "vestable amount 2 = 0 since we are within cliff period"
              )

              // STEP 5 -> Now move 3 more months ->  at this point
              //vested 1 = 1/12'th of total vested, vested2 = 1/2 of total vested
              await shiftTimeToWithoutMiningBlock(currentTime + cliff1)
              const vestableAmt11 = await tokenVestingContract.getReleasableAmount(id1)
              const vestableAmt21 = await tokenVestingContract.getReleasableAmount(id2)

              //  at 6 months -> vested 1 = 1/6th of total
              expect(vestableAmt11).equals(
                  vestedAmount1.div(6),
                  "vestable amount 1 = 1/6 of total vested (6 months of 3 years) "
              )

              //  at 6 months -> vested 2 = 1/2 of total
              expect(vestableAmt21).equals(
                  vestedAmount2.div(2),
                  "vestable amount 2 = 1/2 of total vested (6 months of 1 year)"
              )

              const totalVestedBeforeRelease = await tokenVestingContract.getTotalVestedAmount()

              // STEP 6 -> Now release vestable funds in schedule 2
              //At this point -> release in schedule 2 should be equal to 50% of vestedAmount2
              // total vested decreased by amount released

              const releaseTx = await tokenVestingContract.release(id2, vestableAmt21)
              await releaseTx.wait(1)

              const totalVestedAfterRelease = await tokenVestingContract.getTotalVestedAmount()
              const schedule2 = await tokenVestingContract.getVestingSchedule(id2)

              expect(totalVestedBeforeRelease.sub(vestableAmt21)).equals(
                  totalVestedAfterRelease,
                  "Total vested amount should reduce on release of schedule 2"
              )
              expect(schedule2.released).equals(
                  vestableAmt21,
                  "Released amount should increase by vested amount input into release function"
              )

              // STEP 7 -> Now move another 6 months to 1 year
              // At this point ->vestable in schedule 2 would be 50% of initial amount (everything is vested by this point)
              // In schedule 1, vestable amount = 1/3rd of total
              await shiftTimeToWithoutMiningBlock(currentTime + duration2) // 1 year time shift

              const vestableAmt13 = await tokenVestingContract.getReleasableAmount(id1)
              const vestableAmt23 = await tokenVestingContract.getReleasableAmount(id2)

              //   at 1 yr, vested amount 1 = 1/3 of schedule 1 vesting
              expect(vestableAmt13).equals(
                  vestedAmount1.div(3),
                  "vestable amount 1 = 1/3 of total vested (12 months of 3 years) "
              )

              //   at 1 yr, vested amount 1 = 50% of schedule 2 vesting (remaining 50% was already released at the 6 month point)
              expect(vestableAmt23).equals(
                  vestedAmount2.div(2),
                  "vestable amount 2 = 1/2 of total vested (12 months of 1 year - already released 50%)"
              )

              // STEP 8: Now revoke schedule 1
              const b1BalanceBefore = await zKageContract.balanceOf(beneficiary1.address)
              const revokeTx1 = await tokenVestingContract.revoke(id1)
              await releaseTx.wait(1)

              // on revoking schedule 1, amount released should be 1/3rd of total
              const schedule1AfterRevoke = await tokenVestingContract.getVestingSchedule(id1)
              const b1BalanceAfter = await zKageContract.balanceOf(beneficiary1.address)

              expect(schedule1AfterRevoke.released).equals(
                  vestableAmt13,
                  "Total released = vestable amount till that point"
              )

              expect(b1BalanceAfter).equals(
                  b1BalanceBefore.add(schedule1AfterRevoke.released),
                  "wallet balance of beneficiary 1 should increase by released amount"
              )

              // on revoking schedule 1, beneficiary wallet should increase by amount released

              // on revoking schedule 1, total vested amount in schedule 1 = amount pending of schedule 2
              const totalVestedAt1YrAfterRevoke = await tokenVestingContract.getTotalVestedAmount()

              expect(totalVestedAt1YrAfterRevoke).equals(
                  vestableAmt23,
                  "total vested = only vested amount that is pending in schedule 2"
              )

              // STEP 9: Release schedule 2
              const revokeTx2 = await tokenVestingContract.revoke(id2)
              await releaseTx.wait(1)

              // check if total vested = 0

              const totalVestedAFinal = await tokenVestingContract.getTotalVestedAmount()
              expect(totalVestedAFinal).equals(
                  0,
                  "total vested after both schedules are revoked & released = 0"
              )

              // schedule 2 after final release
              const schedule2AfterFinalRelease = await tokenVestingContract.getVestingSchedule(id2)

              // check total released = initial allocated for vesting
              expect(schedule2AfterFinalRelease.released).equals(
                  vestedAmount2,
                  "Total released = total allocated for vesting"
              )

              // amount increased in wallet should be equal to total released
              const finalBalance2 = await zKageContract.balanceOf(beneficiary2.address)
              expect(initialBalance2.add(vestedAmount2)).equals(
                  finalBalance2,
                  "balance increased by total vested amount"
              )
          })
      })

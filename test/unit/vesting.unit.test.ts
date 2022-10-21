import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber, Signer } from "ethers"
import { ethers, getNamedAccounts, network, deployments } from "hardhat"
import { developmentChains, networkConfig } from "../../helper-hardhat-config"
import { TokenVesting, ZeroKageMock } from "../../typechain-types"
import { shiftTime, shiftTimeToWithoutMiningBlock } from "../../utils/shiftTime"

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Token vesting tests", () => {
          let tokenVestingContract: TokenVesting
          let zKageContract: ZeroKageMock
          let beneficiary: SignerWithAddress
          let secondBeneficiary: SignerWithAddress
          let owner: SignerWithAddress

          beforeEach(async () => {
              // create a TokenVesting contract
              await deployments.fixture(["main"])
              const accounts = await ethers.getSigners()

              beneficiary = accounts[1]
              secondBeneficiary = accounts[2]
              owner = accounts[0]
              tokenVestingContract = await ethers.getContract("TokenVesting", owner.address)
              zKageContract = await ethers.getContract("ZeroKageMock", owner.address)
          })

          describe("constructor tests", () => {
              // check if ZeroKage address is correctly captured in storage

              it("token address", async () => {
                  const address = await tokenVestingContract.getTokenAddress()
                  expect(address).equals(zKageContract.address, "Incorrect token address")
              })
          })

          describe("create vesting schedule", () => {
              let currentTime: number
              let duration: number
              let vestingCycle: number
              let cliff: number
              let vestedAmount: BigNumber

              beforeEach(async () => {
                  // fund 250k 0Kage from owner to token vesting contract
                  const funding = ethers.utils.parseEther("250000")
                  const transferTx = await zKageContract.transfer(
                      tokenVestingContract.address,
                      funding
                  )
                  await transferTx.wait(1)

                  // create a new schedule
                  const currentBlockNum = await ethers.provider.getBlockNumber()
                  currentTime = (await ethers.provider.getBlock(currentBlockNum)).timestamp
                  duration = 3 * 365 * 24 * 60 * 60 // 3 years
                  vestingCycle = 30 * 24 * 60 * 60 // 30 days
                  cliff = 180 * 24 * 60 * 60 // 6 months  cliff
                  vestedAmount = funding
              })

              // 1. should fail if vested amount > token balance
              it("vested amount > token balance", async () => {
                  const higherAmount = vestedAmount.add(10000)
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )
                  await expect(
                      tokenVestingContract.createVestingSchedule(
                          beneficiary.address,
                          currentTime,
                          cliff,
                          duration,
                          vestingCycle,
                          true,
                          higherAmount,
                          0
                      )
                  )
                      .to.be.revertedWithCustomError(
                          tokenVestingContract,
                          "TokenVesting__InsufficientBalance"
                      )
                      .withArgs(beneficiary.address, contractBalance, higherAmount)
                  //   await creatScheduleTx.wait(1)
              })

              // 2. should fail if vesting duration = 0
              it("duration=0", async () => {
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )
                  await expect(
                      tokenVestingContract.createVestingSchedule(
                          beneficiary.address,
                          currentTime,
                          cliff,
                          0,
                          vestingCycle,
                          true,
                          vestedAmount,
                          0
                      )
                  ).to.be.revertedWith("Invalid vesting duration. Enter valid value in seconds")
                  //   await creatScheduleTx.wait(1)
              })

              // 3. sshould fail if vested amount <= 0
              it("vested amount=0", async () => {
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )
                  await expect(
                      tokenVestingContract.createVestingSchedule(
                          beneficiary.address,
                          currentTime,
                          cliff,
                          duration,
                          vestingCycle,
                          true,
                          0,
                          0
                      )
                  ).to.be.revertedWith("Invalid vesting amount. Enter value > 0")
                  //   await creatScheduleTx.wait(1)
              })

              // 4. should fail if vesting time cycle <= 0
              it("vesting cycle=0", async () => {
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )
                  await expect(
                      tokenVestingContract.createVestingSchedule(
                          beneficiary.address,
                          currentTime,
                          cliff,
                          duration,
                          0,
                          true,
                          vestedAmount,
                          0
                      )
                  ).to.be.revertedWith("Invalid vesting time interval in seconds")
              })

              // 5. should fail if any other user except owner is creating schedule
              it("only owner can create", async () => {
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )
                  await expect(
                      tokenVestingContract
                          .connect(beneficiary)
                          .createVestingSchedule(
                              beneficiary.address,
                              currentTime,
                              cliff,
                              duration,
                              vestingCycle,
                              true,
                              vestedAmount,
                              0
                          )
                  ).to.be.revertedWith("Ownable: caller is not the owner")
              })

              // 6. total vested amount should increase by vesting amount used for creation
              it("total vested amount should increase on creation", async () => {
                  const totalVestedBeforeCreation =
                      await tokenVestingContract.getTotalVestedAmount()

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount,
                      0
                  )
                  await createTx.wait(1)

                  const totalVestedAfterCreation = await tokenVestingContract.getTotalVestedAmount()

                  expect(totalVestedBeforeCreation).equals(0, "total vested before creation = 0")
                  expect(totalVestedAfterCreation).equals(
                      vestedAmount,
                      "total vested after creation = vested amount"
                  )
              })
              // 7. id for vesting schedule should be a keccak encoding using address + index (0)
              // this id should match with getVestingIdAtIndex(0) -> first element in the s_vestingScheduleIds array
              // should also match getId(beneficiary address, 0)
              it("vesting schedule id encoding", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount,
                      0
                  )
                  await createTx.wait(1)

                  const vestingIdAtIndex = await tokenVestingContract.getVestingIdAtIndex(0)

                  expect(vestingIdAtIndex).equals(
                      id,
                      "vesting id for beneficiary with index 0 = first element in vestingIdAtIndex array"
                  )
              })

              // 8. vesting schedule for beneficiary should be exactly 1
              it("vesting schedule per beneficiary count", async () => {
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount,
                      0
                  )
                  await createTx.wait(1)

                  const numVestingSchedules = await tokenVestingContract.getCountPerBeneficiary(
                      beneficiary.address
                  )

                  expect(numVestingSchedules).equals(
                      1,
                      "number of vesting schedules for given beneficiary = 1"
                  )
              })
              // 9. vesting schedule count should increase by 1
              it("vesting schedule count to increase by 1", async () => {
                  const vestingSchedulesCountBefore =
                      await tokenVestingContract.getVestingScheduleCount()
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount,
                      0
                  )
                  await createTx.wait(1)

                  const vestingSchedulesCountAfter =
                      await tokenVestingContract.getVestingScheduleCount()
                  expect(vestingSchedulesCountBefore.add(1)).equals(
                      vestingSchedulesCountAfter,
                      "vesting schedule count incremented by 1"
                  )
              })
              // 10. Withdrawal balance should reduce exactly by amount vested
              it("reduce withdrawable balance", async () => {
                  const withdrawabalBalanceBefore =
                      await tokenVestingContract.getWithdrawableBalance()
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount,
                      0
                  )
                  await createTx.wait(1)

                  const withdrawabalBalanceAfter =
                      await tokenVestingContract.getWithdrawableBalance()

                  expect(withdrawabalBalanceBefore).equals(
                      contractBalance,
                      "full balance withdrawable before creating schedule"
                  )

                  expect(withdrawabalBalanceBefore.sub(vestedAmount)).equals(
                      withdrawabalBalanceAfter,
                      "withdrawable balance should be reduced by vested amount after schedule creation"
                  )
              })
          })

          describe("second vesting schedule created for same beneficiary", () => {
              let currentTime: number
              let duration: number
              let vestingCycle: number
              let cliff: number
              let vestedAmount1: BigNumber
              let vestedAmount2: BigNumber

              beforeEach(async () => {
                  // fund 250k 0Kage from owner to token vesting contract
                  const funding = ethers.utils.parseEther("500000")
                  const transferTx = await zKageContract.transfer(
                      tokenVestingContract.address,
                      funding
                  )
                  await transferTx.wait(1)

                  // create a new schedule
                  const currentBlockNum = await ethers.provider.getBlockNumber()
                  currentTime = (await ethers.provider.getBlock(currentBlockNum)).timestamp
                  duration = 3 * 365 * 24 * 60 * 60 // 3 years
                  vestingCycle = 30 * 24 * 60 * 60 // 30 days
                  cliff = 180 * 24 * 60 * 60 // 6 months  cliff
                  vestedAmount1 = ethers.utils.parseEther("150000")
                  vestedAmount2 = ethers.utils.parseEther("250000")

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount1,
                      0
                  )
                  await createTx.wait(1)
              })

              // Test cases assume second schedule creation for same beneficiary

              // 1. total schedules created should be 2
              it("vesting schedule count = 2", async () => {
                  const vestingSchedulesCountBefore =
                      await tokenVestingContract.getVestingScheduleCount()
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount2,
                      0
                  )
                  await createTx.wait(1)

                  const vestingSchedulesCountAfter =
                      await tokenVestingContract.getVestingScheduleCount()
                  expect(vestingSchedulesCountBefore).equals(1, "vesting schedule count = 1")
                  expect(vestingSchedulesCountAfter).equals(2, "vesting schedule count = 2")
              })

              // 2. total schedules for beneficiary = 2
              it("total schedules for beneficiary = 2", async () => {
                  const vestingSchedulesCountBefore =
                      await tokenVestingContract.getVestingScheduleCount()
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount2,
                      0
                  )
                  await createTx.wait(1)

                  const numVestingSchedules = await tokenVestingContract.getCountPerBeneficiary(
                      beneficiary.address
                  )

                  expect(numVestingSchedules).equals(
                      2,
                      "number of vesting schedules for given beneficiary = 2"
                  )
              })

              // 3. withdrawabal balance should be 100,000 (500,000 - 150,000 - 250,000)
              it("reduce withdrawable balance after second schedule", async () => {
                  const withdrawabalBalanceBefore =
                      await tokenVestingContract.getWithdrawableBalance()
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount2,
                      0
                  )
                  await createTx.wait(1)

                  const withdrawabalBalanceAfter =
                      await tokenVestingContract.getWithdrawableBalance()

                  expect(withdrawabalBalanceBefore).equals(
                      contractBalance.sub(vestedAmount1),
                      "full balance - vested amount 1 =  withdrawable before creating schedule2"
                  )

                  expect(withdrawabalBalanceAfter.add(vestedAmount2)).equals(
                      withdrawabalBalanceBefore,
                      "full balance - vested amount 1 - vested amount 2 =  withdrawable after creating schedule2"
                  )
              })

              // 4. getId(beneficiary, 1) = vestingIdAtIndex[1]
              it("vesting schedule id encoding after second schedule", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 1)

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount2,
                      0
                  )
                  await createTx.wait(1)

                  const vestingIdAtIndex = await tokenVestingContract.getVestingIdAtIndex(1)

                  expect(vestingIdAtIndex).equals(
                      id,
                      "vesting id for beneficiary with index 1 = second element in vestingIdAtIndex array"
                  )
              })

              // 5. if second schedule vesting amount > 350k => throw an error
              it("vested amount > token balance after second schedule", async () => {
                  const higherAmount = ethers.utils.parseEther("355000")
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )
                  await expect(
                      tokenVestingContract.createVestingSchedule(
                          beneficiary.address,
                          currentTime,
                          cliff,
                          duration,
                          vestingCycle,
                          true,
                          higherAmount,
                          0
                      )
                  )
                      .to.be.revertedWithCustomError(
                          tokenVestingContract,
                          "TokenVesting__InsufficientBalance"
                      )
                      .withArgs(
                          beneficiary.address,
                          contractBalance.sub(vestedAmount1),
                          higherAmount
                      )
                  //   await creatScheduleTx.wait(1)
              })
          })

          describe("second vesting schedule created for different beneficiary", () => {
              let currentTime: number
              let duration: number
              let vestingCycle: number
              let cliff: number
              let vestedAmount1: BigNumber
              let vestedAmount2: BigNumber

              beforeEach(async () => {
                  // fund 250k 0Kage from owner to token vesting contract
                  const funding = ethers.utils.parseEther("500000")
                  const transferTx = await zKageContract.transfer(
                      tokenVestingContract.address,
                      funding
                  )
                  await transferTx.wait(1)

                  // create a new schedule
                  const currentBlockNum = await ethers.provider.getBlockNumber()
                  currentTime = (await ethers.provider.getBlock(currentBlockNum)).timestamp
                  duration = 3 * 365 * 24 * 60 * 60 // 3 years
                  vestingCycle = 30 * 24 * 60 * 60 // 30 days
                  cliff = 180 * 24 * 60 * 60 // 6 months  cliff
                  vestedAmount1 = ethers.utils.parseEther("150000")
                  vestedAmount2 = ethers.utils.parseEther("250000")

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount1,
                      0
                  )
                  await createTx.wait(1)
              })

              // Test cases assume second schedule creation for same beneficiary

              // 1. total schedules created should be 2
              it("vesting schedule count = 2 with second beneficiary", async () => {
                  const vestingSchedulesCountBefore =
                      await tokenVestingContract.getVestingScheduleCount()
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      secondBeneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount2,
                      0
                  )
                  await createTx.wait(1)

                  const vestingSchedulesCountAfter =
                      await tokenVestingContract.getVestingScheduleCount()
                  expect(vestingSchedulesCountBefore).equals(1, "vesting schedule count = 1")
                  expect(vestingSchedulesCountAfter).equals(2, "vesting schedule count = 2")
              })

              // 2. total schedules for beneficiary = 2
              it("total schedules for beneficiary = 1, second beneficiary = 1", async () => {
                  const vestingSchedulesCountBefore =
                      await tokenVestingContract.getVestingScheduleCount()
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      secondBeneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount2,
                      0
                  )
                  await createTx.wait(1)

                  const numVestingSchedules = await tokenVestingContract.getCountPerBeneficiary(
                      beneficiary.address
                  )

                  const numVestingSchedules2 = await tokenVestingContract.getCountPerBeneficiary(
                      secondBeneficiary.address
                  )

                  expect(numVestingSchedules).equals(
                      1,
                      "number of vesting schedules for given beneficiary = 1"
                  )
                  expect(numVestingSchedules2).equals(
                      1,
                      "number of vesting schedules for second beneficiary = 1"
                  )
              })

              // 3. withdrawabal balance should be 100,000 (500,000 - 150,000 - 250,000)
              it("reduce withdrawable balance after second schedule", async () => {
                  const withdrawabalBalanceBefore =
                      await tokenVestingContract.getWithdrawableBalance()
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      secondBeneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount2,
                      0
                  )
                  await createTx.wait(1)

                  const withdrawabalBalanceAfter =
                      await tokenVestingContract.getWithdrawableBalance()

                  expect(withdrawabalBalanceBefore).equals(
                      contractBalance.sub(vestedAmount1),
                      "full balance - vested amount 1 =  withdrawable before creating schedule2"
                  )

                  expect(withdrawabalBalanceAfter.add(vestedAmount2)).equals(
                      withdrawabalBalanceBefore,
                      "full balance - vested amount 1 - vested amount 2 =  withdrawable after creating schedule2"
                  )
              })

              // 4. getId(beneficiary, 1) = vestingIdAtIndex[1]
              it("vesting schedule id encoding for second beneficiary after second schedule", async () => {
                  const id = await tokenVestingContract.getId(secondBeneficiary.address, 0)

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      secondBeneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount2,
                      0
                  )
                  await createTx.wait(1)

                  const vestingIdAtIndex = await tokenVestingContract.getVestingIdAtIndex(1)

                  expect(vestingIdAtIndex).equals(
                      id,
                      "vesting id for second beneficiary with index 0 = second element in vestingIdAtIndex array"
                  )
              })

              // 5. if second schedule vesting amount > 350k => throw an error
              it("vested amount > token balance with second beneficiary after second schedule", async () => {
                  const higherAmount = ethers.utils.parseEther("355000")
                  const contractBalance = await zKageContract.balanceOf(
                      tokenVestingContract.address
                  )
                  await expect(
                      tokenVestingContract.createVestingSchedule(
                          secondBeneficiary.address,
                          currentTime,
                          cliff,
                          duration,
                          vestingCycle,
                          true,
                          higherAmount,
                          0
                      )
                  )
                      .to.be.revertedWithCustomError(
                          tokenVestingContract,
                          "TokenVesting__InsufficientBalance"
                      )
                      .withArgs(
                          secondBeneficiary.address,
                          contractBalance.sub(vestedAmount1),
                          higherAmount
                      )
                  //   await creatScheduleTx.wait(1)
              })
          })

          describe("revoke vesting schedule", () => {
              let currentTime: number
              let duration: number
              let vestingCycle: number
              let cliff: number
              let vestedAmount1: BigNumber

              beforeEach(async () => {
                  // fund 250k 0Kage from owner to token vesting contract
                  const funding = ethers.utils.parseEther("500000")
                  const transferTx = await zKageContract.transfer(
                      tokenVestingContract.address,
                      funding
                  )
                  await transferTx.wait(1)

                  // create a new schedule
                  const currentBlockNum = await ethers.provider.getBlockNumber()
                  currentTime = (await ethers.provider.getBlock(currentBlockNum)).timestamp
                  duration = 3 * 365 * 24 * 60 * 60 // 3 years
                  vestingCycle = 30 * 24 * 60 * 60 // 30 days
                  cliff = 180 * 24 * 60 * 60 // 6 months  cliff
                  vestedAmount1 = ethers.utils.parseEther("150000")

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount1,
                      0
                  )
                  await createTx.wait(1)
              })

              // 1. only owner can revoke
              it("only owner can revoke", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  await expect(
                      tokenVestingContract.connect(beneficiary).revoke(id)
                  ).to.be.revertedWith("Ownable: caller is not the owner")
              })
              // cannot revoke a non revocable contract
              it("cannot revoke a non-revocable schedule", async () => {
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      false,
                      vestedAmount1,
                      0
                  )
                  await createTx.wait(1)

                  const id = await tokenVestingContract.getId(beneficiary.address, 1)
                  await expect(tokenVestingContract.revoke(id)).to.be.revertedWith(
                      "This vesting schedule is not revocable"
                  )
              })

              it("revoke before cliff ends", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  const timeTx = await shiftTime(cliff / 2)

                  const revokeTx = await tokenVestingContract.revoke(id)
                  revokeTx.wait(1)

                  // total vested should go to zero -> part of amount is released, other part is unvested
                  const totalVested = await tokenVestingContract.getTotalVestedAmount()
                  expect(totalVested).equals(
                      0,
                      "Total Vested Amount after revocation should be 0 for single schedule"
                  )

                  // revoke status should be true

                  const vestingSchedule = await tokenVestingContract.getVestingSchedule(id)
                  expect(vestingSchedule.revoked, "vesting revoke status must be true")

                  // released amount should be half of vested amount
                  expect(vestingSchedule.released).equals(
                      0,
                      "vested amount released = 0 before cliff ends"
                  )
              })

              // revoke before cliff period ends -> released amount = 0, total
              // shift time to midpoint -> half amount should be released
              it("revoke at midpoint", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  const timeTx = await shiftTime(duration / 2)

                  const revokeTx = await tokenVestingContract.revoke(id)
                  revokeTx.wait(1)

                  // total vested should go to zero -> part of amount is released, other part is unvested
                  const totalVested = await tokenVestingContract.getTotalVestedAmount()
                  expect(totalVested).equals(
                      0,
                      "Total Vested Amount after revocation should be 0 for single schedule"
                  )

                  // revoke status should be true

                  const vestingSchedule = await tokenVestingContract.getVestingSchedule(id)
                  expect(vestingSchedule.revoked, "vesting revoke status must be true")

                  // released amount should be half of vested amount
                  expect(vestingSchedule.released).equals(
                      vestedAmount1.div(2),
                      "half of vested should be released"
                  )
              })

              // shift time to midpoint -> half amount should be released
              it("revoke at end time", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  const timeTx = await shiftTime(duration)

                  const revokeTx = await tokenVestingContract.revoke(id)
                  revokeTx.wait(1)

                  // total vested should go to zero -> part of amount is released, other part is unvested
                  const totalVested = await tokenVestingContract.getTotalVestedAmount()
                  expect(totalVested).equals(
                      0,
                      "Total Vested Amount after revocation should be 0 for single schedule"
                  )

                  // revoke status should be true

                  const vestingSchedule = await tokenVestingContract.getVestingSchedule(id)
                  expect(vestingSchedule.revoked, "vesting revoke status must be true")

                  // released amount should be half of vested amount
                  expect(vestingSchedule.released).equals(
                      vestedAmount1,
                      "All vested amount should be released"
                  )
              })
          })

          describe("release vesting schedule", () => {
              let currentTime: number
              let duration: number
              let vestingCycle: number
              let cliff: number
              let vestedAmount1: BigNumber

              beforeEach(async () => {
                  // fund 250k 0Kage from owner to token vesting contract
                  const funding = ethers.utils.parseEther("500000")
                  const transferTx = await zKageContract.transfer(
                      tokenVestingContract.address,
                      funding
                  )
                  await transferTx.wait(1)

                  // create a new schedule
                  const currentBlockNum = await ethers.provider.getBlockNumber()
                  currentTime = (await ethers.provider.getBlock(currentBlockNum)).timestamp
                  duration = 3 * 365 * 24 * 60 * 60 // 3 years
                  vestingCycle = 30 * 24 * 60 * 60 // 30 days
                  cliff = 180 * 24 * 60 * 60 // 6 months  cliff
                  vestedAmount1 = ethers.utils.parseEther("150000")

                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount1,
                      0
                  )
                  await createTx.wait(1)
              })

              // only if vesting schedule is not revoked
              it("release after schedule is revoked", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)

                  const revokeTx = await tokenVestingContract.revoke(id)
                  revokeTx.wait(1)

                  await expect(tokenVestingContract.release(id, vestedAmount1))
                      .to.be.revertedWithCustomError(
                          tokenVestingContract,
                          "TokenVesting__VestingScheduleRevoked"
                      )
                      .withArgs(owner.address)
              })

              // only beneficiary or owner can release - no one else
              it("release by random address fails", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)

                  await expect(
                      tokenVestingContract.connect(secondBeneficiary).release(id, vestedAmount1)
                  ).to.be.revertedWith(
                      "Only beneficiary or owner authorized to release vested tokens"
                  )
              })

              // release amount = 0 , error
              it("release amount=0", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)

                  await expect(tokenVestingContract.release(id, 0)).to.be.revertedWith(
                      "Invalid release amount"
                  )
                  //   await creatScheduleTx.wait(1)
              })
              // vested amount < amount requested for release
              it("release amount > vested amount", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  const timeTx = await shiftTime(duration)

                  await expect(
                      tokenVestingContract.release(id, vestedAmount1.add(10000000))
                  ).to.be.revertedWith("Tokens specified are more than your vested balance")
                  //   await creatScheduleTx.wait(1)
              })
              // Release within cliff period -> amount released = 0
              it("release within cliff period", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  const timeTx = await shiftTimeToWithoutMiningBlock(currentTime + cliff / 2) // time within cliff period

                  await expect(
                      tokenVestingContract.release(id, vestedAmount1.div(2))
                  ).to.be.revertedWith("No vested tokens as on date")
              })

              // schedule.released should increase by amount released
              it("release amount in schedule should increase by amount released", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  const timeTx = await shiftTime(duration / 2)

                  const tx = await tokenVestingContract.release(id, vestedAmount1.div(2))
                  await tx.wait(1)

                  const vestedSchedule = await tokenVestingContract.getVestingSchedule(id)
                  expect(vestedSchedule.released).equals(
                      vestedAmount1.div(2),
                      "Amount released should reflect in vesting schedule"
                  )
              })

              // total vested should reduce
              it("total vested should reduce after release", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  const timeTx = await shiftTime(duration / 2)

                  const totalVestedBefore = await tokenVestingContract.getTotalVestedAmount()
                  expect(totalVestedBefore).equals(
                      vestedAmount1,
                      "Total vested should equal vested amount before release"
                  )
                  const tx = await tokenVestingContract.release(id, vestedAmount1.div(2))
                  await tx.wait(1)

                  const vestedSchedule = await tokenVestingContract.getVestingSchedule(id)
                  const totalVestedAfter = await tokenVestingContract.getTotalVestedAmount()

                  expect(totalVestedAfter).equals(
                      vestedAmount1.div(2),
                      "Total vested should equal 50% of initial vested amount after release"
                  )
              })

              // balance of beneficiary account should increase by released amount
              it("withdrawal balance of beneficiary should increase by released amount", async () => {
                  const id = await tokenVestingContract.getId(beneficiary.address, 0)
                  const timeTx = await shiftTime(duration / 2)

                  const tokenBalanceBefore = await zKageContract.balanceOf(beneficiary.address)
                  const releaseAmount = vestedAmount1.div(2)
                  const tx = await tokenVestingContract.release(id, releaseAmount)
                  await tx.wait(1)

                  const tokenBalanceAfter = await zKageContract.balanceOf(beneficiary.address)

                  expect(tokenBalanceAfter).equals(
                      tokenBalanceBefore.add(releaseAmount),
                      "Token balance of beneficiary should increase by amount released"
                  )
              })
          })

          describe("event emission testing", () => {
              let currentTime: number
              let duration: number
              let vestingCycle: number
              let cliff: number
              let vestedAmount: BigNumber

              beforeEach(async () => {
                  // fund 250k 0Kage from owner to token vesting contract
                  const funding = ethers.utils.parseEther("250000")
                  const transferTx = await zKageContract.transfer(
                      tokenVestingContract.address,
                      funding
                  )
                  await transferTx.wait(1)

                  // create a new schedule
                  const currentBlockNum = await ethers.provider.getBlockNumber()
                  currentTime = (await ethers.provider.getBlock(currentBlockNum)).timestamp
                  duration = 3 * 365 * 24 * 60 * 60 // 3 years
                  vestingCycle = 30 * 24 * 60 * 60 // 30 days
                  cliff = 180 * 24 * 60 * 60 // 6 months  cliff
                  vestedAmount = funding
              })

              // 1.  emit CreateSchedule event when a new schedule is created
              it("emit create schedule event", async () => {
                  await expect(
                      tokenVestingContract.createVestingSchedule(
                          beneficiary.address,
                          currentTime,
                          cliff,
                          duration,
                          vestingCycle,
                          true,
                          vestedAmount,
                          0
                      )
                  )
                      .to.emit(tokenVestingContract, "CreateSchedule")
                      .withArgs(beneficiary.address, 0, vestedAmount)
                  //   await creatScheduleTx.wait(1)
              })

              // 2.  emit revokeSchedule event when a schedule is revoked
              it("emit revoke schedule event", async () => {
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount,
                      0
                  )
                  await createTx.wait(1)

                  await shiftTimeToWithoutMiningBlock(currentTime + duration / 2)

                  const id = await tokenVestingContract.getId(beneficiary.address, 0)

                  // 50% of vesting allocation is returned, 50% is released to beneficiary

                  await expect(tokenVestingContract.revoke(id))
                      .to.emit(tokenVestingContract, "RevokeSchedule")
                      .withArgs(beneficiary.address, 0, vestedAmount.div(2), vestedAmount.div(2))
              })

              // 3. emit release Schedule event when a schedule is released
              it("emit release schedule event", async () => {
                  const createTx = await tokenVestingContract.createVestingSchedule(
                      beneficiary.address,
                      currentTime,
                      cliff,
                      duration,
                      vestingCycle,
                      true,
                      vestedAmount,
                      0
                  )
                  await createTx.wait(1)

                  await shiftTimeToWithoutMiningBlock(currentTime + duration / 2)

                  const id = await tokenVestingContract.getId(beneficiary.address, 0)

                  // 25% of vesting allocation is released

                  await expect(tokenVestingContract.release(id, vestedAmount.div(4)))
                      .to.emit(tokenVestingContract, "ReleaseSchedule")
                      .withArgs(beneficiary.address, 0, owner.address, vestedAmount.div(4))
              })
          })
      })

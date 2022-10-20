import { ethers, getNamedAccounts } from "hardhat"
import { TokenVesting } from "../typechain-types"

const testing = async () => {
    const blockNum = await ethers.provider.getBlockNumber()

    const block = await ethers.provider.getBlock(blockNum)

    console.log(`timestamp`, block.timestamp)

    const { deployer } = await getNamedAccounts()
    const vestingContract: TokenVesting = await ethers.getContract("TokenVesting", deployer)

    const createScheduleTx = await vestingContract.createVestingSchedule(
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        1666264743,
        31104000,
        93312000,
        2592000,
        true,
        ethers.utils.parseEther("100"),
        0
    )
    const receipt = await createScheduleTx.wait(1)

    console.log(`receipt hash ${receipt.transactionHash}`)

    // beneficiary 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
    // start time 1666264743
    // cliff 31104000
    // duration 93312000
    // vesting cycle 2592000
    // revocable true
    // vested Amount 100000000000000000000
}

testing()
    .then(() => {
        process.exit(0)
    })
    .catch((e) => {
        console.log(e)
        process.exit(1)
    })

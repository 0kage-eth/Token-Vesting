// script to move time to check vesting calculations

import { ethers, getNamedAccounts, network } from "hardhat"
import { developmentChains } from "../helper-hardhat-config"
import { TokenVesting } from "../typechain-types"
import { shiftTime, shiftTimeWithoutMiningBlock } from "../utils/shiftTime"

const moveTime = async (numDays: number) => {
    if (developmentChains.includes(network.name)) {
        const timeShift = numDays * 24 * 60 * 60
        await shiftTimeWithoutMiningBlock(timeShift)
        console.log(`Time moved ahead by ${numDays} days`)
    }
}

moveTime(200)
    .then(() => {
        process.exit(0)
    })
    .catch((e) => {
        console.log(e)
        process.exit(1)
    })

import { mine, time } from "@nomicfoundation/hardhat-network-helpers"

/**
 * @notice increases time and moves ahead by 1 block - only to be done on local chain
 * @param timeShift time increase in seconds
 */
export const shiftTime = async (timeShift: number) => {
    // increase time by timeShift seconds
    await time.increase(timeShift)

    // mine single block
    await mine(1)
}

export const shiftTimeWithoutMiningBlock = async (timeShift: number) => {
    // just increases time without mining a block like above
    await time.increase(timeShift)
}

import { ethers, network, getNamedAccounts } from "hardhat"
import { developmentChains } from "../helper-hardhat-config"
import { ERC20, TokenVesting, ZeroKageMock } from "../typechain-types"
import { GOERLI_ZEROKAGE_ADDRESS } from "../constants"

// helper script that mocks winner selection
// used to check front end updates correctly
export const capitalize = async () => {
    console.log(
        "************* capitalize Token Vesting Contract with 100k 0Kage tokens *****************"
    )

    const { deployer } = await getNamedAccounts()

    const vestingContract: TokenVesting = await ethers.getContract("TokenVesting", deployer)
    let zKageContract: ERC20
    if (developmentChains.includes(network.name)) {
        zKageContract = await ethers.getContract("ZeroKageMock", deployer)
    } else {
        zKageContract = await ethers.getContractAt("ZeroKage", GOERLI_ZEROKAGE_ADDRESS)
    }

    const transferTx = await zKageContract.transfer(
        vestingContract.address,
        ethers.utils.parseEther("100000")
    )
    await transferTx.wait(1)

    console.log("------------------------------")
}

capitalize()
    .then(() => {
        process.exit(0)
    })
    .catch((e) => {
        console.log(e)
        process.exit(1)
    })

import { deployments, ethers, getNamedAccounts, network } from "hardhat"
import { developmentChains, networkConfig } from "../helper-hardhat-config"
import { GOERLI_ZEROKAGE_ADDRESS } from "../constants"
import { verify } from "../utils/verify"

const deployTokenVesting = async () => {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    let zKageAddress = ""
    const blockConfirmations =
        networkConfig[network.config.chainId || 31337].blockConfirmations || 1

    if (developmentChains.includes(network.name)) {
        log("Local network detected. Assigninng zKage mock contract address")
        const zkageContract = await ethers.getContract("ZeroKageMock")
        zKageAddress = zkageContract.address
    } else {
        log("Goerli network detected. Assigning already deployed zkage mock contract address")
        zKageAddress = GOERLI_ZEROKAGE_ADDRESS
    }
    const args = [zKageAddress]
    const tx = await deploy("TokenVesting", {
        log: true,
        from: deployer,
        args: args,
        waitConfirmations: blockConfirmations,
    })
    log("Token Vesting Contract deployed successfully....")
    log("----------------------")

    // if local chain -> fund 100,000 tokens to this vesting contract
    log("Funding token vesting contract with 100,000 0Kage")

    if (!developmentChains.includes(network.name)) {
        log("Non development chain detected.. sending for verification")
        const verifyTx = await verify(tx.address, args)
        log("----------------------")
    }
}

export default deployTokenVesting

deployTokenVesting.tags = ["main", "vesting"]
